'use strict';

describe('connection', function () {
  it('should emit "connect" when connected', function (done) {
    var redis = new Redis();
    redis.on('connect', function () {
      redis.disconnect();
      done();
    });
  });

  it('should emit "close" when disconnected', function (done) {
    var redis = new Redis();
    redis.once('end', done);
    redis.once('connect', function () {
      redis.disconnect();
    });
  });

  it('should send AUTH command before any other commands', function (done) {
    var redis = new Redis({ password: '123' });
    redis.get('foo');
    var times = 0;
    stub(redis, 'sendCommand', function (command) {
      times += 1;
      if (times === 1) {
        expect(command.name).to.eql('auth');
      } else if (times === 2) {
        expect(command.name).to.eql('info');
        done();
      }
    });
  });

  it('should receive replies after connection is disconnected', function (done) {
    var redis = new Redis();
    redis.set('foo', 'bar', function () {
      redis.stream.end();
    });
    redis.get('foo', function (err, res) {
      expect(res).to.eql('bar');
      done();
    });
  });

  it('should close the connection when timeout', function (done) {
    var redis = new Redis(6379, '192.0.0.0', {
      connectTimeout: 1,
      retryStrategy: null
    });
    redis.get('foo', function (err) {
      expect(err.message).to.match(/Connection is closed/);
      done();
    });
  });

  it('should clear the timeout when connected', function (done) {
    var redis = new Redis({ connectTimeout: 10000 });
    setImmediate(function () {
      stub(redis.stream, 'setTimeout', function (timeout) {
        expect(timeout).to.eql(0);
        redis.stream.setTimeout.restore();
        done();
      });
    });
  });

  describe('#connect', function () {
    it('should return a promise', function (done) {
      var pending = 2;
      var redis = new Redis({ lazyConnect: true });
      redis.connect().then(function () {
        redis.disconnect();
        if (!--pending) {
          done();
        }
      });

      var redis2 = new Redis(6390, { lazyConnect: true, retryStrategy: null });
      redis2.connect().catch(function (err) {
        if (!--pending) {
          redis2.disconnect();
          done();
        }
      });
    });

    it('should stop reconnecting when disconnected', function (done) {
      var redis = new Redis(8999, {
        retryStrategy: function () { return 0; }
      });

      redis.on('close', function () {
        redis.disconnect();
        stub(Redis.prototype, 'connect').throws(new Error('`connect` should not be called'));
        setTimeout(function () {
          Redis.prototype.connect.restore();
          done();
        }, 1);
      });
    });

    it('should reject when connected', function (done) {
      var redis = new Redis();
      redis.connect().catch(function (err) {
        expect(err.message).to.match(/Redis is already connecting/);
        done();
      });
    });
  });

  describe('retryStrategy', function () {
    it('should pass the correct retry times', function (done) {
      var t = 0;
      new Redis({
        port: 1,
        retryStrategy: function (times) {
          expect(times).to.eql(++t);
          if (times === 3) {
            done();
            return;
          }
          return 0;
        }
      });
    });

    it('should skip reconnecting when retryStrategy doesn\'t return a number', function (done) {
      var redis = new Redis({
        port: 1,
        retryStrategy: function () {
          process.nextTick(function () {
            expect(redis.status).to.eql('end');
            done();
          });
          return null;
        }
      });
    });
  });

  describe('autoResendUnfulfilledCommands', function () {
    it('should resend unfulfilled commands to the correct db when reconnected', function (done) {
      var redis = new Redis({ db: 3 });
      var pub = new Redis({ db: 3 });
      redis.once('ready', function () {
        var pending = 2;
        redis.blpop('l', 0, function (err, res) {
          expect(res[0]).to.eql('l');
          expect(res[1]).to.eql('1');
          if (!--pending) {
            done();
          }
        });
        redis.set('foo', '1');
        redis.pipeline().incr('foo').exec(function (err, res) {
          expect(res[0][1]).to.eql(2);
          if (!--pending) {
            done();
          }
        });
        setTimeout(function () {
          redis.stream.end();
        }, 0);
      });
      redis.once('close', function () {
        pub.lpush('l', 1);
      });
    });
    it('should resend previous subscribes before sending unfulfilled commands', function (done) {
      var redis = new Redis({ db: 4 });
      var pub = new Redis({ db: 4 });
      redis.once('ready', function () {
        redis.subscribe('l', function() {
          redis.disconnect(true);
          redis.unsubscribe('l', function() {
            pub.pubsub('channels', function(err, channels){
              expect(channels.length).to.eql(0);
              done();
            });
          });
        });
      });
    });
  });
});
