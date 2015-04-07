describe('scripting', function () {
  describe('#numberOfKeys', function () {
    it('should recognize the numberOfKeys property', function (done) {
      var redis = new Redis();

      redis.defineCommand('test', {
        numberOfKeys: 2,
        lua: 'return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}'
      });

      redis.test('k1', 'k2', 'a1', 'a2', function (err, result) {
        expect(result).to.eql(['k1', 'k2', 'a1', 'a2']);
        done();
      });
    });

    it('should support dynamic key count', function (done) {
      var redis = new Redis();

      redis.defineCommand('test', {
        lua: 'return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}'
      });

      redis.test(2, 'k1', 'k2', 'a1', 'a2', function (err, result) {
        expect(result).to.eql(['k1', 'k2', 'a1', 'a2']);
        done();
      });
    });

    it('should throw when numberOfKeys is omit', function (done) {
      var redis = new Redis();

      redis.defineCommand('test', {
        lua: 'return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}'
      });

      redis.test('k1', 'k2', 'a1', 'a2', function (err, result) {
        expect(err).to.be.instanceof(Error);
        expect(err.toString()).to.match(/`numberOfKeys` is not defined/);
        done();
      });
    });
  });

  it('should have a buffer version', function (done) {
    var redis = new Redis();

    redis.defineCommand('test', {
      numberOfKeys: 2,
      lua: 'return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}'
    });

    redis.testBuffer('k1', 'k2', 'a1', 'a2', function (err, result) {
      expect(result).to.eql([new Buffer('k1'), new Buffer('k2'), new Buffer('a1'), new Buffer('a2')]);
      done();
    });
  });

  it('should work well with pipeline', function (done) {
    var redis = new Redis();

    redis.defineCommand('test', {
      numberOfKeys: 1,
      lua: 'return redis.call("get", KEYS[1])'
    });

    redis.pipeline().set('test', 'pipeline').test('test').exec(function (err, results) {
      expect(results).to.eql([[null, 'OK'], [null, 'pipeline']]);
      done();
    });
  });

  it('should following pipeline style when throw', function (done) {
    var redis = new Redis();

    redis.defineCommand('test', {
      lua: 'return redis.call("get", KEYS[1])'
    });

    redis.pipeline().set('test', 'pipeline').test('test').exec(function (err, results) {
      expect(err).to.eql(null);
      expect(results[1][0]).to.be.instanceof(Error);
      expect(results[1][0].toString()).to.match(/`numberOfKeys` is not defined/);
      done();
    });
  });

  it('should use evalsha when script is loaded', function (done) {
    var redis = new Redis();

    redis.on('ready', function () {
      redis.defineCommand('test', {
        lua: 'return 1'
      });
      redis.monitor(function (err, monitor) {
        monitor.on('monitor', function (_, command) {
          expect(command[0]).to.eql('evalsha');
          monitor.disconnect();
          done();
        });
        redis.test(0);
      });
    });
  });

  it('should reload custom commands after script flush', function (done) {
    var redis = new Redis();

    redis.defineCommand('test', {
      numberOfKeys: 1,
      lua: 'return redis.call("get", KEYS[1])'
    });

    redis.script('flush', function (err, result) {
      expect(err).to.eql(null);
      console.log(result);
      redis.set('foo', 'bar');
      redis.test('foo', function (err, result) {
        expect(result).to.eql('bar');
        done();
      });
    });
  });
});
