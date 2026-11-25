import { AssertionError, assert } from "chai";
import type { Cluster, Redis } from "../../../lib";

import type { MessageTracker } from "./message-tracker";
import { wait } from "./test.util";

/**
 * Options for the `TestCommandRunner` loops
 */
interface CommandRunnerOptions {
  /**
   * Number of messages to publish in each batch
   */
  batchSize: number;
  /**
   * Timeout between batches or iterations in milliseconds
   */
  timeoutMs: number;
  /**
   * Function that generates the message content to be published
   */
  createMessage: () => string;
}

/**
 * Utility class for running test commands until a stop signal is received
 */
export class TestCommandRunner {
  private static readonly defaultOptions: CommandRunnerOptions = {
    batchSize: 10,
    timeoutMs: 10,
    createMessage: () => Date.now().toString(),
  };

  /**
   * Continuously publishes messages to the given Redis channels until aborted.
   *
   * @param {Redis|Cluster} client - Redis client or cluster instance used to publish messages.
   * @param {string[]} channels - List of channel names to publish messages to.
   * @param {MessageTracker} messageTracker - Tracks sent and failed message counts per channel.
   * @param {Partial<CommandRunnerOptions>} [options] - Optional overrides for batch size, timeout, and message factory.
   * @param {AbortController} [externalAbortController] - Optional external abort controller to control publishing lifecycle.
   * @returns {{ controller: AbortController, result: Promise<void> }}
   * An object containing the abort controller and a promise that resolves when publishing stops.
   */
  static publishMessagesUntilAbortSignal(
    client: Cluster,
    channels: string[],
    messageTracker: MessageTracker,
    options?: Partial<CommandRunnerOptions>,
    externalAbortController?: AbortController
  ) {
    const publishOptions = {
      ...TestCommandRunner.defaultOptions,
      ...options,
    };

    const abortController = externalAbortController ?? new AbortController();

    const result = async () => {
      while (!abortController.signal.aborted) {
        const batchPromises: Promise<void>[] = [];

        for (let i = 0; i < publishOptions.batchSize; i++) {
          for (const channel of channels) {
            const message = publishOptions.createMessage();

            const publishPromise = client
              .spublish(channel, message)
              .then(() => {
                messageTracker.incrementSent(channel);
              })
              .catch(() => {
                messageTracker.incrementFailed(channel);
              });

            batchPromises.push(publishPromise);
          }
        }

        await Promise.all(batchPromises);
        await wait(publishOptions.timeoutMs);
      }
    };

    return {
      controller: abortController,
      result: result(),
    };
  }

  /**
   * Runs SET then GET of a fresh value on the given key until aborted. A
   * command may fail, but a GET that follows a successful SET must read its
   * value.
   *
   * @param {Redis|Cluster} client - Redis client or cluster instance used to run the commands.
   * @param {string} key - Key to write and read.
   * @param {Partial<Pick<CommandRunnerOptions, "timeoutMs">>} [options] - Optional override for the timeout between iterations.
   * @param {AbortController} [externalAbortController] - Optional external abort controller to control the loop lifecycle.
   * @returns {{ controller: AbortController, result: Promise<{ succeeded: number, failures: Map<string, number> }> }}
   * An object containing the abort controller and a promise that resolves,
   * once the in-flight commands have settled, with the number of successful
   * iterations and the failures counted by command and error message. It
   * rejects on the first inconsistent read.
   */
  static setGetUntilAbortSignal(
    client: Redis | Cluster,
    key: string,
    options?: Partial<Pick<CommandRunnerOptions, "timeoutMs">>,
    externalAbortController?: AbortController
  ) {
    const { timeoutMs } = { ...TestCommandRunner.defaultOptions, ...options };
    const abortController = externalAbortController ?? new AbortController();

    const result = async () => {
      let succeeded = 0;
      const failures = new Map<string, number>();

      let iteration = 0;
      while (!abortController.signal.aborted) {
        const value = `value-${iteration++}`;
        let set = false;
        try {
          await client.set(key, value);
          set = true;
          assert.strictEqual(
            await client.get(key),
            value,
            "GET after a successful SET"
          );
          succeeded++;
        } catch (error) {
          if (error instanceof AssertionError) {
            throw error;
          }
          const label = `${set ? "GET" : "SET"}: ${(error as Error).message}`;
          failures.set(label, (failures.get(label) ?? 0) + 1);
        }

        await wait(timeoutMs);
      }

      return { succeeded, failures };
    };

    const resultPromise = result();
    // The caller observes the result after aborting. Attach a handler now as
    // well so a failure before that is not reported as unhandled.
    void resultPromise.catch(() => {});

    return {
      controller: abortController,
      result: resultPromise,
    };
  }
}
