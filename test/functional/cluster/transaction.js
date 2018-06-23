var calculateSlot = require('cluster-key-slot');
var disconnect = require('./_helpers').disconnect;

describe('cluster:transaction', function () {
  it('should auto redirect commands on MOVED', function (done) {
    var moved = false;
    var slotTable = [
      [0, 12181, ['127.0.0.1', 30001]],
      [12182, 12183, ['127.0.0.1', 30002]],
      [12184, 16383, ['127.0.0.1', 30001]]
    ];
    var node1 = new MockServer(30001, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
      if (argv[1] === 'foo') {
        return 'QUEUED';
      }
      if (argv[0] === 'exec') {
        expect(moved).to.eql(true);
        return ['bar', 'OK'];
      }
    });
    var node2 = new MockServer(30002, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
      if (argv[0] === 'get' && argv[1] === 'foo') {
        moved = true;
        return new Error('MOVED ' + calculateSlot('foo') + ' 127.0.0.1:30001');
      }
      if (argv[0] === 'exec') {
        return new Error('EXECABORT Transaction discarded because of previous errors.');
      }
    });

    var cluster = new Redis.Cluster([
      { host: '127.0.0.1', port: '30001' }
    ]);
    cluster.multi().get('foo').set('foo', 'bar').exec(function (err, result) {
      expect(err).to.eql(null);
      expect(result[0]).to.eql([null, 'bar']);
      expect(result[1]).to.eql([null, 'OK']);
      cluster.disconnect();
      disconnect([node1, node2], done);
    });
  });

  it('should auto redirect commands on ASK', function (done) {
    var asked = false;
    var slotTable = [
      [0, 12181, ['127.0.0.1', 30001]],
      [12182, 12183, ['127.0.0.1', 30002]],
      [12184, 16383, ['127.0.0.1', 30001]]
    ];
    var node1 = new MockServer(30001, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
      if (argv[0] === 'asking') {
        asked = true;
      }
      if (argv[0] === 'multi') {
        expect(asked).to.eql(true);
      }
      if (argv[0] === 'get' && argv[1] === 'foo') {
        expect(asked).to.eql(false);
        return 'bar';
      }
      if (argv[0] === 'exec') {
        expect(asked).to.eql(false);
        return ['bar', 'OK'];
      }
      if (argv[0] !== 'asking') {
        asked = false;
      }
    });
    var node2 = new MockServer(30002, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
      if (argv[0] === 'get' && argv[1] === 'foo') {
        return new Error('ASK ' + calculateSlot('foo') + ' 127.0.0.1:30001');
      }
      if (argv[0] === 'exec') {
        return new Error('EXECABORT Transaction discarded because of previous errors.');
      }
    });

    var cluster = new Redis.Cluster([
      { host: '127.0.0.1', port: '30001' }
    ]);
    cluster.multi().get('foo').set('foo', 'bar').exec(function (err, result) {
      expect(err).to.eql(null);
      expect(result[0]).to.eql([null, 'bar']);
      expect(result[1]).to.eql([null, 'OK']);
      cluster.disconnect();
      disconnect([node1, node2], done);
    });
  });
});
