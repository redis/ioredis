'use strict';

var net = require('net');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var enableDestroy = require('server-destroy');
var Parser = require('../../lib/parsers/javascript');

function MockServer (port, handler) {
  EventEmitter.call(this);

  this.port = port;
  this.handler = handler;

  this.clients = [];

  this.connect();
}

util.inherits(MockServer, EventEmitter);

MockServer.prototype.connect = function () {
  var _this = this;
  this.socket = net.createServer(function (c) {
    var clientIndex = _this.clients.push(c) - 1;
    process.nextTick(function () {
      _this.emit('connect', c);
    });

    var parser = new Parser({ returnBuffer: false });
    parser.on('reply', function (args) {
      if (_this.handler) {
        _this.write(c, _this.handler(args));
      } else {
        _this.write(c, MockServer.REDIS_OK);
      }
    });

    c.on('end', function () {
      _this.clients[clientIndex] = null;
      _this.emit('disconnect', c);
    });

    c.on('data', function (data) {
      parser.execute(data);
    });
  });

  this.socket.listen(this.port);
  enableDestroy(this.socket);
};

MockServer.prototype.disconnect = function (callback) {
  this.socket.destroy(callback);
};

MockServer.prototype.broadcast = function (data) {
  for (var i = 0; i < this.clients.length; ++i) {
    if (this.clients[i]) {
      this.write(this.clients[i], data);
    }
  }
};

MockServer.prototype.write = function (c, data) {
  if (c.writable) {
    c.write(convert('', data));
  }

  function convert(str, data) {
    var result;
    if (typeof data === 'undefined') {
      data = MockServer.REDIS_OK;
    }
    if (data === MockServer.REDIS_OK) {
      result = '+OK\r\n';
    } else if (data instanceof Error) {
      result = '-' + data.message + '\r\n';
    } else if (Array.isArray(data)) {
      result = '*' + data.length + '\r\n';
      data.forEach(function (item) {
        result += convert(str, item);
      });
    } else if (typeof data === 'number') {
      result = ':' + data + '\r\n';
    } else if (data === null) {
      result = '$-1\r\n';
    } else {
      data = data.toString();
      result = '$' + data.length + '\r\n';
      result += data + '\r\n';
    }
    return str + result;
  }
};

MockServer.REDIS_OK = '+OK';

module.exports = MockServer;
