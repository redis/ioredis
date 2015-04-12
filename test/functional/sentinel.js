describe('sentinel', function () {
  describe('connect', function () {
    it('should connect to sentinel successfully', function (done) {
      var sentinel = new MockServer(26379);
      sentinel.once('connect', function () {
        redis.disconnect();
        sentinel.disconnect(done);
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '26379' }
        ],
        name: 'master',
        retryStrategy: null
      });

    });

    it('should try to connect to all sentinel', function (done) {
      var sentinel = new MockServer(26380);
      sentinel.once('connect', function () {
        redis.disconnect();
        sentinel.disconnect(done);
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '26379' },
          { host: '127.0.0.1', port: '26380' }
        ],
        name: 'master',
        retryStrategy: null
      });
    });

    it('should raise error when all sentinel are unreachable', function (done) {
      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '26379' },
          { host: '127.0.0.1', port: '26380' }
        ],
        name: 'master',
        retryStrategy: null
      });

      redis.once('error', function (error) {
        redis.disconnect();
        expect(error.message).to.match(/are unreachable/);
        done();
      });
    });

    it('should continue trying when all sentinels are unreachable', function (done) {
      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '26379' },
          { host: '127.0.0.1', port: '26380' }
        ],
        name: 'master',
        retryStrategy: null
      });

      redis.once('error', function (err) {
        var sentinel = new MockServer(26380);
        sentinel.once('connect', function () {
          redis.disconnect();
          sentinel.disconnect(done);
        });
      });
    });

    it('should also close the connect to the sentinel when disconnect', function (done) {
      var sentinel = new MockServer(26379, function (argv) {
        if (argv[0] === 'sentinel' && argv[1] === 'get-master-addr-by-name') {
          return ['127.0.0.1', '16380'];
        }
      });
      var master = new MockServer(16380);
      sentinel.once('disconnect', function () {
        master.disconnect(function () {
          sentinel.disconnect(done);
        });
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '26379' }
        ],
        name: 'master',
        retryStrategy: null
      });
      redis.disconnect();
    });
  });

  describe('master', function () {
    it('should connect to the master successfully', function (done) {
      var sentinel = new MockServer(26379, function (argv) {
        if (argv[0] === 'sentinel' && argv[1] === 'get-master-addr-by-name') {
          return ['127.0.0.1', '16380'];
        }
      });
      var master = new MockServer(16380);
      master.on('connect', function () {
        redis.disconnect();
        sentinel.disconnect(function () {
          master.disconnect(done);
        });
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '26379' }
        ],
        name: 'master',
        retryStrategy: null
      });
    });

    it('should connect to the next sentinel if getting master failed', function (done) {
      var sentinel = new MockServer(26379, function (argv) {
        if (argv[0] === 'sentinel' && argv[1] === 'get-master-addr-by-name') {
          return null;
        }
      });

      var sentinel2 = new MockServer(26380);
      sentinel2.on('connect', function () {
        redis.disconnect();
        sentinel.disconnect(function () {
          sentinel2.disconnect(done);
        });
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '26379' },
          { host: '127.0.0.1', port: '26380' }
        ],
        name: 'master',
        retryStrategy: null
      });
    });

    it('should connect to the next sentinel if the role is wrong', function (done) {
      var sentinel = new MockServer(26379, function (argv) {
        if (argv[0] === 'sentinel' && argv[1] === 'get-master-addr-by-name' && argv[2] === 'master') {
          return ['127.0.0.1', '16380'];
        }
      });

      var sentinel2 = new MockServer(26380);
      sentinel2.on('connect', function () {
        redis.disconnect();
        sentinel.disconnect(function () {
          master.disconnect(function () {
            sentinel2.disconnect(done);
          });
        });
      });

      var master = new MockServer(16380, function (argv) {
        if (argv[0] === 'info') {
          return 'role:slave';
        }
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '26379' },
          { host: '127.0.0.1', port: '26380' }
        ],
        name: 'master',
        roleRetryDelay: 0,
        retryStrategy: null
      });
    });
  });

  describe('slave', function () {
    it('should connect to the slave successfully', function (done) {
      var sentinel = new MockServer(26379, function (argv) {
        if (argv[0] === 'sentinel' && argv[1] === 'slaves' && argv[2] === 'master') {
          return [['ip', '127.0.0.1', 'port', '16381', 'flags', 'slave']];
        }
      });
      var slave = new MockServer(16381);
      slave.on('connect', function () {
        redis.disconnect();
        sentinel.disconnect(function () {
          slave.disconnect(done);
        });
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '26379' }
        ],
        name: 'master',
        role: 'slave',
        retryStrategy: null
      });
    });

    it('should connect to the next sentinel if getting slave failed', function (done) {
      var sentinel = new MockServer(26379, function (argv) {
        if (argv[0] === 'sentinel' && argv[1] === 'slaves' && argv[2] === 'master') {
          return [];
        }
      });

      var sentinel2 = new MockServer(26380);
      sentinel2.on('connect', function () {
        redis.disconnect();
        sentinel.disconnect(function () {
          sentinel2.disconnect(done);
        });
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '26379' },
          { host: '127.0.0.1', port: '26380' }
        ],
        name: 'master',
        role: 'slave',
        retryStrategy: null
      });
    });

    it('should connect to the next sentinel if the role is wrong', function (done) {
      var sentinel = new MockServer(26379, function (argv) {
        if (argv[0] === 'sentinel' && argv[1] === 'slaves' && argv[2] === 'master') {
          return [['ip', '127.0.0.1', 'port', '16381', 'flags', 'slave']];
        }
      });

      var sentinel2 = new MockServer(26380);
      sentinel2.on('connect', function (c) {
        redis.disconnect();
        sentinel.disconnect(function () {
          slave.disconnect(function () {
            sentinel2.disconnect(done);
          });
        });
      });

      var slave = new MockServer(16381, function (argv) {
        if (argv[0] === 'info') {
          return 'role:slave';
        }
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '26379' },
          { host: '127.0.0.1', port: '26380' }
        ],
        name: 'master',
        role: 'master',
        roleRetryDelay: 0,
        retryStrategy: null
      });
    });
  });
});
