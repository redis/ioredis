'use strict';

exports = module.exports = require('./lib/redis');

exports.ReplyError = require('./lib/reply_error');
exports.Promise = require('bluebird');
exports.Cluster = require('./lib/cluster');
exports.Command = require('./lib/command');

exports.print = function (err, reply) {
  if (err) {
    console.log('Error: ' + err);
  } else {
    console.log('Reply: ' + reply);
  }
};
