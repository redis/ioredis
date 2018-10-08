'use strict';

describe('pipeline', function () {
  it('should return correct result', function (done) {
    var redis = new Redis();
    redis.pipeline().set('foo', '1').get('foo').set('foo', '2').incr('foo').get('foo').exec(function (err, results) {
      expect(err).to.eql(null);
      expect(results).to.eql([
        [null, 'OK'],
        [null, '1'],
        [null, 'OK'],
        [null, 3],
        [null, '3']
      ]);
      done();
    });
  });

  it('should return an empty array on empty pipeline', function (done) {
    var redis = new Redis();
    redis.pipeline().exec(function (err, results) {
      expect(err).to.eql(null);
      expect(results).to.eql([]);
      done();
    });
  });

  it('should support mix string command and buffer command', function (done) {
    var redis = new Redis();
    redis.pipeline().set('foo', 'bar')
    .set('foo', Buffer.from('bar')).getBuffer('foo')
    .get(Buffer.from('foo'))
    .exec(function (err, results) {
      expect(err).to.eql(null);
      expect(results).to.eql([
        [null, 'OK'],
        [null, 'OK'],
        [null, Buffer.from('bar')],
        [null, 'bar']
      ]);
      done();
    });
  });

  it('should handle error correctly', function (done) {
    var redis = new Redis();
    redis.pipeline().set('foo').exec(function (err, results) {
      expect(err).to.eql(null);
      expect(results.length).to.eql(1);
      expect(results[0].length).to.eql(1);
      expect(results[0][0].toString()).to.match(/wrong number of arguments/);
      done();
    });
  });

  it('should also invoke the command\'s callback', function (done) {
    var redis = new Redis();
    var pending = 1;
    redis.pipeline().set('foo', 'bar').get('foo', function (err, result) {
      expect(result).to.eql('bar');
      pending -= 1;
    }).exec(function (err, results) {
      expect(pending).to.eql(0);
      expect(results[1][1]).to.eql('bar');
      done();
    });
  });

  it('should support inline transaction', function (done) {
    var redis = new Redis();

    redis.pipeline().multi().set('foo', 'bar').get('foo').exec().exec(function (err, result) {
      expect(result[0][1]).to.eql('OK');
      expect(result[1][1]).to.eql('QUEUED');
      expect(result[2][1]).to.eql('QUEUED');
      expect(result[3][1]).to.eql(['OK', 'bar']);
      done();
    });
  });

  it('should have the same options as its container', function () {
    var redis = new Redis({ showFriendlyErrorStack: true });
    var pipeline = redis.pipeline();
    expect(pipeline.options).to.have.property('showFriendlyErrorStack', true);
  });

  it('should support key prefixing', function (done) {
    var redis = new Redis({ keyPrefix: 'foo:' });
    redis.pipeline().set('bar', 'baz').get('bar').lpush('app1', 'test1')
    .lpop('app1').keys('*').exec(function (err, results) {
      expect(err).to.eql(null);
      expect(results).to.eql([
        [null, 'OK'],
        [null, 'baz'],
        [null, 1],
        [null, 'test1'],
        [null, ['foo:bar']]
      ]);
      done();
    });
  });

  describe('custom commands', function () {
    var redis;

    before(function () {
      redis = new Redis();
      redis.defineCommand('echo', {
        numberOfKeys: 2,
        lua: 'return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}'
      });
    });

    it('should work', function (done) {
      redis.pipeline().echo('foo', 'bar', '123', 'abc').exec(function (err, results) {
        expect(err).to.eql(null);
        expect(results).to.eql([
          [null, ['foo', 'bar', '123', 'abc']]
        ]);
        done();
      });
    });

    it('should support callbacks', function (done) {
      var pending = 1;
      redis.pipeline()
        .echo('foo', 'bar', '123', 'abc', function (err, result) {
          pending -= 1;
          expect(err).to.eql(null);
          expect(result).to.eql(['foo', 'bar', '123', 'abc']);
        })
        .exec(function (err, results) {
          expect(err).to.eql(null);
          expect(results).to.eql([
            [null, ['foo', 'bar', '123', 'abc']]
          ]);
          expect(pending).to.eql(0);
          done();
        });
    });

    it('should be supported in transaction blocks', function (done) {
      redis.pipeline()
        .multi()
        .set('foo', 'asdf')
        .echo('bar', 'baz', '123', 'abc')
        .get('foo')
        .exec()
        .exec(function (err, results) {
          expect(err).to.eql(null);
          expect(results[4][1][1]).to.eql(['bar', 'baz', '123', 'abc']);
          expect(results[4][1][2]).to.eql('asdf');
          done();
        });
    });
  });

  describe('#addBatch', function () {
    it('should accept commands in constructor', function (done) {
      var redis = new Redis();
      var pending = 1;
      redis.pipeline([
        ['set', 'foo', 'bar'],
        ['get', 'foo', function (err, result) {
          expect(result).to.eql('bar');
          pending -= 1;
        }]
      ]).exec(function (err, results) {
        expect(pending).to.eql(0);
        expect(results[1][1]).to.eql('bar');
        done();
      });
    });
  });

  describe('exec', function () {
    it('should group results', function (done) {
      var redis = new Redis();
      redis.multi({ pipeline: false });
      redis.set('foo', 'bar');
      redis.get('foo');
      redis.exec().then(function () {
        done();
      });
    });

    it('should allow omitting callback', function (done) {
      var redis = new Redis();
      redis.exec().catch(function (err) {
        expect(err.message).to.eql('ERR EXEC without MULTI');
        done();
      });
    });

    it('should batch all commands before ready event', function (done) {
      var redis = new Redis();
      redis.on('connect', function () {
        redis.pipeline().info().config('get', 'maxmemory').exec(function (err, res) {
          expect(err).to.eql(null);
          expect(res).to.have.lengthOf(2);
          expect(res[0][0]).to.eql(null);
          expect(typeof res[0][1]).to.eql('string');
          expect(res[1][0]).to.eql(null);
          expect(Array.isArray(res[1][1])).to.eql(true);
          done();
        });
      });
    });
  });

  describe('#length', function () {
    it('return the command count', function () {
      var redis = new Redis();

      var pipeline1 = redis.pipeline().multi().set('foo', 'bar').get('foo').exec();
      expect(pipeline1.length).to.eql(4);

      var pipeline2 = redis.pipeline([
        ['set', 'foo', 'bar'],
        ['get', 'foo']
      ]);
      expect(pipeline2.length).to.eql(2);
    });
  });
});
