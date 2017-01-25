'use strict';

var Deque = require('denque');
var debug = require('debug')('ioredis:delayqueue');

function DelayQueue() {
  this.queues = {};
  this.timeouts = {};
}

DelayQueue.prototype.push = function (bucket, item, options) {
  var callback = options.callback || process.nextTick;
  if (!this.queues[bucket]) {
    this.queues[bucket] = new Deque();
  }

  var queue = this.queues[bucket];
  queue.push(item);

  if (!this.timeouts[bucket]) {
    var _this = this;
    this.timeouts[bucket] = setTimeout(function () {
      callback(function () {
        _this.timeouts[bucket] = null;
        _this._execute(bucket);
      });
    }, options.timeout);
  }
};

DelayQueue.prototype._execute = function (bucket) {
  var queue = this.queues[bucket];
  if (!queue) {
    return;
  }
  var length = queue.length;
  if (!length) {
    return;
  }
  debug('send %d commands in %s queue', length, bucket);

  this.queues[bucket] = null;
  while (queue.length > 0) {
    queue.shift()();
  }
};

module.exports = DelayQueue;
