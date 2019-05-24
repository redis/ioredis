'use strict';

const {Socket} = require('net')

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
    stub(redis, 'sendCommand').callsFake(command => {
      times += 1;
      if (times === 1) {
        expect(command.name).to.eql('auth');
      } else if (times === 2) {
        expect(command.name).to.eql('info');
        redis.disconnect();
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
      redis.disconnect();
      done();
    });
  });

  describe('connectTimeout', () => {
    it('should close the connection when timeout', function (done) {
      var redis = new Redis(6379, '192.0.0.0', {
        connectTimeout: 1,
        retryStrategy: null
      });
      var pending = 2;
      redis.on('error', function (err) {
        expect(err.message).to.eql('connect ETIMEDOUT');
        if (!--pending) {
          done();
        }
      });
      redis.get('foo', function (err) {
        expect(err.message).to.match(/Connection is closed/);
        if (!--pending) {
          redis.disconnect();
          done();
        }
      });
    });

    it('should clear the timeout when connected', function (done) {
      const connectTimeout = 10000
      var redis = new Redis({connectTimeout});
      var set = false
      stub(Socket.prototype, 'setTimeout').callsFake(timeout => {
        if (timeout === connectTimeout) {
          set = true;
          return;
        }
        expect(set).to.eql(true);
        expect(timeout).to.eql(0);
        Socket.prototype.setTimeout.restore();
        redis.disconnect();
        done();
      });
    });

    it('should ignore timeout if connect', function (done) {
      var redis = new Redis({
        port: 6379,
        connectTimeout: 500,
        retryStrategy: null
      });
      let isReady = false
      let timedoutCalled = false
      stub(Socket.prototype, 'setTimeout').callsFake((timeout, callback) => {
        if (timeout === 0) {
          if (!isReady) {
            isReady = true
          } else {
            timedoutCalled = true
          }
          return
        }

        setTimeout(() => {
          callback()
          expect(timedoutCalled).to.eql(false)
          redis.disconnect();
          done();
        }, timeout)
      });
    });
  })

  describe('#connect', function () {
    it('should return a promise', function (done) {
      var pending = 2;
      var redis = new Redis({lazyConnect: true});
      redis.connect().then(function () {
        redis.disconnect();
        if (!--pending) {
          done();
        }
      });

      var redis2 = new Redis(6390, {lazyConnect: true, retryStrategy: null});
      redis2.connect().catch(function () {
        if (!--pending) {
          redis2.disconnect();
          done();
        }
      });
    });

    it('should stop reconnecting when disconnected', function (done) {
      var redis = new Redis(8999, {
        retryStrategy: function () {
          return 0;
        }
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
        redis.disconnect()
        done();
      });
    });

    it('should resolve when the status become ready', function (done) {
      var redis = new Redis({lazyConnect: true});
      redis.connect().then(function () {
        expect(redis.status).to.eql('ready');
        redis.disconnect()
        done();
      });
    });

    it('should reject when closed (reconnecting)', function (done) {
      var redis = new Redis({
        port: 8989,
        lazyConnect: true,
        retryStrategy: function () {
          return 0;
        }
      });

      redis.connect().catch(function () {
        expect(redis.status).to.eql('reconnecting');
        redis.disconnect()
        done();
      });
    });

    it('should reject when closed (end)', function (done) {
      var redis = new Redis({
        port: 8989,
        lazyConnect: true,
        retryStrategy: false
      });

      redis.connect().catch(function () {
        expect(redis.status).to.eql('end');
        redis.disconnect()
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
            redis.disconnect()
            done();
          });
          return null;
        }
      });
    });

    it('should skip reconnecting if quitting before connecting', function (done) {
      var count = 0;
      var redis = new Redis({
        port: 8999,
        retryStrategy: function () {
          count++;
        }
      });

      redis.quit().then(function (result) {
        expect(result).to.eql('OK');
        expect(count).to.eql(0);
        redis.disconnect()
        done();
      });
    });

    it('should skip reconnecting if quitting before connecting (buffer)', function (done) {
      var redis = new Redis({
        port: 8999,
        retryStrategy: function () {
          count++;
        }
      });

      redis.quitBuffer().then(function (result) {
        expect(result).to.be.instanceof(Buffer);
        expect(result.toString()).to.eql('OK');
        redis.disconnect()
        done();
      });
    });
  });

  describe('connectionName', function () {
    it('should name the connection if options.connectionName is not null', function (done) {
      var redis = new Redis({connectionName: 'niceName'});
      redis.once('ready', function () {
        redis.client('getname', function (err, res) {
          expect(res).to.eql('niceName');
          redis.disconnect()
          done();
        });
      });
      redis.set('foo', 1);
    });

    it('should set the name before any subscribe command if reconnected', function (done) {
      var redis = new Redis({connectionName: 'niceName'});
      redis.once('ready', function () {
        redis.subscribe('l', function () {
          redis.disconnect(true);
          redis.unsubscribe('l', function () {
            redis.client('getname', function (err, res) {
              expect(res).to.eql('niceName');
              redis.disconnect()
              done();
            });
          });
        });
      });
    });
  });

  describe('readOnly', function () {
    it('should send readonly command before other commands', function (done) {
      var called = false;
      var redis = new Redis({port: 30001, readOnly: true, showFriendlyErrorStack: true});
      var node = new MockServer(30001, function (argv) {
        if (argv[0] === 'readonly') {
          called = true;
        } else if (argv[0] === 'get' && argv[1] === 'foo') {
          expect(called).to.eql(true);
          redis.disconnect();
          node.disconnect(function () {
            done();
          });
        }
      });
      redis.get('foo').catch(function () {});
    });
  });

  describe('autoResendUnfulfilledCommands', function () {
    it('should resend unfulfilled commands to the correct db when reconnected', function (done) {
      var redis = new Redis({db: 3});
      var pub = new Redis({db: 3});
      redis.once('ready', function () {
        var pending = 2;
        redis.blpop('l', 0, function (err, res) {
          expect(res[0]).to.eql('l');
          expect(res[1]).to.eql('1');
          if (!--pending) {
            redis.disconnect()
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
      var redis = new Redis({db: 4});
      var pub = new Redis({db: 4});
      redis.once('ready', function () {
        pub.pubsub('channels', function (err, channelsBefore) {
          redis.subscribe('l', function () {
            redis.disconnect(true);
            redis.unsubscribe('l', function () {
              pub.pubsub('channels', function (err, channels) {
                expect(channels.length).to.eql(channelsBefore.length);
                redis.disconnect()
                done();
              });
            });
          });
        });
      });
    });
  });
});
