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
    var redis = new Redis({ auth: '123' });
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
      redis.connection.destroy();
    });
    redis.get('foo', function (err, res) {
      expect(res).to.eql('bar');
      done();
    });
  });
});
