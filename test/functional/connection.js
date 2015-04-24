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
    redis.disconnect();
  });

  it('should send AUTH command before any other commands', function (done) {
    var redis = new Redis({ password: '123' });
    redis.get('foo');
    var times = 0;
    var sendCommand = stub(redis, 'sendCommand', function (command) {
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
      redis.connection.end();
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
    stub(redis.connection, 'setTimeout', function (timeout) {
      expect(timeout).to.eql(0);
      redis.connection.setTimeout.restore();
      done();
    });
  });
});
