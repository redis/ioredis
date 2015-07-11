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
          if (typeof args[i] === 'string', args[i].toUpperCase() === 'COUNT') {
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
          expect(keys.sort()).to.eql([new Buffer('foo1'), new Buffer('foo10'), new Buffer('foo2'), new Buffer('foo3'), new Buffer('foo4')]);
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
});
