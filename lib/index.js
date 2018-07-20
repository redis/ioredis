'use strict';

exports = module.exports = require('./redis');

exports.ReplyError = require('redis-errors').ReplyError;
exports.Cluster = require('./cluster');
exports.Command = require('./command');
exports.ScanStream = require('./ScanStream').default;

var PromiseContainer = require('./promiseContainer');
Object.defineProperty(exports, 'Promise', {
  get: function() {
    return PromiseContainer.get();
  },
  set: function(lib) {
    PromiseContainer.set(lib);
  }
});

exports.print = function (err, reply) {
  if (err) {
    console.log('Error: ' + err);
  } else {
    console.log('Reply: ' + reply);
  }
};
