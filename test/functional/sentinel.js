describe('sentinel', function () {
  describe('connect', function () {
    it('should connect to sentinel successfully', function (done) {
      var sentinel = new MockServer(26379);
      sentinel.once('connect', function () {
        sentinel.disconnect(done);
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '26379' }
        ],
        name: 'master'
      });

    });

    it('should try to connect to all sentinel', function (done) {
      var sentinel = new MockServer(26380);
      sentinel.once('connect', function () {
        sentinel.disconnect(done);
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '26379' },
          { host: '127.0.0.1', port: '26380' }
        ],
        name: 'master'
      });
    });

    it('should raise error when all sentinel are unreachable', function (done) {
      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '26379' },
          { host: '127.0.0.1', port: '26380' }
        ],
        name: 'master'
      });

      redis.once('error', function (error) {
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
        name: 'master'
      });

      redis.once('error', function (err) {
        var sentinel = new MockServer(26380);
        sentinel.once('connect', function () {
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
        name: 'master'
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
        sentinel.disconnect(function () {
          master.disconnect(done);
        });
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '26379' }
        ],
        name: 'master'
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
        sentinel.disconnect(function () {
          sentinel2.disconnect(done);
        });
      });

      var redis = new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '26379' },
          { host: '127.0.0.1', port: '26380' }
        ],
        name: 'master'
      });
    });

    it('should connect to the next sentinel if the role is wrong', function (done) {
      var sentinel = new MockServer(26379, function (argv) {
        if (argv[0] === 'sentinel' && argv[1] === 'get-master-addr-by-name') {
          return ['127.0.0.1', '16380'];
        }
      });

      var sentinel2 = new MockServer(26380);
      sentinel2.on('connect', function () {
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
        roleRetryDelay: 0
      });
    });
  });
});
