'use strict';

/*
Copyright (c) by NodeRedis
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
Originally developed by Matthew Ranney, http://ranney.com/
*/

var utils = require('../utils');
var ReplyError = require('../reply_error');

function ReplyParser() {
  this._buffer = new Buffer(0);
  this._offset = 0;
}

module.exports = ReplyParser;

var IncompleteReadBuffer = utils.extendsError('IncompleteReadBuffer');

ReplyParser.prototype._parseResult = function (type) {
  var start, end, offset, packetHeader;

  if (type === 43 || type === 45) { // + or -
    // up to the delimiter
    end = this._packetEndOffset() - 1;
    start = this._offset;

    if (end > this._buffer.length) {
      throw new IncompleteReadBuffer('Wait for more data.');
    }

    // include the delimiter
    this._offset = end + 2;

    if (type === 45) {
      return new ReplyError(this._buffer.toString('utf-8', start, end));
    }
    return this._buffer.slice(start, end);
  } else if (type === 58) { // :
    // up to the delimiter
    end = this._packetEndOffset() - 1;
    start = this._offset;

    if (end > this._buffer.length) {
      throw new IncompleteReadBuffer('Wait for more data.');
    }

    // include the delimiter
    this._offset = end + 2;

    // TODO number?
    // return the coerced numeric value
    return +this._buffer.toString('ascii', start, end);
  } else if (type === 36) { // $
    // set a rewind point, as the packet could be larger than the
    // buffer in memory
    offset = this._offset - 1;

    packetHeader = this.parseHeader();

    // packets with a size of -1 are considered null
    if (packetHeader === -1) {
      return undefined;
    }

    end = this._offset + packetHeader;
    start = this._offset;

    if (end > this._buffer.length) {
      throw new IncompleteReadBuffer('Wait for more data.');
    }

    // set the offset to after the delimiter
    this._offset = end + 2;

    return this._buffer.slice(start, end);
  } else if (type === 42) { // *
    offset = this._offset;
    packetHeader = this.parseHeader();

    if (packetHeader < 0) {
      return null;
    }

    if (packetHeader > this._bytesRemaining()) {
      this._offset = offset - 1;
      throw new IncompleteReadBuffer('Wait for more data.');
    }

    var reply = [ ];
    var ntype, i, res;

    offset = this._offset - 1;

    for (i = 0; i < packetHeader; i++) {
      ntype = this._buffer[this._offset++];

      if (this._offset > this._buffer.length) {
        throw new IncompleteReadBuffer('Wait for more data.');
      }
      res = this._parseResult(ntype);
      if (res === undefined) {
        res = null;
      }
      reply.push(res);
    }

    return reply;
  }
};

ReplyParser.prototype.execute = function (buffer) {
  this.append(buffer);

  var type, ret, offset;

  while (true) {
    offset = this._offset;
    try {
      // at least 4 bytes: :1\r\n
      if (this._bytesRemaining() < 4) {
        break;
      }

      type = this._buffer[this._offset++];

      if (type === 43) { // Strings +
        ret = this._parseResult(type);

        if (ret === null) {
          break;
        }

        this.sendReply(ret);
      } else  if (type === 45) { // Errors -
        ret = this._parseResult(type);

        if (ret === null) {
          break;
        }

        this.sendError(ret);
      } else if (type === 58) { // Integers :
        ret = this._parseResult(type);

        if (ret === null) {
          break;
        }

        this.sendReply(ret);
      } else if (type === 36) { // Bulk strings $
        ret = this._parseResult(type);

        if (ret === null) {
          break;
        }

        // check the state for what is the result of
        // a -1, set it back up for a null reply
        if (ret === undefined) {
          ret = null;
        }

        this.sendReply(ret);
      } else if (type === 42) { // Arrays *
        // set a rewind point. if a failure occurs,
        // wait for the next execute()/append() and try again
        offset = this._offset - 1;

        ret = this._parseResult(type);

        this.sendReply(ret);
      }
    } catch (err) {
      // catch the error (not enough data), rewind, and wait
      // for the next packet to appear
      if (! (err instanceof IncompleteReadBuffer)) {
        throw err;
      }
      this._offset = offset;
      break;
    }
  }
};

ReplyParser.prototype.append = function (newBuffer) {
  if (!newBuffer) {
    return;
  }

  // out of data
  if (this._offset >= this._buffer.length) {
    this._buffer = newBuffer;
    this._offset = 0;
    return;
  }

  this._buffer = Buffer.concat([this._buffer.slice(this._offset), newBuffer]);
  this._offset = 0;
};

ReplyParser.prototype.parseHeader = function () {
  var end = this._packetEndOffset(),
    value = this._buffer.toString('ascii', this._offset, end - 1) | 0;

  this._offset = end + 1;

  return value;
};

ReplyParser.prototype._packetEndOffset = function () {
  var offset = this._offset;

  while (this._buffer[offset] !== 0x0d && this._buffer[offset + 1] !== 0x0a) {
    offset++;

    if (offset >= this._buffer.length) {
      throw new IncompleteReadBuffer('didn\'t see LF after NL reading multi bulk count (' +
        offset + ' => ' + this._buffer.length + ', ' + this._offset + ')');
    }
  }

  offset++;
  return offset;
};

ReplyParser.prototype._bytesRemaining = function () {
  return (this._buffer.length - this._offset) < 0 ? 0 : (this._buffer.length - this._offset);
};
