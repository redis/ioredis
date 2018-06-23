var disconnect = require('./_helpers').disconnect;

describe('cluster:CLUSTERDOWN', function () {
  it('should redirect the command to a random node', function (done) {
    var slotTable = [
      [0, 1, ['127.0.0.1', 30001]],
      [2, 16383, ['127.0.0.1', 30002]]
    ];
    var node1 = new MockServer(30001, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
      if (argv[0] === 'get' && argv[1] === 'foo') {
        return 'bar';
      }
    });
    var node2 = new MockServer(30002, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
      if (argv[0] === 'get' && argv[1] === 'foo') {
        return new Error('CLUSTERDOWN');
      }
    });

    var cluster = new Redis.Cluster([
      { host: '127.0.0.1', port: '30001' }
    ], {
      lazyConnect: false,
      retryDelayOnClusterDown: 1
    });
    cluster.get('foo', function (_, res) {
      expect(res).to.eql('bar');
      cluster.disconnect();
      disconnect([node1, node2], done);
    });
  });
});

