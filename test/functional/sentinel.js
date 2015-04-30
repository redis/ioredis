'use strict';

describe('sentinel', function () {
  describe('connect', function () {
    it('should connect to sentinel successfully', function (done) {
      var sentinel = new MockServer(27379);
      sentinel.once('connect', function () {
        redis.disconnect();
        sentinel.disconnect(done);
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '27379' }
        ],
        name: 'master'
      });

    });

    it('should try to connect to all sentinel', function (done) {
      var sentinel = new MockServer(27380);
      sentinel.once('connect', function () {
        redis.disconnect();
        sentinel.disconnect(done);
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '27379' },
          { host: '127.0.0.1', port: '27380' }
        ],
        name: 'master'
      });
    });

    it('should call sentinelRetryStrategy when all sentinels are unreachable', function (done) {
      var t = 0;
      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '27379' },
          { host: '127.0.0.1', port: '27380' }
        ],
        sentinelRetryStrategy: function (times) {
          expect(times).to.eql(++t);
          var sentinel = new MockServer(27380);
          sentinel.once('connect', function () {
            redis.disconnect();
            sentinel.disconnect(done);
          });
          return 0;
        },
        name: 'master'
      });
    });

    it('should raise error when all sentinel are unreachable and retry is disabled', function (done) {
      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '27379' },
          { host: '127.0.0.1', port: '27380' }
        ],
        sentinelRetryStrategy: null,
        name: 'master'
      });

      redis.get('foo', function (error) {
        expect(error.message).to.match(/are unreachable/);
        redis.disconnect();
        done();
      });
    });

    it('should close the connection to the sentinel when resolving successfully', function (done) {
      var sentinel = new MockServer(27379, function (argv) {
        if (argv[0] === 'sentinel' && argv[1] === 'get-master-addr-by-name') {
          return ['127.0.0.1', '17380'];
        }
      });
      var master = new MockServer(17380);
      sentinel.once('disconnect', function () {
        redis.disconnect();
        master.disconnect(function () {
          sentinel.disconnect(done);
        });
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '27379' }
        ],
        name: 'master'
      });
    });
  });

  describe('master', function () {
    it('should connect to the master successfully', function (done) {
      var sentinel = new MockServer(27379, function (argv) {
        if (argv[0] === 'sentinel' && argv[1] === 'get-master-addr-by-name') {
          return ['127.0.0.1', '17380'];
        }
      });
      var master = new MockServer(17380);
      master.on('connect', function () {
        redis.disconnect();
        sentinel.disconnect(function () {
          master.disconnect(done);
        });
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '27379' }
        ],
        name: 'master'
      });
    });

    it('should connect to the next sentinel if getting master failed', function (done) {
      var sentinel = new MockServer(27379, function (argv) {
        if (argv[0] === 'sentinel' && argv[1] === 'get-master-addr-by-name') {
          return null;
        }
      });

      var sentinel2 = new MockServer(27380);
      sentinel2.on('connect', function () {
        redis.disconnect();
        sentinel.disconnect(function () {
          sentinel2.disconnect(done);
        });
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '27379' },
          { host: '127.0.0.1', port: '27380' }
        ],
        name: 'master'
      });
    });

    it('should connect to the next sentinel if the role is wrong', function (done) {
      var sentinel = new MockServer(27379, function (argv) {
        if (argv[0] === 'sentinel' && argv[1] === 'get-master-addr-by-name' && argv[2] === 'master') {
          return ['127.0.0.1', '17380'];
        }
      });

      var sentinel2 = new MockServer(27380);
      sentinel2.on('connect', function () {
        redis.disconnect();
        sentinel.disconnect(function () {
          master.disconnect(function () {
            sentinel2.disconnect(done);
          });
        });
      });

      var master = new MockServer(17380, function (argv) {
        if (argv[0] === 'info') {
          return 'role:slave';
        }
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '27379' },
          { host: '127.0.0.1', port: '27380' }
        ],
        name: 'master'
      });
    });
  });

  describe('slave', function () {
    it('should connect to the slave successfully', function (done) {
      var sentinel = new MockServer(27379, function (argv) {
        if (argv[0] === 'sentinel' && argv[1] === 'slaves' && argv[2] === 'master') {
          return [['ip', '127.0.0.1', 'port', '17381', 'flags', 'slave']];
        }
      });
      var slave = new MockServer(17381);
      slave.on('connect', function () {
        redis.disconnect();
        sentinel.disconnect(function () {
          slave.disconnect(done);
        });
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '27379' }
        ],
        name: 'master',
        role: 'slave'
      });
    });

    it('should connect to the next sentinel if getting slave failed', function (done) {
      var sentinel = new MockServer(27379, function (argv) {
        if (argv[0] === 'sentinel' && argv[1] === 'slaves' && argv[2] === 'master') {
          return [];
        }
      });

      var sentinel2 = new MockServer(27380);
      sentinel2.on('connect', function () {
        redis.disconnect();
        sentinel.disconnect(function () {
          sentinel2.disconnect(done);
        });
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '27379' },
          { host: '127.0.0.1', port: '27380' }
        ],
        name: 'master',
        role: 'slave'
      });
    });

    it('should connect to the next sentinel if the role is wrong', function (done) {
      var sentinel = new MockServer(27379, function (argv) {
        if (argv[0] === 'sentinel' && argv[1] === 'slaves' && argv[2] === 'master') {
          return [['ip', '127.0.0.1', 'port', '17381', 'flags', 'slave']];
        }
      });

      var sentinel2 = new MockServer(27380);
      sentinel2.on('connect', function (c) {
        redis.disconnect();
        sentinel.disconnect(function () {
          slave.disconnect(function () {
            sentinel2.disconnect(done);
          });
        });
      });

      var slave = new MockServer(17381, function (argv) {
        if (argv[0] === 'info') {
          return 'role:master';
        }
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '27379' },
          { host: '127.0.0.1', port: '27380' }
        ],
        name: 'master',
        role: 'slave'
      });
    });
  });

  describe('failover', function () {
    it('should switch to new master automatically without any commands being lost', function (done) {
      var sentinel = new MockServer(27379, function (argv) {
        if (argv[0] === 'sentinel' && argv[1] === 'get-master-addr-by-name') {
          return ['127.0.0.1', '17380'];
        }
      });
      var master = new MockServer(17380);
      master.on('connect', function (c) {
        c.destroy();
        master.disconnect();
        redis.get('foo', function (err, res) {
          expect(res).to.eql('bar');
          redis.disconnect();
          newMaster.disconnect(function () {
            sentinel.disconnect(done);
          });
        });
        var newMaster = new MockServer(17381, function (argv) {
          if (argv[0] === 'get' && argv[1] === 'foo') {
            return 'bar';
          }
        });
        sentinel.handler = function (argv) {
          if (argv[0] === 'sentinel' && argv[1] === 'get-master-addr-by-name') {
            return ['127.0.0.1', '17381'];
          }
        };
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '27379' }
        ],
        name: 'master'
      });
    });
  });
});
