import Command from "./command";
import { deprecate } from "util";
import asCallback from "standard-as-callback";
import { exists, hasFlag } from "redis-commands";
import { generateMulti } from "cluster-key-slot";
import * as PromiseContainer from "./promiseContainer";
import { CallbackFunction } from "./types";
import Commander from "./commander";

export default function Pipeline(redis) {
  Commander.call(this);

  this.redis = redis;
  this.isCluster = this.redis.constructor.name === "Cluster";
  this.options = redis.options;
  this._queue = [];
  this._result = [];
  this._transactions = 0;
  this._shaToScript = {};

  Object.keys(redis.scriptsSet).forEach(name => {
    const script = redis.scriptsSet[name];
    this._shaToScript[script.sha] = script;
    this[name] = redis[name];
    this[name + "Buffer"] = redis[name + "Buffer"];
  });

  const Promise = PromiseContainer.get();
  this.promise = new Promise((resolve, reject) => {
    this.resolve = resolve;
    this.reject = reject;
  });

  const _this = this;
  Object.defineProperty(this, "length", {
    get: function() {
      return _this._queue.length;
    }
  });
}

Object.assign(Pipeline.prototype, Commander.prototype);

Pipeline.prototype.fillResult = function(value, position) {
  if (this._queue[position].name === "exec" && Array.isArray(value[1])) {
    var execLength = value[1].length;
    for (let i = 0; i < execLength; i++) {
      if (value[1][i] instanceof Error) {
        continue;
      }
      const cmd = this._queue[position - (execLength - i)];
      try {
        value[1][i] = cmd.transformReply(value[1][i]);
      } catch (err) {
        value[1][i] = err;
      }
    }
  }
  this._result[position] = value;

  if (--this.replyPending) {
    return;
  }

  if (this.isCluster) {
    let retriable = true;
    let commonError: { name: string; message: string };
    for (let i = 0; i < this._result.length; ++i) {
      var error = this._result[i][0];
      var command = this._queue[i];
      if (error) {
        if (
          command.name === "exec" &&
          error.message ===
            "EXECABORT Transaction discarded because of previous errors."
        ) {
          continue;
        }
        if (!commonError) {
          commonError = {
            name: error.name,
            message: error.message
          };
        } else if (
          commonError.name !== error.name ||
          commonError.message !== error.message
        ) {
          retriable = false;
          break;
        }
      } else if (!command.inTransaction) {
        var isReadOnly =
          exists(command.name) && hasFlag(command.name, "readonly");
        if (!isReadOnly) {
          retriable = false;
          break;
        }
      }
    }
    if (commonError && retriable) {
      var _this = this;
      var errv = commonError.message.split(" ");
      var queue = this._queue;
      let inTransaction = false;
      this._queue = [];
      for (let i = 0; i < queue.length; ++i) {
        if (
          errv[0] === "ASK" &&
          !inTransaction &&
          queue[i].name !== "asking" &&
          (!queue[i - 1] || queue[i - 1].name !== "asking")
        ) {
          var asking = new Command("asking");
          asking.ignore = true;
          this.sendCommand(asking);
        }
        queue[i].initPromise();
        this.sendCommand(queue[i]);
        inTransaction = queue[i].inTransaction;
      }

      let matched = true;
      if (typeof this.leftRedirections === "undefined") {
        this.leftRedirections = {};
      }
      const exec = function() {
        _this.exec();
      };
      this.redis.handleError(commonError, this.leftRedirections, {
        moved: function(slot, key) {
          _this.preferKey = key;
          _this.redis.slots[errv[1]] = [key];
          _this.redis.refreshSlotsCache();
          _this.exec();
        },
        ask: function(slot, key) {
          _this.preferKey = key;
          _this.exec();
        },
        tryagain: exec,
        clusterDown: exec,
        connectionClosed: exec,
        maxRedirections: () => {
          matched = false;
        },
        defaults: () => {
          matched = false;
        }
      });
      if (matched) {
        return;
      }
    }
  }

  let ignoredCount = 0;
  for (let i = 0; i < this._queue.length - ignoredCount; ++i) {
    if (this._queue[i + ignoredCount].ignore) {
      ignoredCount += 1;
    }
    this._result[i] = this._result[i + ignoredCount];
  }
  this.resolve(this._result.slice(0, this._result.length - ignoredCount));
};

Pipeline.prototype.sendCommand = function(command) {
  if (this._transactions > 0) {
    command.inTransaction = true;
  }

  const position = this._queue.length;
  command.pipelineIndex = position;

  command.promise
    .then(result => {
      this.fillResult([null, result], position);
    })
    .catch(error => {
      this.fillResult([error], position);
    });

  this._queue.push(command);

  return this;
};

Pipeline.prototype.addBatch = function(commands) {
  let command, commandName, args;
  for (let i = 0; i < commands.length; ++i) {
    command = commands[i];
    commandName = command[0];
    args = command.slice(1);
    this[commandName].apply(this, args);
  }

  return this;
};

const multi = Pipeline.prototype.multi;
Pipeline.prototype.multi = function() {
  this._transactions += 1;
  return multi.apply(this, arguments);
};

const execBuffer = Pipeline.prototype.execBuffer;
const exec = Pipeline.prototype.exec;
Pipeline.prototype.execBuffer = deprecate(function() {
  if (this._transactions > 0) {
    this._transactions -= 1;
  }
  return execBuffer.apply(this, arguments);
}, "Pipeline#execBuffer: Use Pipeline#exec instead");

Pipeline.prototype.exec = function(callback: CallbackFunction) {
  if (this._transactions > 0) {
    this._transactions -= 1;
    return (this.options.dropBufferSupport ? exec : execBuffer).apply(
      this,
      arguments
    );
  }
  if (!this.nodeifiedPromise) {
    this.nodeifiedPromise = true;
    asCallback(this.promise, callback);
  }
  if (!this._queue.length) {
    this.resolve([]);
  }
  let pipelineSlot: number;
  if (this.isCluster) {
    // List of the first key for each command
    const sampleKeys: string[] = [];
    for (let i = 0; i < this._queue.length; i++) {
      var keys = this._queue[i].getKeys();
      if (keys.length) {
        sampleKeys.push(keys[0]);
      }
    }

    if (sampleKeys.length) {
      pipelineSlot = generateMulti(sampleKeys);
      if (pipelineSlot < 0) {
        this.reject(
          new Error("All keys in the pipeline should belong to the same slot")
        );
        return this.promise;
      }
    } else {
      // Send the pipeline to a random node
      pipelineSlot = (Math.random() * 16384) | 0;
    }
  }

  // Check whether scripts exists
  const scripts = [];
  for (let i = 0; i < this._queue.length; ++i) {
    var item = this._queue[i];
    if (this.isCluster && item.isCustomCommand) {
      this.reject(
        new Error(
          "Sending custom commands in pipeline is not supported in Cluster mode."
        )
      );
      return this.promise;
    }
    if (item.name !== "evalsha") {
      continue;
    }
    const script = this._shaToScript[item.args[0]];
    if (!script) {
      continue;
    }
    scripts.push(script);
  }

  var _this = this;
  if (!scripts.length) {
    return execPipeline();
  }

  return this.redis
    .script("exists", Array.from(new Set(scripts.map(({ sha }) => sha))))
    .then(function(results) {
      var pending = [];
      for (var i = 0; i < results.length; ++i) {
        if (!results[i]) {
          pending.push(scripts[i]);
        }
      }
      var Promise = PromiseContainer.get();
      return Promise.all(
        pending.map(function(script) {
          return _this.redis.script("load", script.lua);
        })
      );
    })
    .then(execPipeline);

  function execPipeline() {
    let data = "";
    let buffers: Buffer[];
    let writePending: number = (_this.replyPending = _this._queue.length);

    let node;
    if (_this.isCluster) {
      node = {
        slot: pipelineSlot,
        redis: _this.redis.connectionPool.nodes.all[_this.preferKey]
      };
    }
    let bufferMode = false;
    const stream = {
      write: function(writable) {
        if (writable instanceof Buffer) {
          bufferMode = true;
        }
        if (bufferMode) {
          if (!buffers) {
            buffers = [];
          }
          if (typeof data === "string") {
            buffers.push(Buffer.from(data, "utf8"));
            data = undefined;
          }
          buffers.push(
            typeof writable === "string"
              ? Buffer.from(writable, "utf8")
              : writable
          );
        } else {
          data += writable;
        }
        if (!--writePending) {
          let sendData: Buffer | string;
          if (buffers) {
            sendData = Buffer.concat(buffers);
          } else {
            sendData = data;
          }
          if (_this.isCluster) {
            node.redis.stream.write(sendData);
          } else {
            _this.redis.stream.write(sendData);
          }

          // Reset writePending for resending
          writePending = _this._queue.length;
          data = "";
          buffers = undefined;
          bufferMode = false;
        }
      }
    };

    for (let i = 0; i < _this._queue.length; ++i) {
      _this.redis.sendCommand(_this._queue[i], stream, node);
    }
    return _this.promise;
  }
};
