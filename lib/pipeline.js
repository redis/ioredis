'use strict';
var _ = require('./utils/lodash');
var Commander = require('./commander');
var Command = require('./command');
var fbuffer = require('flexbuffer');
var Promise = require('bluebird');
var util = require('util');
var commands = require('redis-commands');
var calculateSlot = require('cluster-key-slot');

function Pipeline(redis) {
  Commander.call(this);

  this.redis = redis;
  this.isCluster = this.redis.constructor.name === 'Cluster';
  this.options = redis.options;
  this._queue = [];
  this._result = [];
  this._transactions = 0;
  this._shaToScript = {};

  var _this = this;
  _.keys(redis.scriptsSet).forEach(function (name) {
    var script = redis.scriptsSet[name];
    _this._shaToScript[script.sha] = script;
    _this[name] = redis[name];
    _this[name + 'Buffer'] = redis[name + 'Buffer'];
  });

  this.promise = new Promise(function (resolve, reject) {
    _this.resolve = resolve;
    _this.reject = reject;
  });

  Object.defineProperty(this, 'length', {
    get: function () {
      return _this._queue.length;
    }
  });
}

_.assign(Pipeline.prototype, Commander.prototype);

Pipeline.prototype.fillResult = function (value, position) {
  var i;
  if (this._queue[position].name === 'exec' && Array.isArray(value[1])) {
    var execLength = value[1].length;
    for (i = 0; i < execLength; i++) {
      if (value[1][i] instanceof Error) {
        continue;
      }
      var cmd = this._queue[position - (execLength - i)];
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
    var retriable = true;
    var commonError;
    var inTransaction;
    for (i = 0; i < this._result.length; ++i) {
      var error = this._result[i][0];
      var command = this._queue[i];
      if (command.name === 'multi') {
        inTransaction = true;
      } else if (command.name === 'exec') {
        inTransaction = false;
      }
      if (error) {
        if (command.name === 'exec' && error.message === 'EXECABORT Transaction discarded because of previous errors.') {
          continue;
        }
        if (!commonError) {
          commonError = {
            name: error.name,
            message: error.message
          };
        } else if (commonError.name !== error.name || commonError.message !== error.message) {
          retriable = false;
          break;
        }
      } else if (!inTransaction) {
        var isReadOnly = commands.exists(command.name) && commands.hasFlag(command.name, 'readonly');
        if (!isReadOnly) {
          retriable = false;
          break;
        }
      }
    }
    if (commonError && retriable) {
      var _this = this;
      var errv = commonError.message.split(' ');
      var queue = this._queue;
      inTransaction = false;
      this._queue = [];
      for (i = 0; i < queue.length; ++i) {
        if (errv[0] === 'ASK' && !inTransaction &&
            queue[i].name !== 'asking' &&
            (!queue[i - 1] || queue[i - 1].name !== 'asking')) {
          var asking = new Command('asking');
          asking.ignore = true;
          this.sendCommand(asking);
        }
        queue[i].initPromise();
        this.sendCommand(queue[i]);
        if (queue[i].name === 'multi') {
          inTransaction = true;
        } else if (queue[i].name === 'exec') {
          inTransaction = false;
        }
      }

      var matched = true;
      if (typeof this.leftRedirections === 'undefined') {
        this.leftRedirections = {};
      }
      var exec = function () {
        _this.exec();
      };
      this.redis.handleError(commonError, this.leftRedirections, {
        moved: function (slot, key) {
          _this.preferKey = key;
          _this.redis.slots[errv[1]] = [key];
          _this.redis.refreshSlotsCache();
          _this.exec();
        },
        ask: function (slot, key) {
          _this.preferKey = key;
          _this.exec();
        },
        tryagain: exec,
        clusterDown: exec,
        connectionClosed: exec,
        maxRedirections: function () {
          matched = false;
        },
        defaults: function () {
          matched = false;
        }
      });
      if (matched) {
        return;
      }
    }
  }

  var ignoredCount = 0;
  for (i = 0; i < this._queue.length - ignoredCount; ++i) {
    if (this._queue[i + ignoredCount].ignore) {
      ignoredCount += 1;
    }
    this._result[i] = this._result[i + ignoredCount];
  }
  this.resolve(this._result.slice(0, this._result.length - ignoredCount));
};

Pipeline.prototype.sendCommand = function (command) {
  var position = this._queue.length;

  var _this = this;

  command.promise.then(function (result) {
    _this.fillResult([null, result], position);
  }).catch(function (error) {
    _this.fillResult([error], position);
  });

  this._queue.push(command);

  return this;
};

Pipeline.prototype.addBatch = function (commands) {
  var command, commandName, args;
  for (var i = 0; i < commands.length; ++i) {
    command = commands[i];
    commandName = command[0];
    args = command.slice(1);
    this[commandName].apply(this, args);
  }

  return this;
};

var multi = Pipeline.prototype.multi;
Pipeline.prototype.multi = function () {
  this._transactions += 1;
  return multi.apply(this, arguments);
};

var execBuffer = Pipeline.prototype.execBuffer;
var exec = Pipeline.prototype.exec;
Pipeline.prototype.execBuffer = util.deprecate(function () {
  if (this._transactions > 0) {
    this._transactions -= 1;
  }
  return execBuffer.apply(this, arguments);
}, 'Pipeline#execBuffer: Use Pipeline#exec instead');

Pipeline.prototype.exec = function (callback) {
  if (this._transactions > 0) {
    this._transactions -= 1;
    return (this.options.dropBufferSupport ? exec : execBuffer).apply(this, arguments);
  }
  if (!this.nodeifiedPromise) {
    this.nodeifiedPromise = true;
    this.promise.nodeify(callback);
  }
  if (_.isEmpty(this._queue)) {
    this.resolve([]);
  }
  var pipelineSlot, i;
  if (this.isCluster) {
    // List of the first key for each command
    var sampleKeys = [];
    for (i = 0; i < this._queue.length; i++) {
      var keys = this._queue[i].getKeys();
      if (keys.length) {
        sampleKeys.push(keys[0]);
      }
    }

    if (sampleKeys.length) {
      pipelineSlot = calculateSlot.generateMulti(sampleKeys);
      if (pipelineSlot < 0) {
        this.reject(new Error('All keys in the pipeline should belong to the same slot'));
        return this.promise;
      }
    } else {
      // Send the pipeline to a random node
      pipelineSlot = Math.random() * 16384 | 0;
    }
  }

  // Check whether scripts exists
  var scripts = [];
  for (i = 0; i < this._queue.length; ++i) {
    var item = this._queue[i];
    if (this.isCluster && item.isCustomCommand) {
      this.reject(new Error('Sending custom commands in pipeline is not supported in Cluster mode.'));
      return this.promise;
    }
    if (item.name !== 'evalsha') {
      continue;
    }
    var script = this._shaToScript[item.args[0]];
    if (!script) {
      continue;
    }
    scripts.push(script);
  }

  var _this = this;
  if (!scripts.length) {
    return execPipeline();
  }

  return this.redis.script('exists', scripts.map(function (item) {
    return item.sha;
  })).then(function (results) {
    var pending = [];
    for (var i = 0; i < results.length; ++i) {
      if (!results[i]) {
        pending.push(scripts[i]);
      }
    }
    return Promise.all(pending.map(function (script) {
      return _this.redis.script('load', script.lua);
    }));
  }).then(execPipeline);

  function execPipeline() {
    var data = '';
    var writePending = _this.replyPending = _this._queue.length;

    var node;
    if (_this.isCluster) {
      node = { slot: pipelineSlot, redis: _this.redis.connectionPool.nodes.all[_this.preferKey] };
    }
    var bufferMode = false;
    var stream = {
      write: function (writable) {
        if (writable instanceof Buffer) {
          bufferMode = true;
        }
        if (bufferMode) {
          if (typeof data === 'string') {
            var flexBuffer = new fbuffer.FlexBuffer(0);
            flexBuffer.write(data);
            data = flexBuffer;
          }
          data.write(writable);
        } else {
          data += writable;
        }
        if (!--writePending) {
          if (bufferMode) {
            data = data.getBuffer();
          }
          if (_this.isCluster) {
            node.redis.stream.write(data);
          } else {
            _this.redis.stream.write(data);
          }

          // Reset writePending for resending
          writePending = _this._queue.length;
          data = '';
          bufferMode = false;
        }
      }
    };

    for (var i = 0; i < _this._queue.length; ++i) {
      _this.redis.sendCommand(_this._queue[i], stream, node);
    }
    return _this.promise;
  }
};

module.exports = Pipeline;
