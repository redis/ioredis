'use strict';

var _ = require('lodash');
var net = require('net');
var tls = require('tls');
var utils = require('../utils');

var MAX_BUFFER_SIZE = 4 * 1024 * 1024;  // 4 mb
var MAX_QUEUED = 100;  // appears to be a good number after testing

function Connector(options) {
  this.options = options;

  if (options.path) {
    this.connectionOptions = _.pick(options, ['path']);
  } else {
    this.connectionOptions = _.pick(options, ['port', 'host', 'family']);
  }
  if (options.tls) {
    _.assign(this.connectionOptions, options.tls);
  }

  // auto pipeline props
  this.pipelineBuffer = '';
  this.pipelineQueued = 0;
  this.pipelineImmediate = null;
}

Connector.prototype.check = function () {
  return true;
};

/**
 * Proxy stream writer for auto-pipeline.
 * @param str usual stream.write arg
 * @param forceWrite set to true when calling write to force pipeline bypass
 */
Connector.prototype.write = function (str, forceWrite) {
  this.pipelineBuffer += str;
  this.pipelineQueued++;

  // queue the write for the next event loop if this is the first write issued
  if (this.pipelineQueued < 2) {
    this.pipelineImmediate = setImmediate(this.writePipeline.bind(this));
  }

  // write pipeline if limits have been exceeded or this is a forced write
  if (forceWrite || this.pipelineQueued > MAX_QUEUED || this.pipelineBuffer.length > MAX_BUFFER_SIZE) {
    clearImmediate(this.pipelineImmediate);
    this.writePipeline();
  }
};

/**
 * Writes the buffered pipelines and resets counts and buffer.
 */
Connector.prototype.writePipeline = function () {
  this.stream._stream.write(this.pipelineBuffer);
  this.pipelineBuffer = '';
  this.pipelineQueued = 0;
};

Connector.prototype.disconnect = function () {
  this.connecting = false;
  if (this.stream) {
    this.stream.end();
  }
};

Connector.prototype.connect = function (callback) {
  var _this = this;
  this.connecting = true;

  process.nextTick(function () {
    if (!_this.connecting) {
      callback(new Error(utils.CONNECTION_CLOSED_ERROR_MSG));
      return;
    }

    var stream;

    if (_this.options.tls) {
      stream = tls.connect(_this.connectionOptions);
    } else {
      stream = net.createConnection(_this.connectionOptions);
    }

    // create a fake stream so we can intercept write without overriding it
    // sometimes on tear-down 'stream' is undefined so added a check
    if (stream) {
      _this.stream = {
        _stream: stream,
        writable: stream.writable,
        on: stream.on.bind(stream),
        end: stream.end.bind(stream),
        remotePort: stream.remotePort,
        once: stream.once.bind(stream),
        write: _this.write.bind(_this),
        remoteAddress: stream.remoteAddress,
        destroy: stream.destroy.bind(stream),
        _writableState: stream._writableState,
        setTimeout: stream.setTimeout.bind(stream),
        setKeepAlive: stream.setKeepAlive.bind(stream),
        removeListener: stream.removeListener.bind(stream),
        removeAllListeners: stream.removeAllListeners.bind(stream)
      };
    }

    callback(null, _this.stream);
  });
};

module.exports = Connector;
