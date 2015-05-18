'use strict';

describe('transaction', function () {
  it('should works like pipeline by default', function (done) {
    var redis = new Redis();
    redis.multi().set('foo', 'transaction').get('foo').exec(function (err, result) {
      expect(err).to.eql(null);
      expect(result).to.eql([[null, 'OK'], [null, 'transaction']]);
      done();
    });
  });

  it('should handle runtime errors correctly', function (done) {
    var redis = new Redis();
    redis.multi().set('foo', 'bar').lpush('foo', 'abc').exec(function (err, result) {
      expect(err).to.eql(null);
      expect(result.length).to.eql(2);
      expect(result[0]).to.eql([null, 'OK']);
      expect(result[1][0]).to.be.instanceof(Error);
      expect(result[1][0].toString()).to.match(/wrong kind of value/);
      done();
    });
  });

  it('should handle compile-time errors correctly', function (done) {
    var redis = new Redis();
    redis.multi().set('foo').get('foo').exec(function (err, result) {
      expect(err).to.be.instanceof(Error);
      expect(err.toString()).to.match(/Transaction discarded because of previous errors/);
      done();
    });
  });

  it('should also support command callbacks', function (done) {
    var redis = new Redis();
    var pending = 1;
    redis.multi().set('foo', 'bar').get('foo', function (err, value) {
      pending -= 1;
      expect(value).to.eql('QUEUED');
    }).exec(function (err, result) {
      expect(pending).to.eql(0);
      expect(result).to.eql([[null, 'OK'], [null, 'bar']]);
      done();
    });
  });

  it('should also handle errors in command callbacks', function (done) {
    var redis = new Redis();
    var pending = 1;
    redis.multi().set('foo', function (err) {
      expect(err.toString()).to.match(/wrong number of arguments/);
      pending -= 1;
    }).exec(function (err) {
      expect(err.toString()).to.match(/Transaction discarded because of previous errors/);
      if (!pending) {
        done();
      }
    });
  });

  it('should work without pipeline', function (done) {
    var redis = new Redis();
    redis.multi({ pipeline: false });
    redis.set('foo', 'bar');
    redis.get('foo');
    redis.exec(function (err, results) {
      expect(results).to.eql([[null, 'OK'], [null, 'bar']]);
      done();
    });
  });

  describe('#addBatch', function () {
    it('should accept commands in constructor', function (done) {
      var redis = new Redis();
      var pending = 1;
      redis.multi([
        ['set', 'foo', 'bar'],
        ['get', 'foo', function (err, result) {
          expect(result).to.eql('QUEUED');
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
