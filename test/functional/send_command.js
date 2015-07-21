'use strict';

describe('send command', function () {
  it('should support callback', function (done) {
    var redis = new Redis();
    redis.set('foo', 'bar');
    redis.get('foo', function (err, result) {
      expect(result).to.eql('bar');
      done();
    });
  });

  it('should support promise', function () {
    var redis = new Redis();
    redis.set('foo', 'bar');
    return redis.get('foo').then(function (result) {
      expect(result).to.eql('bar');
    });
  });

  it('should keep the response order when mix using callback & promise', function (done) {
    var redis = new Redis();
    var order = 0;
    redis.get('foo').then(function () {
      expect(++order).to.eql(1);
    });
    redis.get('foo', function () {
      expect(++order).to.eql(2);
    });
    redis.get('foo').then(function () {
      expect(++order).to.eql(3);
    });
    redis.get('foo', function () {
      expect(++order).to.eql(4);
      done();
    });
  });

  it('should support get & set buffer', function (done) {
    var redis = new Redis();
    redis.set(new Buffer('foo'), new Buffer('bar'), function (err, res) {
      expect(res).to.eql('OK');
    });
    redis.getBuffer(new Buffer('foo'), function (err, result) {
      expect(result).to.be.instanceof(Buffer);
      expect(result.toString()).to.eql('bar');
      done();
    });
  });

  it('should support get & set buffer via `call`', function (done) {
    var redis = new Redis();
    redis.call('set', new Buffer('foo'), new Buffer('bar'), function (err, res) {
      expect(res).to.eql('OK');
    });
    redis.callBuffer('get', new Buffer('foo'), function (err, result) {
      expect(result).to.be.instanceof(Buffer);
      expect(result.toString()).to.eql('bar');
      done();
    });
  });

  it('should handle empty buffer', function (done) {
    var redis = new Redis();
    redis.set(new Buffer('foo'), new Buffer(''));
    redis.getBuffer(new Buffer('foo'), function (err, result) {
      expect(result).to.be.instanceof(Buffer);
      expect(result.toString()).to.eql('');
      done();
    });
  });

  it('should support utf8', function (done) {
    var redis = new Redis();
    redis.set(new Buffer('你好'), new String('你好'));
    redis.getBuffer('你好', function (err, result) {
      expect(result.toString()).to.eql('你好');
      redis.get('你好', function (err, result) {
        expect(result).to.eql('你好');
        done();
      });
    });
  });

  it('should consider null as empty str', function (done) {
    var redis = new Redis();
    redis.set('foo', null, function () {
      redis.get('foo', function (err, res) {
        expect(res).to.eql('');
        done();
      });
    });
  });

  it('should support return int value', function (done) {
    var redis = new Redis();
    redis.exists('foo', function (err, exists) {
      expect(typeof exists).to.eql('number');
      done();
    });
  });

  it('should reject when disconnected', function (done) {
    var redis = new Redis();
    redis.disconnect();
    redis.get('foo', function (err) {
      expect(err.message).to.match(/Connection is closed./);
      done();
    });
  });

  it('should reject when enableOfflineQueue is disabled', function (done) {
    var redis = new Redis({ enableOfflineQueue: false });
    redis.get('foo', function (err) {
      expect(err.message).to.match(/enableOfflineQueue options is false/);
      done();
    });
  });

  it('should support key prefixing', function (done) {
    var redis = new Redis({ keyPrefix: 'foo:' });
    redis.set('bar', 'baz');
    redis.get('bar', function (err, result) {
      expect(result).to.eql('baz');
      redis.keys('*', function (err, result) {
        expect(result).to.eql(['foo:bar']);
        done();
      });
    });
  });

  it('should support key prefixing with multiple keys', function (done) {
    var redis = new Redis({ keyPrefix: 'foo:' });
    redis.lpush('app1', 'test1');
    redis.lpush('app2', 'test2');
    redis.lpush('app3', 'test3');
    redis.blpop('app1', 'app2', 'app3', 0, function (err, result) {
      expect(result).to.eql(['foo:app1', 'test1']);
      redis.keys('*', function (err, result) {
        expect(result).to.have.members(['foo:app2', 'foo:app3']);
        done();
      });
    });
  });

  it('should support key prefixing for zunionstore', function (done) {
    var redis = new Redis({ keyPrefix: 'foo:' });
    redis.zadd('zset1', 1, 'one');
    redis.zadd('zset1', 2, 'two');
    redis.zadd('zset2', 1, 'one');
    redis.zadd('zset2', 2, 'two');
    redis.zadd('zset2', 3, 'three');
    redis.zunionstore('out', 2, 'zset1', 'zset2', 'WEIGHTS', 2, 3, function (err, result) {
      expect(result).to.eql(3);
      redis.keys('*', function (err, result) {
        expect(result).to.have.members(['foo:zset1', 'foo:zset2', 'foo:out']);
        done();
      });
    });
  });

  it('should support key prefixing for sort', function (done) {
    var redis = new Redis({ keyPrefix: 'foo:' });
    redis.hset('object_1', 'name', 'better');
    redis.hset('weight_1', 'value', '20');
    redis.hset('object_2', 'name', 'best');
    redis.hset('weight_2', 'value', '30');
    redis.hset('object_3', 'name', 'good');
    redis.hset('weight_3', 'value', '10');
    redis.lpush('src', '1', '2', '3');
    redis.sort('src', 'BY', 'weight_*->value', 'GET', 'object_*->name', 'STORE', 'dest', function (err, result) {
      redis.lrange('dest', 0, -1, function (err, result) {
        expect(result).to.eql(['good', 'better', 'best']);
        redis.keys('*', function (err, result) {
          expect(result).to.have.members([
            'foo:object_1',
            'foo:weight_1',
            'foo:object_2',
            'foo:weight_2',
            'foo:object_3',
            'foo:weight_3',
            'foo:src',
            'foo:dest'
          ]);
          done();
        });
      });
    });
  });
});
