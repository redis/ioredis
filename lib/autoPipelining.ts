import * as PromiseContainer from "./promiseContainer";
import { flatten, isArguments, noop } from "./utils/lodash";
import * as calculateSlot from "cluster-key-slot";
import asCallback from "standard-as-callback";

export const kExec = Symbol("exec");
export const kCallbacks = Symbol("callbacks");
export const notAllowedAutoPipelineCommands = [
  "auth",
  "info",
  "script",
  "quit",
  "cluster",
  "pipeline",
  "multi",
  "subscribe",
  "psubscribe",
  "ssubscribe",
  "unsubscribe",
  "punsubscribe",
  "sunsubscribe",
];

function executeAutoPipeline(client, slotKey: string) {
  /*
    If a pipeline is already executing, keep queueing up commands
    since ioredis won't serve two pipelines at the same time
  */
  if (client._runningAutoPipelines.has(slotKey)) {
    return;
  }
  if (!client._autoPipelines.has(slotKey)) {
    /* 
      Rare edge case. Somehow, something has deleted this running autopipeline in an immediate 
      call to executeAutoPipeline. 
     
      Maybe the callback in the pipeline.exec is sometimes called in the same tick,
      e.g. if redis is disconnected?
    */
    return;
  }

  client._runningAutoPipelines.add(slotKey);

  // Get the pipeline and immediately delete it so that new commands are queued on a new pipeline
  const pipeline = client._autoPipelines.get(slotKey);
  client._autoPipelines.delete(slotKey);

  const callbacks = pipeline[kCallbacks];
  // Stop keeping a reference to callbacks immediately after the callbacks stop being used.
  // This allows the GC to reclaim objects referenced by callbacks, especially with 16384 slots
  // in Redis.Cluster
  pipeline[kCallbacks] = null;

  // Perform the call
  pipeline.exec(function (err, results) {
    client._runningAutoPipelines.delete(slotKey);

    /*
      Invoke all callback in nextTick so the stack is cleared 
      and callbacks can throw errors without affecting other callbacks.
    */
    if (err) {
      for (let i = 0; i < callbacks.length; i++) {
        process.nextTick(callbacks[i], err);
      }
    } else {
      for (let i = 0; i < callbacks.length; i++) {
        process.nextTick(callbacks[i], ...results[i]);
      }
    }

    // If there is another pipeline on the same node, immediately execute it without waiting for nextTick
    if (client._autoPipelines.has(slotKey)) {
      executeAutoPipeline(client, slotKey);
    }
  });
}

export function shouldUseAutoPipelining(
  client,
  functionName: string,
  commandName: string
): boolean {
  return (
    functionName &&
    client.options.enableAutoPipelining &&
    !client.isPipeline &&
    !notAllowedAutoPipelineCommands.includes(commandName) &&
    !client.options.autoPipeliningIgnoredCommands.includes(commandName)
  );
}

/**
 * @private
 */
export function getFirstValueInFlattenedArray(
  args: (string | string[])[]
): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (typeof arg === "string") {
      return arg;
    } else if (Array.isArray(arg) || isArguments(arg)) {
      if (arg.length === 0) {
        continue;
      }
      return arg[0];
    }
    const flattened = flatten([arg]);
    if (flattened.length > 0) {
      return flattened[0];
    }
  }
  return undefined;
}

export function executeWithAutoPipelining(
  client,
  functionName: string,
  commandName: string,
  args: (string | string[])[],
  callback
) {
  const CustomPromise = PromiseContainer.get();

  // On cluster mode let's wait for slots to be available
  if (client.isCluster && !client.slots.length) {
    if (client.status === "wait") client.connect().catch(noop);
    return asCallback(
      new CustomPromise(function (resolve, reject) {
        client.delayUntilReady((err) => {
          if (err) {
            reject(err);
            return;
          }

          executeWithAutoPipelining(
            client,
            functionName,
            commandName,
            args,
            null
          ).then(resolve, reject);
        });
      }),
      callback
    );
  }

  // If we have slot information, we can improve routing by grouping slots served by the same subset of nodes
  // Note that the first value in args may be a (possibly empty) array.
  // ioredis will only flatten one level of the array, in the Command constructor.
  const prefix = client.options.keyPrefix || "";
  const slotKey = client.isCluster
    ? client.slots[
        calculateSlot(`${prefix}${getFirstValueInFlattenedArray(args)}`)
      ].join(",")
    : "main";

  if (!client._autoPipelines.has(slotKey)) {
    const pipeline = client.pipeline();
    pipeline[kExec] = false;
    pipeline[kCallbacks] = [];
    client._autoPipelines.set(slotKey, pipeline);
  }

  const pipeline = client._autoPipelines.get(slotKey);

  /* 
    Mark the pipeline as scheduled.
    The symbol will make sure that the pipeline is only scheduled once per tick.
    New commands are appended to an already scheduled pipeline.
  */
  if (!pipeline[kExec]) {
    pipeline[kExec] = true;
    /*
      Deferring with setImmediate so we have a chance to capture multiple
      commands that can be scheduled by I/O events already in the event loop queue.
    */
    setImmediate(executeAutoPipeline, client, slotKey);
  }

  // Create the promise which will execute the command in the pipeline.
  const autoPipelinePromise = new CustomPromise(function (resolve, reject) {
    pipeline[kCallbacks].push(function (err: Error | null, value: any) {
      if (err) {
        reject(err);
        return;
      }

      resolve(value);
    });

    pipeline[functionName](...args);
  });

  return asCallback(autoPipelinePromise, callback);
}
