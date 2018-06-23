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

  describe('Cluster', function () {
    it('should not call `connect` when init', function () {
      stub(Redis.Cluster.prototype, 'connect').throws(new Error('`connect` should not be called'));
      new Redis.Cluster([], { lazyConnect: true });
      Redis.Cluster.prototype.connect.restore();
    });

    it('should quit before "close" being emited', function (done) {
      stub(Redis.Cluster.prototype, 'connect').throws(new Error('`connect` should not be called'));
      var cluster = new Redis.Cluster([], { lazyConnect: true });
      cluster.quit(function () {
        cluster.once('close', function () {
          cluster.once('end', function () {
            Redis.Cluster.prototype.connect.restore();
            done();
          });
        });
      });
    });

    it('should disconnect before "close" being emited', function (done) {
      stub(Redis.Cluster.prototype, 'connect').throws(new Error('`connect` should not be called'));
      var cluster = new Redis.Cluster([], { lazyConnect: true });
      cluster.disconnect();
      cluster.once('close', function () {
        cluster.once('end', function () {
          Redis.Cluster.prototype.connect.restore();
          done();
        });
      });
    });

    it('should support disconnecting with reconnect', function (done) {
      stub(Redis.Cluster.prototype, 'connect').throws(new Error('`connect` should not be called'));
      var cluster = new Redis.Cluster([], {
        lazyConnect: true,
        clusterRetryStrategy: function () {
          return 1;
        }
      });
      cluster.disconnect(true);
      cluster.once('close', function () {
        Redis.Cluster.prototype.connect.restore();
        stub(Redis.Cluster.prototype, 'connect', function () {
          Redis.Cluster.prototype.connect.restore();
          done();
        });
      });
    });
  });
});
