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
    redis.once('close', done);
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
    var redis = new Redis(6379, '192.0.0.0', { connectTimeout: 1 });
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
            expect(redis.status).to.eql('closed');
            done();
          });
          return null;
        }
      });
    });
  });
});
