'use strict';

describe('fatal_error', function () {
  it('should handle fatal error of parser', function (done) {
    var redis = new Redis();
    redis.once('ready', function () {
      var execute = redis.replyParser.execute;
      redis.replyParser.execute = function () {
        execute.call(redis.replyParser, '&');
      };
      redis.get('foo', function (err) {
        expect(err.message).to.match(/Protocol error/);
        redis.replyParser.execute = execute;
        redis.get('bar', function (err) {
          expect(err).to.eql(null);
          done();
        });
      });
    });
  });
});
