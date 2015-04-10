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
  var str = '';
  if (data[0] === MockServer.REDIS_OK) {
    str = '+OK\r\n';
  } else if (data instanceof Error) {
    str = '-ERR ' + data.message + '\r\n';
  } else if (Array.isArray(data)) {
    str = '*' + data.length + '\r\n';
    data.forEach(function (item) {
      if (typeof item === 'number') {
        str += ':' + item + '\r\n';
      } else {
        item = item.toString();
        str += '$' + item.length + '\r\n';
        str += item + '\r\n';
      }
    });
  } else if (typeof data === 'number') {
    str += ':' + data + '\r\n';
  } else {
    data = data.toString();
    str += '$' + data.length + '\r\n';
    str += data + '\r\n';
  }
  c.write(str);
};

MockServer.REDIS_OK = '+OK';

module.exports = MockServer;
