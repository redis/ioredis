var disconnect = require('./_helpers').disconnect;

describe('cluster:TRYAGAIN', function () {
  it('should retry the command', function (done) {
    var times = 0;
    var slotTable = [
      [0, 16383, ['127.0.0.1', 30001]]
    ];
    var server = new MockServer(30001, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
      if (argv[0] === 'get' && argv[1] === 'foo') {
        if (times++ === 1) {
          process.nextTick(function () {
            cluster.disconnect();
            disconnect([server], done);
          });
        } else {
          return new Error('TRYAGAIN Multiple keys request during rehashing of slot');
        }
      }
    });

    var cluster = new Redis.Cluster([
      { host: '127.0.0.1', port: '30001' }
    ], { retryDelayOnTryAgain: 1 });
    cluster.get('foo');
  });
});
