'use strict';

/**
 * Tiny class to simplify dealing with subscription set
 *
 * @constructor
 * @private
 */
function SubscriptionSet() {
  this.set = {
    subscribe: {},
    psubscribe: {}
  };
}

SubscriptionSet.prototype.add = function (set, channel) {
  this.set[mapSet(set)][channel] = true;
};

SubscriptionSet.prototype.del = function (set, channel) {
  delete this.set[mapSet(set)][channel];
};

SubscriptionSet.prototype.channels = function (set) {
  return Object.keys(this.set[mapSet(set)]);
};

SubscriptionSet.prototype.isEmpty = function () {
  return this.channels('subscribe').length === 0 && this.channels('psubscribe').length === 0;
};

function mapSet(set) {
  if (set === 'unsubscribe') {
    return 'subscribe';
  }
  if (set === 'punsubscribe') {
    return 'psubscribe';
  }
  return set;
}

module.exports = SubscriptionSet;
