'use strict';

var Readable = require('stream').Readable;
var util = require('util');

/**
 * Convenient class to convert the process of scaning keys to a readable stream.
 *
 * @constructor
 * @private
 */
function ScanStream(opt) {
  Readable.call(this, opt);
  this._redisCursor = '0';
  this.opt = opt;
}

util.inherits(ScanStream, Readable);

ScanStream.prototype._read = function () {
  if (this._redisDrained) {
    this.push(null);
    return;
  }
  var args = [this._redisCursor];
  if (this.opt.key) {
    args.unshift(this.opt.key);
  }
  if (this.opt.match) {
    args.push('MATCH', this.opt.match);
  }
  if (this.opt.count) {
    args.push('COUNT', this.opt.count);
  }
  var _this = this;
  this.opt.redis[this.opt.command](args, function (err, res) {
    if (err) {
      _this.emit('error', err);
      return;
    }
    _this._redisCursor = (res[0] instanceof Buffer) ? res[0].toString() : res[0];
    if (_this._redisCursor === '0') {
      _this._redisDrained = true;
    }
    _this.push(res[1]);
  });
};

ScanStream.prototype.close = function() {
  this._redisDrained = true;
};

module.exports = ScanStream;
