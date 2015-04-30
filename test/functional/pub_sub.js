'use strict';

describe('pub/sub', function () {
  it('should invoke the callback when subscribe successfully', function (done) {
    var redis = new Redis();
    var pending = 1;
    redis.subscribe('foo', 'bar', function (err, count) {
      expect(count).to.eql(2);
      pending -= 1;
    });
    redis.subscribe('foo', 'zoo', function (err, count) {
      expect(count).to.eql(3);
      expect(pending).to.eql(0);
      redis.disconnect();
      done();
    });
  });

  it('should reject when issue a command in the subscriber mode', function (done) {
    var redis = new Redis();
    redis.subscribe('foo', function () {
      redis.set('foo', 'bar', function (err) {
        expect(err instanceof Error);
        expect(err.toString()).to.match(/subscriber mode/);
        redis.disconnect();
        done();
      });
    });
  });

  it('should exit subscriber mode using unsubscribe', function (done) {
    var redis = new Redis();
    redis.subscribe('foo', 'bar', function () {
      redis.unsubscribe('foo', 'bar', function (err, count) {
        expect(count).to.eql(0);
        redis.set('foo', 'bar', function (err) {
          expect(err).to.eql(null);

          redis.subscribe('zoo', 'foo', function () {
            redis.unsubscribe(function (err, count) {
              expect(count).to.eql(0);
              redis.set('foo', 'bar', function (err) {
                expect(err).to.eql(null);
                redis.disconnect();
                done();
              });
            });
          });
        });
      });
    });
  });

  it('should receive messages when subscribe a channel', function (done) {
    var redis = new Redis();
    var pub = new Redis();
    var pending = 2;
    redis.subscribe('foo', function () {
      pub.publish('foo', 'bar');
    });
    redis.on('message', function (channel, message) {
      expect(channel).to.eql('foo');
      expect(message).to.eql('bar');
      if (!--pending) {
        redis.disconnect();
        done();
      }
    });
    redis.on('messageBuffer', function (channel, message) {
      expect(channel).to.be.instanceof(Buffer);
      expect(channel.toString()).to.eql('foo');
      expect(message).to.be.instanceof(Buffer);
      expect(message.toString()).to.eql('bar');
      if (!--pending) {
        redis.disconnect();
        done();
      }
    });
  });

  it('should receive messages when psubscribe a pattern', function (done) {
    var redis = new Redis();
    var pub = new Redis();
    var pending = 2;
    redis.psubscribe('f?oo', function () {
      pub.publish('fzoo', 'bar');
    });
    redis.on('pmessage', function (pattern, channel, message) {
      expect(pattern).to.eql('f?oo');
      expect(channel).to.eql('fzoo');
      expect(message).to.eql('bar');
      if (!--pending) {
        redis.disconnect();
        pub.disconnect();
        done();
      }
    });
    redis.on('pmessageBuffer', function (pattern, channel, message) {
      expect(pattern).to.eql('f?oo');
      expect(channel).to.be.instanceof(Buffer);
      expect(channel.toString()).to.eql('fzoo');
      expect(message).to.be.instanceof(Buffer);
      expect(message.toString()).to.eql('bar');
      if (!--pending) {
        redis.disconnect();
        pub.disconnect();
        done();
      }
    });
  });

  it('should exit subscriber mode using punsubscribe', function (done) {
    var redis = new Redis();
    redis.psubscribe('f?oo', 'b?ar', function () {
      redis.punsubscribe('f?oo', 'b?ar', function (err, count) {
        expect(count).to.eql(0);
        redis.set('foo', 'bar', function (err) {
          expect(err).to.eql(null);

          redis.psubscribe('z?oo', 'f?oo', function () {
            redis.punsubscribe(function (err, count) {
              expect(count).to.eql(0);
              redis.set('foo', 'bar', function (err) {
                expect(err).to.eql(null);
                redis.disconnect();
                done();
              });
            });
          });
        });
      });
    });
  });

  it('should be able to send quit command in the subscriber mode', function (done) {
    var redis = new Redis();
    var pending = 1;
    redis.subscribe('foo', function () {
      redis.quit(function () {
        pending -= 1;
      });
    });
    redis.on('end', function () {
      expect(pending).to.eql(0);
      redis.disconnect();
      done();
    });
  });

  it('should restore subscription after reconnecting(subscribe)', function (done) {
    var redis = new Redis();
    var pub = new Redis();
    redis.subscribe('foo', 'bar', function () {
      redis.on('ready', function () {
        var pending = 2;
        redis.on('message', function (channel, message) {
          if (!--pending) {
            redis.disconnect();
            pub.disconnect();
            done();
          }
        });
        pub.publish('foo', 'hi1');
        pub.publish('bar', 'hi2');
      });
      redis.disconnect({ reconnect: true });
    });
  });

  it('should restore subscription after reconnecting(psubscribe)', function (done) {
    var redis = new Redis();
    var pub = new Redis();
    redis.psubscribe('fo?o', 'ba?r', function () {
      redis.on('ready', function () {
        var pending = 2;
        redis.on('pmessage', function (pattern, channel, message) {
          if (!--pending) {
            redis.disconnect();
            pub.disconnect();
            done();
          }
        });
        pub.publish('fo1o', 'hi1');
        pub.publish('ba1r', 'hi2');
      });
      redis.disconnect({ reconnect: true });
    });
  });
});
