'use strict';

describe('reconnectOnError', function () {
  it('should pass the error as the first param', function (done) {
    var pending = 2;
    function assert(err) {
      expect(err.name).to.eql('ReplyError');
      expect(err.command.name).to.eql('set');
      expect(err.command.args).to.eql(['foo']);
      if (!--pending) {
        done();
      }
    }
    var redis = new Redis({
      reconnectOnError: function (err) {
        assert(err);
      }
    });

    redis.set('foo', function (err) {
      assert(err);
    });
  });

  it('should not reconnect if reconnectOnError returns false', function (done) {
    var redis = new Redis({
      reconnectOnError: function (err) {
        return false;
      }
    });

    redis.disconnect = function () {
      throw new Error('should not disconnect');
    };

    redis.set('foo', function (err) {
      done();
    });
  });

  it('should reconnect if reconnectOnError returns true or 1', function (done) {
    var redis = new Redis({
      reconnectOnError: function () {
        return true;
      }
    });

    redis.set('foo', function () {
      redis.on('ready', function () {
        done();
      });
    });
  });

  it('should reconnect and retry the command if reconnectOnError returns 2', function (done) {
    var redis = new Redis({
      reconnectOnError: function () {
        redis.del('foo');
        return 2;
      }
    });

    redis.set('foo', 'bar');
    redis.sadd('foo', 'a', function (err, res) {
      expect(res).to.eql(1);
      done();
    });
  });

  it('should select the currect database', function (done) {
    var redis = new Redis({
      reconnectOnError: function () {
        redis.select(3);
        redis.del('foo');
        redis.select(0);
        return 2;
      }
    });

    redis.select(3);
    redis.set('foo', 'bar');
    redis.sadd('foo', 'a', function (err, res) {
      expect(res).to.eql(1);
      redis.select(3);
      redis.type('foo', function (err, type) {
        expect(type).to.eql('set');
        done();
      });
    });
  });

  it('should work with pipeline', function (done) {
    var redis = new Redis({
      reconnectOnError: function () {
        redis.del('foo');
        return 2;
      }
    });

    redis.set('foo', 'bar');
    redis.pipeline().get('foo').sadd('foo', 'a').exec(function (err, res) {
      expect(res).to.eql([[null, 'bar'], [null, 1]]);
      done();
    });
  });
});
