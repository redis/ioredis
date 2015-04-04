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
      done();
    });
  });

  it('should reject when issue a command in the subscriber mode', function (done) {
    var redis = new Redis();
    redis.subscribe('foo', function () {
      redis.set('foo', 'bar', function (err) {
        expect(err instanceof Error);
        expect(err.toString()).to.match(/subscriber mode/);
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
                done();
              });
            });
          });
        });
      });
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
                done();
              });
            });
          });
        });
      });
    });
  });

  it('should able to send quit command in the subscriber mode', function (done) {
    var redis = new Redis();
    var pending = 1;
    redis.subscribe('foo', function () {
      redis.quit(function () {
        pending -= 1;
      });
    });
    redis.on('close', function () {
      expect(pending).to.eql(0);
      done();
    });
  });
});
