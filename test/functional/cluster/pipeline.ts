import calculateSlot from 'cluster-key-slot'
import MockServer from '../../helpers/mock_server'
import {expect} from 'chai'
import {Cluster} from '../../../lib'
import * as sinon from 'sinon'

describe('cluster:pipeline', function () {
  it('should throw when not all keys belong to the same slot', function (done) {
    var slotTable = [
      [0, 12181, ['127.0.0.1', 30001]],
      [12182, 12183, ['127.0.0.1', 30002]],
      [12184, 16383, ['127.0.0.1', 30001]]
    ];
    new MockServer(30001, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
    });
    new MockServer(30002, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
    });

    var cluster = new Cluster([
      { host: '127.0.0.1', port: '30001' }
    ]);
    cluster.pipeline().set('foo', 'bar').get('foo2').exec().catch(function (err) {
      expect(err.message).to.match(/All keys in the pipeline should belong to the same slot/);
      cluster.disconnect();
      done();
    });
  });

  it('should auto redirect commands on MOVED', function (done) {
    var moved = false;
    var slotTable = [
      [0, 12181, ['127.0.0.1', 30001]],
      [12182, 12183, ['127.0.0.1', 30002]],
      [12184, 16383, ['127.0.0.1', 30001]]
    ];
    new MockServer(30001, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
      if (argv[0] === 'get' && argv[1] === 'foo') {
        return 'bar';
      }
    });
    new MockServer(30002, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
      if (argv[1] === 'foo') {
        if (argv[0] === 'set') {
          expect(moved).to.eql(false);
          moved = true;
        }
        return new Error('MOVED ' + calculateSlot('foo') + ' 127.0.0.1:30001');
      }
    });

    var cluster = new Cluster([
      { host: '127.0.0.1', port: '30001' }
    ]);
    cluster.pipeline().get('foo').set('foo', 'bar').exec(function (err, result) {
      expect(err).to.eql(null);
      expect(result[0]).to.eql([null, 'bar']);
      expect(result[1]).to.eql([null, 'OK']);
      cluster.disconnect();
      done();
    });
  });

  it('should auto redirect commands on ASK', function (done) {
    var asked = false;
    var slotTable = [
      [0, 12181, ['127.0.0.1', 30001]],
      [12182, 12183, ['127.0.0.1', 30002]],
      [12184, 16383, ['127.0.0.1', 30001]]
    ];
    new MockServer(30001, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
      if (argv[0] === 'asking') {
        asked = true;
      }
      if (argv[0] === 'get' && argv[1] === 'foo') {
        expect(asked).to.eql(true);
        return 'bar';
      }
      if (argv[0] !== 'asking') {
        asked = false;
      }
    });
    new MockServer(30002, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
      if (argv[1] === 'foo') {
        return new Error('ASK ' + calculateSlot('foo') + ' 127.0.0.1:30001');
      }
    });

    var cluster = new Cluster([
      { host: '127.0.0.1', port: '30001' }
    ]);
    cluster.pipeline().get('foo').set('foo', 'bar').exec(function (err, result) {
      expect(err).to.eql(null);
      expect(result[0]).to.eql([null, 'bar']);
      expect(result[1]).to.eql([null, 'OK']);
      cluster.disconnect();
      done();
    });
  });

  it('should retry the command on TRYAGAIN', function (done) {
    var times = 0;
    var slotTable = [
      [0, 16383, ['127.0.0.1', 30001]]
    ];
    new MockServer(30001, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
      if (argv[1] === 'foo') {
        if (times++ < 2) {
          return new Error('TRYAGAIN Multiple keys request during rehashing of slot');
        }
      }
    });

    var cluster = new Cluster([
      { host: '127.0.0.1', port: '30001' }
    ], { retryDelayOnTryAgain: 1 });
    cluster.pipeline().get('foo').set('foo', 'bar').exec(function (err, result) {
      expect(result[0][1]).to.eql('OK');
      expect(result[1][1]).to.eql('OK');
      cluster.disconnect();
      done();
    });
  });

  it('should not redirect commands on a non-readonly command is successful', function (done) {
    var slotTable = [
      [0, 12181, ['127.0.0.1', 30001]],
      [12182, 12183, ['127.0.0.1', 30002]],
      [12184, 16383, ['127.0.0.1', 30001]]
    ];
    new MockServer(30001, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
      if (argv[0] === 'get' && argv[1] === 'foo') {
        return 'bar';
      }
    });
    new MockServer(30002, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
      if (argv[0] === 'get' && argv[1] === 'foo') {
        return new Error('MOVED ' + calculateSlot('foo') + ' 127.0.0.1:30001');
      }
    });

    var cluster = new Cluster([
      { host: '127.0.0.1', port: '30001' }
    ]);
    cluster.pipeline().get('foo').set('foo', 'bar').exec(function (err, result) {
      expect(err).to.eql(null);
      expect(result[0][0].message).to.match(/MOVED/);
      expect(result[1]).to.eql([null, 'OK']);
      cluster.disconnect();
      done();
    });
  });

  it('should retry when redis is down', function (done) {
    var slotTable = [
      [0, 12181, ['127.0.0.1', 30001]],
      [12182, 12183, ['127.0.0.1', 30002]],
      [12184, 16383, ['127.0.0.1', 30001]]
    ];
    new MockServer(30001, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
    });
    var node2 = new MockServer(30002, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
      if (argv[0] === 'get' && argv[1] === 'foo') {
        return 'bar';
      }
    });

    var cluster = new Cluster([
      { host: '127.0.0.1', port: '30001' }
    ], { retryDelayOnFailover: 1 });
    const stub = sinon.stub(cluster, 'refreshSlotsCache').callsFake((...args) => {
      node2.connect();
      stub.restore();
      cluster.refreshSlotsCache(...args);
    });
    node2.disconnect();
    cluster.pipeline().get('foo').set('foo', 'bar').exec(function (err, result) {
      expect(err).to.eql(null);
      expect(result[0]).to.eql([null, 'bar']);
      expect(result[1]).to.eql([null, 'OK']);
      cluster.disconnect();
      done();
    });
  });
});
