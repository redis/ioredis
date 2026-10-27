import { wrapMultiResult, noop } from "./utils";
import asCallback from "standard-as-callback";
import Pipeline from "./Pipeline";
import { Callback } from "./types";
import { ChainableCommander } from "./utils/RedisCommander";
import { traceBatch } from "./tracing";

export interface Transaction<Mapping extends "resp2" | "resp3" = "resp2"> {
  pipeline(commands?: unknown[][]): ChainableCommander<Mapping>;
  multi(options: { pipeline: false }): Promise<"OK">;
  multi(): ChainableCommander<Mapping>;
  multi(options: { pipeline: true }): ChainableCommander<Mapping>;
  multi(commands?: unknown[][]): ChainableCommander<Mapping>;
}

export function addTransactionSupport(redis) {
  redis.pipeline = function (commands) {
    const pipeline = new Pipeline(this);
    if (Array.isArray(commands)) {
      pipeline.addBatch(commands);
    }
    return pipeline;
  };

  const { multi } = redis;
  redis.multi = function (commands, options) {
    const redisInstance = this;
    if (typeof options === "undefined" && !Array.isArray(commands)) {
      options = commands;
      commands = null;
    }
    if (options && options.pipeline === false) {
      return multi.call(this);
    }
    const pipeline = new Pipeline(this);
    // @ts-expect-error
    pipeline.multi();
    if (Array.isArray(commands)) {
      pipeline.addBatch(commands);
    }
    const exec = pipeline.exec;
    pipeline.exec = function (callback: Callback) {
      // Wait for the cluster to be connected, since we need nodes information before continuing
      if (this.isCluster && !this.redis.slots.length) {
        if (this.redis.status === "wait") this.redis.connect().catch(noop);
        return asCallback(
          new Promise((resolve, reject) => {
            this.redis.delayUntilReady((err) => {
              if (err) {
                reject(err);
                return;
              }

              this.exec(pipeline).then(resolve, reject);
            });
          }),
          callback
        );
      }

      if (this._transactions > 0) {
        exec.call(pipeline);
      }

      // Returns directly when the pipeline
      // has been called multiple times (retries).
      if (this.nodeifiedPromise) {
        return exec.call(pipeline);
      }

      // Count only user commands (exclude MULTI/EXEC wrappers).
      const batchSize = Math.max(pipeline.length - 2, 0);

      const execAndUnwrap = () =>
        exec.call(pipeline).then(function (result: any[]): any[] | null {
          const execResult = result[result.length - 1];
          if (typeof execResult === "undefined") {
            throw new Error(
              "Pipeline cannot be used to send any commands when the `exec()` has been called on it."
            );
          }
          if (execResult[0]) {
            execResult[0].previousErrors = [];
            for (let i = 0; i < result.length - 1; ++i) {
              // A flushed queue rejects every command with the same error object.
              if (result[i][0] && result[i][0] !== execResult[0]) {
                execResult[0].previousErrors.push(result[i][0]);
              }
            }
            throw execResult[0];
          }
          if (execResult[1] !== null) {
            // The SELECTs this MULTI queued have now run: commit the last one's db, the one the
            // connection is on. A discarded EXEC (nil) never runs them, so nothing is committed.
            let appliedSelect: number | undefined;
            const queued = (pipeline as unknown as {
              _queue: Array<{ selectDb?: number }>;
            })._queue;
            for (const command of queued) {
              if (command.selectDb !== undefined) {
                appliedSelect = command.selectDb;
              }
            }
            if (
              appliedSelect !== undefined &&
              redisInstance.condition.select !== appliedSelect
            ) {
              redisInstance.condition.select = appliedSelect;
              redisInstance.emit("select", appliedSelect);
            }
          }
          return wrapMultiResult(execResult[1]);
        });

      // Trace MULTI as a single batch operation on ioredis:batch.
      const promise =
        "_buildBatchContext" in this.redis
          ? traceBatch(execAndUnwrap, () =>
              (this.redis as any)._buildBatchContext(batchSize)
            )
          : execAndUnwrap();

      return asCallback(promise, callback);
    };

    // @ts-expect-error
    const { execBuffer } = pipeline;
    // @ts-expect-error
    pipeline.execBuffer = function (callback: Callback) {
      if (this._transactions > 0) {
        execBuffer.call(pipeline);
      }
      return pipeline.exec(callback);
    };
    return pipeline;
  };

  const { exec } = redis;
  redis.exec = function (callback: Callback): Promise<any[] | null> {
    return asCallback(
      exec.call(this).then(function (results: any[] | null) {
        if (Array.isArray(results)) {
          results = wrapMultiResult(results);
        }
        return results;
      }),
      callback
    );
  };
}
