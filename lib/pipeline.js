'use strict';
var _ = require('lodash');
var Commander = require('./commander');
var Command = require('./command');
var fbuffer = require('flexbuffer');
var Promise = require('bluebird');
var utils = require('./utils');
var commands = require('../commands');

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
}

_.assign(Pipeline.prototype, Commander.prototype);

Pipeline.prototype.fillResult = function (value, position) {
  this._result[position] = value;

  if (--this.replyPending) {
    return;
  }

  var i;
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
        var commandDef = commands[command.name];
        var isReadOnly = commandDef && _.include(commandDef.flags, 'readonly');
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
      this.redis.handleError(commonError, this.leftRedirections, {
        moved: function (node, slot) {
          _this.preferNode = node;
          _this.redis.slots[errv[1]] = node;
          _this.redis.refreshSlotsCache();
          _this.exec();
        },
        ask: function (node) {
          _this.preferNode = node;
          _this.exec();
        },
        clusterDown: function () {
          _this.exec();
        },
        connectionClosed: function () {
          _this.exec();
        },
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
  for (var i = 0; i < commands.length; ++i) {
    var command = commands[i];
    var commandName = command.shift();
    this[commandName].apply(this, command);
  }

  return this;
};

var multi = Pipeline.prototype.multi;
Pipeline.prototype.multi = function () {
  this._transactions += 1;
  return multi.apply(this, arguments);
};

var exec = Pipeline.prototype.exec;
Pipeline.prototype.exec = function (callback) {
  if (this._transactions > 0) {
    this._transactions -= 1;
    return exec.apply(this, arguments);
  }
  if (!this.nodeifiedPromise) {
    this.nodeifiedPromise = true;
    this.promise.nodeify(callback);
  }
  if (_.isEmpty(this._queue)) {
    this.resolve([]);
  }
  var pipelineSlot;
  // Check whether scripts exists and get a sampleKey.
  var scripts = [];
  for (var i = 0; i < this._queue.length; ++i) {
    var item = this._queue[i];
    if (this.isCluster) {
      var keys = item.getKeys();
      for (var j = 0; j < keys.length; ++j) {
        var slot = utils.calcSlot(keys[j]);
        if (typeof pipelineSlot === 'undefined') {
          pipelineSlot = slot;
        }
        if (pipelineSlot !== slot) {
          this.reject(new Error('All keys in the pipeline should belong to the same slot(expect "' + keys[j] + '" belongs to slot ' + pipelineSlot + ').'));
          return this.promise;
        }
      }
    }
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
  if (this.isCluster && typeof pipelineSlot === 'undefined') {
    pipelineSlot = Math.random() * 16384 | 0;
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

  function execPipeline () {
    var data = '';
    var writePending = _this.replyPending =  _this._queue.length;

    var node = { slot: pipelineSlot, redis: _this.preferNode };
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
