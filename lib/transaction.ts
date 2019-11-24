import { wrapMultiResult } from "./utils";
import asCallback from "standard-as-callback";
import Pipeline from "./pipeline";
import { CallbackFunction } from "./types";

export function addTransactionSupport(redis) {
  redis.pipeline = function(commands) {
    const pipeline = new Pipeline(this);
    if (Array.isArray(commands)) {
      pipeline.addBatch(commands);
    }
    return pipeline;
  };

  const { multi } = redis;
  redis.multi = function(commands, options) {
    if (typeof options === "undefined" && !Array.isArray(commands)) {
      options = commands;
      commands = null;
    }
    if (options && options.pipeline === false) {
      return multi.call(this);
    }
    const pipeline = new Pipeline(this);
    pipeline.multi();
    if (Array.isArray(commands)) {
      pipeline.addBatch(commands);
    }
    const exec = pipeline.exec;
    pipeline.exec = function(callback: CallbackFunction) {
      if (this._transactions > 0) {
        exec.call(pipeline);
      }

      // Returns directly when the pipeline
      // has been called multiple times (retries).
      if (this.nodeifiedPromise) {
        return exec.call(pipeline);
      }
      const promise = exec.call(pipeline);
      return asCallback(
        promise.then(function(result) {
          const execResult = result[result.length - 1];
          if (typeof execResult === "undefined") {
            throw new Error(
              "Pipeline cannot be used to send any commands when the `exec()` has been called on it."
            );
          }
          if (execResult[0]) {
            execResult[0].previousErrors = [];
            for (let i = 0; i < result.length - 1; ++i) {
              if (result[i][0]) {
                execResult[0].previousErrors.push(result[i][0]);
              }
            }
            throw execResult[0];
          }
          // Minus two to exclude the multi and exec responses
          const commandCount = result.length - 2;
          if (execResult[1] !== null && execResult[1].length !== commandCount) {
            // Some commands failed and the errors are not included in execResult[1]
            // Merge in those failures in the correct order
            const mergedResult = [];
            let execResultIndex = 0;
            for (let i = 1; i < result.length - 1; ++i) {
              if (result[i][0]) {
                mergedResult.push(result[i][0]);
              } else {
                mergedResult.push(execResult[1][execResultIndex++]);
              }
            }
            return wrapMultiResult(mergedResult);
          }
          return wrapMultiResult(execResult[1]);
        }),
        callback
      );
    };

    const { execBuffer } = pipeline;
    pipeline.execBuffer = function(callback) {
      if (this._transactions > 0) {
        execBuffer.call(pipeline);
      }
      return pipeline.exec(callback);
    };
    return pipeline;
  };

  const { exec } = redis;
  redis.exec = function(callback: CallbackFunction) {
    return asCallback(
      exec.call(this).then(function(results) {
        if (Array.isArray(results)) {
          results = wrapMultiResult(results);
        }
        return results;
      }),
      callback
    );
  };
}
