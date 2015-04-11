var net = require('net');
var util = require('util');
var EventEmitter = require('events').EventEmitter;
var enableDestroy = require('server-destroy');

function MockServer (port, handler) {
  EventEmitter.call(this);

  var _this = this;
  this.socket = net.createServer(function (c) {
    _this.emit('connect', c);
    c.on('end', function () {
      _this.emit('disconnect', c);
    });

    c.on('data', function (data) {
      data = data.toString().split('\r\n').slice(2);
      var args = [];
      for (var i = 0; i < data.length; i += 2) {
        args.push(data[i]);
      }
      if (handler) {
        _this.write(c, handler(args));
      } else {
        _this.write(c, MockServer.REDIS_OK);
      }
    });
  });
  this.socket.listen(port);
  enableDestroy(this.socket);
}

util.inherits(MockServer, EventEmitter);

MockServer.prototype.disconnect = function (callback) {
  this.socket.destroy(callback);
};

MockServer.prototype.write = function (c, data) {
  c.write(convert('', data));

  function convert(str, data) {
    var result;
    if (typeof data === 'undefined') {
      data = MockServer.REDIS_OK;
    }
    if (data === MockServer.REDIS_OK) {
      result = '+OK\r\n';
    } else if (data instanceof Error) {
      result = '-ERR ' + data.message + '\r\n';
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
