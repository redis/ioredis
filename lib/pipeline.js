'use strict';

var _ = require('lodash');
var Command = require('./command');
var Commander = require('./commander');
var Promise = require('bluebird');

function Pipeline(redis) {
  Commander.call(this);

  this.redis = redis;
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

_.extend(Pipeline.prototype, Commander.prototype);

Pipeline.prototype.fillResult = function (value, position) {
  this._result[position] = value;
  if (!--this.replyPending) {
    this.resolve(this._result);
  }
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

  // Check whether scripts exists.
  var scripts = [];
  for (var i = 0; i < this._queue.length; ++i) {
    var item = this._queue[i];
    if (item.name !== 'evalsha') {
      continue;
    }
    var script = this._shaToScript[item.args[0]];
    if (!script) {
      continue;
    }
    scripts.push(script);
  }

  var promise;
  var _this = this;
  if (scripts.length) {
    promise = this.redis.script('exists', scripts.map(function (item) {
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
    });
  } else {
    promise = Promise.resolve();
  }

  return promise.then(function () {
    var data = '';
    var writePending = _this.replyPending =  _this._queue.length;
    // TODO optimize buffer
    var stream = {
      write: function (writable) {
        data += writable;
        if (!--writePending) {
          _this.redis.connection.write(data);
        }
      }
    };

    for (var i = 0; i < _this._queue.length; ++i) {
      if (_this._queue[i] instanceof Command) {
        _this.redis.sendCommand(_this._queue[i], stream);
      }
    }
    return _this.promise;
  }).nodeify(callback);
};

module.exports = Pipeline;
