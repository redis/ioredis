'use strict';

var { MaxRetriesPerRequestError } = require('../../lib/errors');

describe('maxRetriesPerRequest', function () {
  it('throw the correct error when reached the limit', function (done) {
    var redis = new Redis(9999, {
      retryStrategy() {
        return 1;
      }
    });
    redis.get('foo', (err) => {
      expect(err).instanceOf(MaxRetriesPerRequestError);
      done();
    });
  });

  it('defaults to max 20 retries', function (done) {
    var redis = new Redis(9999, {
      connectTimeout: 1,
      retryStrategy() {
        return 1;
      }
    });
    redis.get('foo', () => {
      expect(redis.retryAttempts).to.eql(21);
      redis.get('foo', () => {
        expect(redis.retryAttempts).to.eql(42);
        done();
      });
    });
  });

  it('can be changed', function (done) {
    var redis = new Redis(9999, {
      maxRetriesPerRequest: 1,
      retryStrategy() {
        return 1;
      }
    });
    redis.get('foo', () => {
      expect(redis.retryAttempts).to.eql(2);
      redis.get('foo', () => {
        expect(redis.retryAttempts).to.eql(4);
        done();
      });
    });
  });

  it('allows 0', function (done) {
    var redis = new Redis(9999, {
      maxRetriesPerRequest: 0,
      retryStrategy() {
        return 1;
      }
    });
    redis.get('foo', () => {
      expect(redis.retryAttempts).to.eql(1);
      redis.get('foo', () => {
        expect(redis.retryAttempts).to.eql(2);
        done();
      });
    });
  });
});
