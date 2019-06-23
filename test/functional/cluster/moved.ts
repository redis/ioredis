import calculateSlot from 'cluster-key-slot'
import MockServer from '../../helpers/mock_server';
import {expect} from 'chai'
import {Cluster} from '../../../lib';

describe('cluster:MOVED', function () {
  it('should auto redirect the command to the correct nodes', function (done) {
    var cluster;
    var moved = false;
    var times = 0;
    var slotTable = [
      [0, 1, ['127.0.0.1', 30001]],
      [2, 16383, ['127.0.0.1', 30002]]
    ];
    new MockServer(30001, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
      if (argv[0] === 'get' && argv[1] === 'foo') {
        if (times++ === 1) {
          expect(moved).to.eql(true);
          process.nextTick(function () {
            cluster.disconnect();
            done();
          });
        }
      }
    });
    new MockServer(30002, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
      if (argv[0] === 'get' && argv[1] === 'foo') {
        expect(moved).to.eql(false);
        moved = true;
        slotTable[0][1] = 16381
        slotTable[1][0] = 16382
        return new Error('MOVED ' + calculateSlot('foo') + ' 127.0.0.1:30001');
      }
    });

    cluster = new Cluster([
      { host: '127.0.0.1', port: '30001' }
    ]);
    cluster.get('foo', function () {
      cluster.get('foo');
    });
  });

  it('should be able to redirect a command to a unknown node', function (done) {
    new MockServer(30001, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return [
          [0, 16383, ['127.0.0.1', 30001]]
        ];
      }
      if (argv[0] === 'get' && argv[1] === 'foo') {
        return new Error('MOVED ' + calculateSlot('foo') + ' 127.0.0.1:30002');
      }
    });
    new MockServer(30002, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return [
          [0, 16381, ['127.0.0.1', 30001]],
          [16382, 16383, ['127.0.0.1', 30002]]
        ];
      }
      if (argv[0] === 'get' && argv[1] === 'foo') {
        return 'bar';
      }
    });
    var cluster = new Cluster([
      { host: '127.0.0.1', port: '30001' }
    ], { retryDelayOnFailover: 1 });
    cluster.get('foo', function (err, res) {
      expect(res).to.eql('bar');
      cluster.disconnect();
      done();
    });
  });

  it('should auto redirect the command within a pipeline', function (done) {
    var cluster;
    var moved = false;
    var times = 0;
    var slotTable = [
      [0, 1, ['127.0.0.1', 30001]],
      [2, 16383, ['127.0.0.1', 30002]]
    ];
    new MockServer(30001, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
      if (argv[0] === 'get' && argv[1] === 'foo') {
        if (times++ === 1) {
          expect(moved).to.eql(true);
          process.nextTick(function () {
            cluster.disconnect();
            done();
          });
        }
      }
    });
    new MockServer(30002, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return slotTable;
      }
      if (argv[0] === 'get' && argv[1] === 'foo') {
        expect(moved).to.eql(false);
        moved = true;
        slotTable[0][1] = 16381
        slotTable[1][0] = 16382
        return new Error('MOVED ' + calculateSlot('foo') + ' 127.0.0.1:30001');
      }
    });

    cluster = new Cluster([
      { host: '127.0.0.1', port: '30001' }
    ], { lazyConnect: false });
    cluster.get('foo', function () {
      cluster.get('foo');
    });
  });
});
