'use strict';

describe('dropBufferSupport', function () {
  it('should be disabled by default', function () {
    var redis = new Redis({ lazyConnect: true });
    expect(redis.options).to.have.property('dropBufferSupport', false);
  });

  it('should return strings correctly', function (done) {
    var redis = new Redis({ dropBufferSupport: false });
    redis.set('foo', new Buffer('bar'), function (err, res) {
      expect(err).to.eql(null);
      expect(res).to.eql('OK');
      redis.get('foo', function (err, res) {
        expect(err).to.eql(null);
        expect(res).to.eql('bar');
        redis.disconnect();
        done();
      });
    });
  });

  context('enabled', function () {
    it('should reject the buffer commands', function (done) {
      var redis = new Redis({ dropBufferSupport: true });
      redis.getBuffer('foo', function (err) {
        expect(err.message).to.match(/Buffer methods are not available/);

        redis.callBuffer('get', 'foo', function (err) {
          expect(err.message).to.match(/Buffer methods are not available/);
          redis.disconnect();
          done();
        });
      });
    });

    it('should reject the custom buffer commands', function (done) {
      var redis = new Redis({ dropBufferSupport: true });
      redis.defineCommand('geteval', {
        numberOfKeys: 0,
        lua: 'return "string"'
      });
      redis.getevalBuffer(function (err) {
        expect(err.message).to.match(/Buffer methods are not available/);
        redis.disconnect();
        done();
      });
    });

    it('should return strings correctly', function (done) {
      var redis = new Redis({ dropBufferSupport: true });
      redis.set('foo', new Buffer('bar'), function (err, res) {
        expect(err).to.eql(null);
        expect(res).to.eql('OK');
        redis.get('foo', function (err, res) {
          expect(err).to.eql(null);
          expect(res).to.eql('bar');
          redis.disconnect();
          done();
        });
      });
    });

    it('should return strings for custom commands', function (done) {
      var redis = new Redis({ dropBufferSupport: true });
      redis.defineCommand('geteval', {
        numberOfKeys: 0,
        lua: 'return "string"'
      });
      redis.geteval(function (err, res) {
        expect(err).to.eql(null);
        expect(res).to.eql('string');
        redis.disconnect();
        done();
      });
    });

    it('should work with pipeline', function (done) {
      var redis = new Redis({ dropBufferSupport: true });
      var pipeline = redis.pipeline();
      pipeline.set('foo', 'bar');
      pipeline.get(new Buffer('foo'));
      pipeline.exec(function (err, res) {
        expect(err).to.eql(null);
        expect(res[0][1]).to.eql('OK');
        expect(res[1][1]).to.eql('bar');
        redis.disconnect();
        done();
      });
    });

    it('should work with transaction', function (done) {
      var redis = new Redis({ dropBufferSupport: true });
      redis.multi()
        .set('foo', 'bar')
        .get('foo')
        .exec(function(err, res) {
          expect(err).to.eql(null);
          expect(res[0][1]).to.eql('OK');
          expect(res[1][1]).to.eql('bar');
          redis.disconnect();
          done();
        });
    });

    it('should fail early with Buffer transaction', function (done) {
      var redis = new Redis({ dropBufferSupport: true });
      redis.multi()
        .set('foo', 'bar')
        .getBuffer(new Buffer('foo'), function(err) {
          expect(err.message).to.match(/Buffer methods are not available/);
          redis.disconnect();
          done();
        });
    });

    it('should work with internal select command', function (done) {
      var redis = new Redis({ dropBufferSupport: true, db: 1 });
      var check = new Redis({ db: 1 });
      redis.set('foo', 'bar', function () {
        check.get('foo', function (err, res) {
          expect(res).to.eql('bar');
          redis.disconnect();
          check.disconnect();
          done();
        });
      });
    });
  });
});
