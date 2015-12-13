'use strict';

describe('scriptingTransformer', function () {
  describe('#numberOfKeys', function () {
    it('should recognize the numberOfKeys property', function (done) {
      var redis = new Redis();

      redis.defineCommand('test', {
        numberOfKeys: 2,
        lua: 'return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}'
      });

      Redis.Command.setArgumentTransformer('test', function(args) {
        return [args[0].keys[0], args[0].keys[1]].concat(args[0].values || []);
      });

      Redis.Command.setReplyTransformer('test', function(result) {
        return {keys: result.slice(0, 2), values: result.slice(2)};
      });

      redis.test({keys: ['k1', 'k2'], values: ['v1', 'v2']}, function (err, result) {
        expect(result).to.eql({keys: ['k1', 'k2'], values: ['v1', 'v2']});
        done();
      });
    });

    it('should support dynamic key count', function (done) {
      var redis = new Redis();

      redis.defineCommand('test', {
        lua: 'return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}'
      });

      Redis.Command.setArgumentTransformer('test', function(args) {
        return [args[0].keys && args[0].keys.length || 0].concat(args[0].keys || []).concat(args[0].values || []);
      });

      Redis.Command.setReplyTransformer('test', function(result) {
        return {keys: result.slice(0, 2), values: result.slice(2)};
      });

      redis.test({keys: ['k1', 'k2'], values: ['v1', 'v2']}, function(err, result) {
        expect(result).to.eql({keys: ['k1', 'k2'], values: ['v1', 'v2']});
        done();
      });
    });
  });
  it('should support key prefixing', function (done) {
    var redis = new Redis({ keyPrefix: 'foo:' });

    redis.defineCommand('test', {
      lua: 'return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}'
    });

    Redis.Command.setArgumentTransformer('test', function(args) {
      return [args[0].keys && args[0].keys.length || 0].concat(args[0].keys || []).concat(args[0].values || []);
    });

    Redis.Command.setReplyTransformer('test', function(result) {
      return {keys: result.slice(0, 2), values: result.slice(2)};
    });

    redis.test({keys: ['k1', 'k2'], values: ['v1', 'v2']}, function(err, result) {
      expect(result).to.eql({keys: ['foo:k1', 'foo:k2'], values: ['v1', 'v2']});
      done();
    });
  });
});