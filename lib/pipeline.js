var _ = require('lodash');
var Command = require('./command');
var Promise = require('bluebird');

function Pipeline(redis) {
  this.redis = redis;
  this.queue = [];
  this.result = [];

  var _this = this;
  this.promise = new Promise(function (resolve, reject) {
    _this.resolve = resolve;
    _this.reject = reject;
  });
}

Pipeline.prototype.fillResult = function (value, position) {
  this.result[position] = value;
  this.pending -= 1;
  if (this.pending === 0) {
    this.resolve(this.result);
  }
};

var commands = require('ioredis-commands');
var skippedCommands = ['monitor'];
_.keys(commands).forEach(function (command) {
  if (_.includes(skippedCommands, command)) {
    return;
  }
  command = command.toLowerCase();
  Pipeline.prototype[command] = function () {
    var args = _.toArray(arguments);
    var callback;
    if (typeof args[args.length - 1] === 'function') {
      callback = args.pop();
    }

    var _this = this;
    var position = this.queue.length;
    this.queue.push(new Command(command, args, 'utf8', function (err, result) {
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
    var position = this.queue.length;
    this.queue.push(new Command(command, args, null, function (err, result) {
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
  this.pending = this.queue.length;
  var data = '';
  // TODO optimize buffer
  var stream = {
    write: function (writable) {
      data += writable;
    }
  };
  for (var i = 0; i < this.queue.length; ++i) {
    this.redis.sendCommand(this.queue[i], stream);
  }
  this.redis.connection.write(data);

  return this.promise.nodeify(callback);
};

module.exports = Pipeline;
