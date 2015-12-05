'use strict';

var Readable = require('stream').Readable;

describe('*scanStream', function () {
  describe('scanStream', function () {
    it('should return a readable stream', function () {
      var redis = new Redis();
      var stream = redis.scanStream();
      expect(stream instanceof Readable).to.eql(true);
    });

    it('should iterate all keys', function (done) {
      var keys = [];
      var redis = new Redis();
      redis.mset('foo1', 1, 'foo2', 1, 'foo3', 1, 'foo4', 1, 'foo10', 1, function () {
        var stream = redis.scanStream();
        stream.on('data', function (data) {
          keys = keys.concat(data);
        });
        stream.on('end', function () {
          expect(keys.sort()).to.eql(['foo1', 'foo10', 'foo2', 'foo3', 'foo4']);
          done();
        });
      });
    });

    it('should recognize `MATCH`', function (done) {
      var keys = [];
      var redis = new Redis();
      redis.mset('foo1', 1, 'foo2', 1, 'foo3', 1, 'foo4', 1, 'foo10', 1, function () {
        var stream = redis.scanStream({
          match: 'foo??'
        });
        stream.on('data', function (data) {
          keys = keys.concat(data);
        });
        stream.on('end', function () {
          expect(keys).to.eql(['foo10']);
          done();
        });
      });
    });

    it('should recognize `COUNT`', function (done) {
      var keys = [];
      var redis = new Redis();
      stub(Redis.prototype, 'scan', function (args) {
        var count;
        for (var i = 0; i < args.length; ++i) {
          if (typeof args[i] === 'string' && args[i].toUpperCase() === 'COUNT') {
            count = args[i + 1];
            break;
          }
        }
        Redis.prototype.scan.restore();
        Redis.prototype.scan.apply(this, arguments);
        expect(count).to.eql(2);
      });
      redis.mset('foo1', 1, 'foo2', 1, 'foo3', 1, 'foo4', 1, 'foo10', 1, function () {
        var stream = redis.scanStream({
          count: 2
        });
        stream.on('data', function (data) {
          keys = keys.concat(data);
        });
        stream.on('end', function () {
          expect(keys.sort()).to.eql(['foo1', 'foo10', 'foo2', 'foo3', 'foo4']);
          done();
        });
      });
    });

    it('should emit an error when connection is down', function (done) {
      var keys = [];
      var redis = new Redis();
      redis.mset('foo1', 1, 'foo2', 1, 'foo3', 1, 'foo4', 1, 'foo10', 1, function () {
        redis.disconnect();
        var stream = redis.scanStream({ count: 1 });
        stream.on('data', function (data) {
          keys = keys.concat(data);
        });
        stream.on('error', function (err) {
          expect(err.message).to.eql('Connection is closed.');
          done();
        });
      });
    });
  });

  describe('scanBufferStream', function () {
    it('should return buffer', function (done) {
      var keys = [];
      var redis = new Redis();
      redis.mset('foo1', 1, 'foo2', 1, 'foo3', 1, 'foo4', 1, 'foo10', 1, function () {
        var stream = redis.scanBufferStream();
        stream.on('data', function (data) {
          keys = keys.concat(data);
        });
        stream.on('end', function () {
          expect(keys.sort()).to.eql([new Buffer('foo1'), new Buffer('foo10'),
            new Buffer('foo2'), new Buffer('foo3'), new Buffer('foo4')]);
          done();
        });
      });
    });
  });

  describe('sscanStream', function () {
    it('should iterate all values in the set', function (done) {
      var keys = [];
      var redis = new Redis();
      redis.sadd('set', 'foo1', 'foo2', 'foo3', 'foo4', 'foo10', function () {
        var stream = redis.sscanStream('set', { match: 'foo??' });
        stream.on('data', function (data) {
          keys = keys.concat(data);
        });
        stream.on('end', function () {
          expect(keys).to.eql(['foo10']);
          done();
        });
      });
    });
  });

  describe('Cluster', function () {
    it('should work in cluster mode', function (done) {
      var slotTable = [
        [0, 5460, ['127.0.0.1', 30001]],
        [5461, 10922, ['127.0.0.1', 30002]],
        [10923, 16383, ['127.0.0.1', 30003]]
      ];
      var serverKeys = ['foo1', 'foo2', 'foo3', 'foo4', 'foo10'];
      var argvHandler = function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
        if (argv[0] === 'sscan' && argv[1] === 'set') {
          var cursor = Number(argv[2]);
          if (cursor >= serverKeys.length) {
            return ['0', []];
          }
          return [String(cursor + 1), [serverKeys[cursor]]];
        }
      };
      var node1 = new MockServer(30001, argvHandler);
      var node2 = new MockServer(30002, argvHandler);
      var node3 = new MockServer(30003, argvHandler);

      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' }
      ]);

      var keys = [];
      cluster.sadd('set', serverKeys, function () {
        var stream = cluster.sscanStream('set');
        stream.on('data', function (data) {
          keys = keys.concat(data);
        });
        stream.on('end', function () {
          expect(keys).to.eql(serverKeys);
          cluster.disconnect();
          disconnect([node1, node2, node3], done);
        });
      });

    });
  });
});

function disconnect(clients, callback) {
  var pending = 0;

  for (var i = 0; i < clients.length; ++i) {
    pending += 1;
    clients[i].disconnect(check);
  }

  function check() {
    if (!--pending && callback) {
      callback();
    }
  }
}
