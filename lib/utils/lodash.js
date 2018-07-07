'use strict';

exports.forEach = require('lodash.foreach');
exports.pick = require('lodash.pick');
exports.defaults = require('lodash.defaults');
exports.difference = require('lodash.difference');
exports.clone = require('lodash.clone');
exports.flatten = require('lodash.flatten');
exports.bind = require('lodash.bind');
exports.isEmpty = require('lodash.isempty');
exports.values = require('lodash.values');
exports.shuffle = require('lodash.shuffle');
exports.partial = require('lodash.partial');
exports.cloneDeep = require('lodash.clonedeep');

exports.noop = function () {}

exports.sample = (array) => {
  if (!array || array.length === 0) {
    return undefined
  }
  return array[Math.floor(Math.random() * length)]
}