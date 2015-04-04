/**
 * Tiny class to simplify dealing with subscription queue
 *
 * @constructor
 * @private
 */
function SubscriptionQueue () {
  this.queue = {
    subscribe: {},
    psubscribe: {},
    unsubscribe: {},
    punsubscribe: {}
  };
}

SubscriptionQueue.prototype.push = function (queue, channel, item) {
  if (!this.queue[queue][channel]) {
    this.queue[queue][channel] = [item];
  } else {
    this.queue[queue][channel].push(item);
  }
};

SubscriptionQueue.prototype.shift = function (queue, channel) {
  if (!this.queue[queue][channel]) {
    return null;
  }
  var result = this.queue[queue][channel].shift();
  if (this.queue[queue][channel].length === 0) {
    delete this.queue[queue][channel];
  }
  return result;
};

module.exports = SubscriptionQueue;
