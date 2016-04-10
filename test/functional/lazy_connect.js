'use strict';

describe('lazy connect', function () {
  it('should not call `connect` when init', function () {
    stub(Redis.prototype, 'connect').throws(new Error('`connect` should not be called'));
    new Redis({ lazyConnect: true });
    Redis.prototype.connect.restore();
  });

  it('should connect when calling a command', function (done) {
    var redis = new Redis({ lazyConnect: true });
    redis.set('foo', 'bar');
    redis.get('foo', function (err, result) {
      expect(result).to.eql('bar');
      done();
    });
  });

  it('should not try to reconnect when disconnected manually', function (done) {
    var redis = new Redis({ lazyConnect: true });
    redis.get('foo', function () {
      redis.disconnect();
      redis.get('foo', function (err) {
        expect(err.message).to.match(/Connection is closed/);
        done();
      });
    });
  });

  it('should be able to disconnect', function (done) {
    var redis = new Redis({ lazyConnect: true });
    redis.on('end', function () {
      done();
    });
    redis.disconnect();
  });
});
