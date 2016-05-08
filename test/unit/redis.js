'use strict';

var Promise = require('bluebird');

describe('Redis', function () {
  describe('constructor', function () {
    it('should parse options correctly', function () {
      stub(Redis.prototype, 'connect').returns(Promise.resolve());

      var option;
      try {
        option = getOption();
        expect(option).to.have.property('port', 6379);
        expect(option).to.have.property('host', 'localhost');
        expect(option).to.have.property('family', 4);

        option = getOption(6380);
        expect(option).to.have.property('port', 6380);
        expect(option).to.have.property('host', 'localhost');

        option = getOption('6380');
        expect(option).to.have.property('port', 6380);

        option = getOption(6381, '192.168.1.1');
        expect(option).to.have.property('port', 6381);
        expect(option).to.have.property('host', '192.168.1.1');

        option = getOption(6381, '192.168.1.1', {
          password: '123',
          db: 2
        });
        expect(option).to.have.property('port', 6381);
        expect(option).to.have.property('host', '192.168.1.1');
        expect(option).to.have.property('password', '123');
        expect(option).to.have.property('db', 2);

        option = getOption('redis://:authpassword@127.0.0.1:6380/4');
        expect(option).to.have.property('port', 6380);
        expect(option).to.have.property('host', '127.0.0.1');
        expect(option).to.have.property('password', 'authpassword');
        expect(option).to.have.property('db', 4);

        option = getOption('redis://127.0.0.1/');
        expect(option).to.have.property('db', 0);

        option = getOption('/tmp/redis.sock');
        expect(option).to.have.property('path', '/tmp/redis.sock');

        option = getOption({
          port: 6380,
          host: '192.168.1.1'
        });
        expect(option).to.have.property('port', 6380);
        expect(option).to.have.property('host', '192.168.1.1');

        option = getOption({
          path: '/tmp/redis.sock'
        });
        expect(option).to.have.property('path', '/tmp/redis.sock');

        option = getOption({
          port: '6380'
        });
        expect(option).to.have.property('port', 6380);

        option = getOption({
          showFriendlyErrorStack: true
        });
        expect(option).to.have.property('showFriendlyErrorStack', true);

        option = getOption(6380, {
          host: '192.168.1.1'
        });
        expect(option).to.have.property('port', 6380);
        expect(option).to.have.property('host', '192.168.1.1');

        option = getOption('6380', {
          host: '192.168.1.1'
        });
        expect(option).to.have.property('port', 6380);
      } catch (err) {
        Redis.prototype.connect.restore();
        throw err;
      }
      Redis.prototype.connect.restore();

      function getOption() {
        var redis = Redis.apply(null, arguments);
        return redis.options;
      }
    });

    it('should throw when arguments is invalid', function () {
      expect(function () {
        new Redis(function () {});
      }).to.throw(Error);
    });
  });

  describe('.createClient', function () {
    it('should redirect to constructor', function () {
      var redis = Redis.createClient({ name: 'pass', lazyConnect: true });
      expect(redis.options).to.have.property('name', 'pass');
      expect(redis.options).to.have.property('lazyConnect', true);
    });
  });

  describe('#end', function () {
    it('should redirect to #disconnect', function (done) {
      var redis = new Redis({ lazyConnect: true });
      stub(redis, 'disconnect', function () {
        redis.disconnect.restore();
        done();
      });
      redis.end();
    });
  });

  describe('#flushQueue', function () {
    it('should flush all queues by default', function () {
      var flushQueue = Redis.prototype.flushQueue;
      var redis = {
        offlineQueue: [{ command: { reject: function () {} } }],
        commandQueue: [{ command: { reject: function () {} } }]
      };
      var offline = mock(redis.offlineQueue[0].command);
      var command = mock(redis.commandQueue[0].command);
      offline.expects('reject').once();
      command.expects('reject').once();
      flushQueue.call(redis);
      offline.verify();
      command.verify();
    });

    it('should be able to ignore a queue', function () {
      var flushQueue = Redis.prototype.flushQueue;
      var redis = {
        offlineQueue: [{ command: { reject: function () {} } }],
        commandQueue: [{ command: { reject: function () {} } }]
      };
      var offline = mock(redis.offlineQueue[0].command);
      var command = mock(redis.commandQueue[0].command);
      offline.expects('reject').once();
      command.expects('reject').never();
      flushQueue.call(redis, new Error(), { commandQueue: false });
      offline.verify();
      command.verify();
    });
  });
});
