'use strict';

var Command = require('../../lib/command');
var ClusterCommand = require('../../lib/cluster_command');
describe('ClusterCommand', function () {
  describe('#getKeys()', function () {
    it('should return keys', function () {
      expect(getKeys('get', ['foo'])).to.eql(['foo']);
      expect(getKeys('mget', ['foo', 'bar'])).to.eql(['foo', 'bar']);
      expect(getKeys('mset', ['foo', 'v1', 'bar', 'v2'])).to.eql(['foo', 'bar']);
      expect(getKeys('hmset', ['key', 'foo', 'v1', 'bar', 'v2'])).to.eql(['key']);
      expect(getKeys('blpop', ['key1', 'key2', '17'])).to.eql(['key1', 'key2']);
      expect(getKeys('evalsha', ['23123', '2', 'foo', 'bar', 'zoo'])).to.eql(['foo', 'bar']);
      expect(getKeys('evalsha', ['23123', 2, 'foo', 'bar', 'zoo'])).to.eql(['foo', 'bar']);
      expect(getKeys('sort', ['key'])).to.eql(['key']);
      expect(getKeys('sort', ['key', 'BY', 'hash:*->field'])).to.eql(['key', 'hash:*']);
      expect(getKeys('sort', ['key', 'BY', 'hash:*->field', 'LIMIT', 2, 3, 'GET', 'gk', 'GET', '#', 'Get', 'gh->f*', 'DESC', 'ALPHA', 'STORE', 'store'])).to.eql(['key', 'hash:*', 'gk', 'gh->f', 'store']);
      expect(getKeys('zunionstore', ['out', 2, 'zset1', 'zset2', 'WEIGHTS', 2, 3])).to.eql(['out', 'zset1', 'zset2']);
      expect(getKeys('zinterstore', ['out', 2, 'zset1', 'zset2', 'WEIGHTS', 2, 3])).to.eql(['out', 'zset1', 'zset2']);

      function getKeys(commandName, args) {
        var command = new Command(commandName, args);
        var clusterCommand = new ClusterCommand(command);
        return clusterCommand.keys;
      }
    });
  });
});
