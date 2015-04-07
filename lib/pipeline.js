var _ = require('lodash');
var Command = require('./command');
var Promise = require('bluebird');

function Pipeline(redis) {
  this.redis = redis;
  this._queue = [];
  this._result = [];

  var _this = this;
  _.keys(redis.scriptsSet).forEach(function (name) {
    var script = redis.scriptsSet[name];
    _this[name] = function () {
      var args = _.toArray(arguments);
      var callback;

      if (typeof args[args.length - 1] === 'function') {
        callback = args.pop();
      }

      var position = _this._queue.length;
      var command;
      try {
        command = script.getExecuteCommand(args, 'utf8', function (err, result) {
          if (callback) {
            callback(err, result);
          }
          if (err) {
            _this.fillResult([err], position);
          } else {
            _this.fillResult([null, result], position);
          }
        });
      } catch (err) {
        if (callback) {
          callback(err);
        }
        _this.fillResult([err], position);
        _this._queue.push(null);
        return _this;
      }
      _this._queue.push(command);
      return _this;
    };
  });

  this.promise = new Promise(function (resolve, reject) {
    _this.resolve = resolve;
    _this.reject = reject;
  });
}

Pipeline.prototype.fillResult = function (value, position) {
  this._result[position] = value;
  if (!--this.replyPending) {
    this.resolve(this._result);
  }
};

var commands = require('ioredis-commands');
var skippedCommands = ['monitor'];
_.keys(commands).forEach(function (command) {
  if (_.includes(skippedCommands, command)) {
    return;
  }
  command = command.split(' ')[0].toLowerCase();
  Pipeline.prototype[command] = function () {
    var args = _.toArray(arguments);
    var callback;
    if (typeof args[args.length - 1] === 'function') {
      callback = args.pop();
    }

    var _this = this;
    var position = this._queue.length;
    this._queue.push(new Command(command, args, 'utf8', function (err, result) {
      if (callback) {
        callback(err, result);
      }
      if (err) {
        _this.fillResult([err], position);
      } else {
        _this.fillResult([null, result], position);
      }
    }));
    return this;
  };

  Pipeline.prototype[command + 'Buffer'] = function () {
    var args = _.toArray(arguments);
    var callback;
    if (typeof args[args.length - 1] === 'function') {
      callback = args.pop();
    }

    var _this = this;
    var position = this._queue.length;
    this._queue.push(new Command(command, args, null, function (err, result) {
      if (callback) {
        callback(err, result);
      }
      if (err) {
        _this.fillResult([err], position);
      } else {
        _this.fillResult([null, result], position);
      }
    }));
    return this;
  };
});

Pipeline.prototype.execCommand = Pipeline.prototype.exec;
Pipeline.prototype.exec = function (callback) {
  var data = '';
  var writePending = this.replyPending =  this._queue.length;
  // TODO optimize buffer
  var _this = this;
  var stream = {
    write: function (writable) {
      data += writable;
      if (!--writePending) {
        _this.redis.connection.write(data);
      }
    }
  };
  for (var i = 0; i < this._queue.length; ++i) {
    if (this._queue[i] instanceof Command) {
      this.redis.sendCommand(this._queue[i], stream);
    }
  }

  return this.promise.nodeify(callback);
};

module.exports = Pipeline;
