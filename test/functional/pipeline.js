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

  it('should support mix string command and buffer command', function (done) {
    var redis = new Redis();
    redis.pipeline().set('foo', 'bar').set('foo', new Buffer('bar')).getBuffer('foo').get(new Buffer('foo')).exec(function (err, results) {
      expect(err).to.eql(null);
      expect(results).to.eql([
        [null, 'OK'],
        [null, 'OK'],
        [null, new Buffer('bar')],
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
});
