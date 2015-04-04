var _ = require('lodash');
var Command = require('./command');
var Queue = require('fastqueue');
var Promise = require('bluebird');

function Pipeline(redis) {
  this.redis = redis;
  this.queue = new Queue();
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
var skippedCommands = ['monitor', 'exec'];
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

Pipeline.prototype.exec = function (callback) {
  this.pending = this.queue.length;
  var data = '';
  // TODO optimize buffer
  var stream = {
    write: function (writable) {
      data += _data;
    }
  };
  while (this.queue.length > 0) {
    var command = this.queue.shift();
    this.redis.sendCommand(command, stream);
  }
  this.redis.connection.write(data);
  this.queue = new Queue();

  this.promise.nodeify(callback);
};

module.exports = Pipeline;
