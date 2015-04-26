'use strict';

describe('transformer', function () {
  describe('default transformer', function () {
    describe('hmset', function () {
      it('should support object', function (done) {
        var redis = new Redis();
        redis.hmset('foo', { a: 1, b: '2' }, function (err, result) {
          expect(result).to.eql('OK');
          redis.hget('foo', 'b', function (err, result) {
            expect(result).to.eql('2');
            done();
          });
        });
      });
      it('should support Map', function (done) {
        if (typeof Map === 'undefined') {
          return done();
        }
        var redis = new Redis();
        var map = new Map();
        map.set('a', 1);
        map.set('b', '2');
        redis.hmset('foo', map, function (err, result) {
          expect(result).to.eql('OK');
          redis.hget('foo', 'b', function (err, result) {
            expect(result).to.eql('2');
            done();
          });
        });
      });
      it('should not affect the old way', function (done) {
        var redis = new Redis();
        redis.hmset('foo', 'a', 1, 'b', '2', function (err, result) {
          expect(result).to.eql('OK');
          redis.hget('foo', 'b', function (err, result) {
            expect(result).to.eql('2');
            done();
          });
        });
      });
    });

    describe('mset', function () {
      it('should support object', function (done) {
        var redis = new Redis();
        redis.mset({ a: 1, b: '2' }, function (err, result) {
          expect(result).to.eql('OK');
          redis.mget('a', 'b', function (err, result) {
            expect(result).to.eql(['1', '2']);
            done();
          });
        });
      });
      it('should support Map', function (done) {
        if (typeof Map === 'undefined') {
          return done();
        }
        var redis = new Redis();
        var map = new Map();
        map.set('a', 1);
        map.set('b', '2');
        redis.mset(map, function (err, result) {
          expect(result).to.eql('OK');
          redis.mget('a', 'b', function (err, result) {
            expect(result).to.eql(['1', '2']);
            done();
          });
        });
      });
      it('should not affect the old way', function (done) {
        var redis = new Redis();
        redis.mset('a', 1, 'b', '2', function (err, result) {
          expect(result).to.eql('OK');
          redis.mget('a', 'b', function (err, result) {
            expect(result).to.eql(['1', '2']);
            done();
          });
        });
      });
    });

    describe('hgetall', function () {
      it('should return an object', function (done) {
        var redis = new Redis();
        redis.hmset('foo', 'k1', 'v1', 'k2', 'v2', function () {
          redis.hgetall('foo', function (err, result) {
            expect(result).to.eql({ k1: 'v1', k2: 'v2' });
            done();
          });
        });
      });

      it('should return {} when key not exists', function (done) {
        var redis = new Redis();
        redis.hgetall('foo', function (err, result) {
          expect(result).to.eql({});
          done();
        });
      });
    });
  });
});
