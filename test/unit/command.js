'use strict';

var Command = require('../../lib/command');

describe('Command', function () {
  describe('constructor()', function () {
    it('should flatten the args', function () {
      var command = new Command('get', ['foo', ['bar', ['zoo', 'zoo']]]);
      expect(command.args).to.eql(['foo', 'bar', 'zoo,zoo']);
    });
  });

  describe('#toWritable()', function () {
    it('should return correct string', function () {
      var command = new Command('get', ['foo', 'bar', 'zooo']);
      expect(command.toWritable()).to.eql('*4\r\n$3\r\nget\r\n$3\r\nfoo\r\n$3\r\nbar\r\n$4\r\nzooo\r\n');
    });

    it('should return buffer when there\'s at least one arg is a buffer', function () {
      var command = new Command('get', ['foo', new Buffer('bar'), 'zooo']);
      var result = command.toWritable();
      expect(result).to.be.instanceof(Buffer);
      expect(result.toString()).to.eql('*4\r\n$3\r\nget\r\n$3\r\nfoo\r\n$3\r\nbar\r\n$4\r\nzooo\r\n');
    });
  });

  describe('#resolve()', function () {
    it('should return buffer when replyEncoding is not set', function (done) {
      var command = new Command('get', ['foo'], { replyEncoding: null }, function (err, result) {
        expect(result).to.be.instanceof(Buffer);
        expect(result.toString()).to.eql('foo');
        done();
      });
      command.resolve(new Buffer('foo'));
    });

    it('should covert result to string if replyEncoding is specified', function (done) {
      var command = new Command('get', ['foo'], { replyEncoding: 'utf8' }, function (err, result) {
        expect(result).to.eql('foo');
        done();
      });
      command.resolve(new Buffer('foo'));
    });

    it('should regard replyEncoding', function (done) {
      var base64 = new Buffer('foo').toString('base64');
      var command = new Command('get', ['foo'], { replyEncoding: 'base64' }, function (err, result) {
        expect(result).to.eql(base64);
        done();
      });
      command.resolve(new Buffer('foo'));
    });
  });

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
        return command.getKeys();
      }
    });
  });
});
