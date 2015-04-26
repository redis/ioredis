'use strict';

var utils = require('../../lib/utils');

describe('cluster', function () {
  describe('connect', function () {
    it('should connect to cluster successfully', function (done) {
      var node = new MockServer(30001);

      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' }
      ]);

      node.once('connect', function () {
        cluster.disconnect();
        disconnect([node], done);
      });
    });

    it('should discover other nodes automatically', function (done) {
      var node1 = new MockServer(30001, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return [
            [0, 5460, ['127.0.0.1', 30001]],
            [5461, 10922, ['127.0.0.1', 30002]],
            [10923, 16383, ['127.0.0.1', 30003]]
          ];
        }
      });
      var node2 = new MockServer(30002);
      var node3 = new MockServer(30003);

      var pending = 3;
      node1.once('connect', check);
      node2.once('connect', check);
      node3.once('connect', check);

      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' }
      ], { lazyConnect: false });

      function check () {
        if (!--pending) {
          cluster.disconnect();
          disconnect([node1, node2, node3], done);
        }
      }
    });

    it('should send command the the correct node', function (done) {
      var node1 = new MockServer(30001, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return [
            [0, 1, ['127.0.0.1', 30001]],
            [2, 16383, ['127.0.0.1', 30002]]
          ];
        }
      });
      var node2 = new MockServer(30002, function (argv) {
        if (argv[0] === 'get' && argv[1] === 'foo') {
          cluster.disconnect();
          disconnect([node1, node2], done);
        }
      });

      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' }
      ], { lazyConnect: false });
      cluster.get('foo');
    });
  });

  describe('MOVE', function () {
    it('should auto redirect the command to the correct nodes', function (done) {
      var moved = false;
      var times = 0;
      var node1 = new MockServer(30001, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return [
            [0, 1, ['127.0.0.1', 30001]],
            [2, 16383, ['127.0.0.1', 30002]]
          ];
        } else if (argv[0] === 'get' && argv[1] === 'foo') {
          if (times++ === 1) {
            expect(moved).to.eql(true);
            cluster.disconnect();
            disconnect([node1, node2], done);
          }
        }
      });
      var node2 = new MockServer(30002, function (argv) {
        if (argv[0] === 'get' && argv[1] === 'foo') {
          expect(moved).to.eql(false);
          moved = true;
          return new Error('MOVED ' + utils.calcSlot('foo') + ' 127.0.0.1:30001');
        }
      });

      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' }
      ], { lazyConnect: false });
      cluster.get('foo', function () {
        cluster.get('foo');
      });
    });
  });

  describe('ASK', function () {
    it('should support ASK', function (done) {
      var asked = false;
      var times = 0;
      var node1 = new MockServer(30001, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return [
            [0, 1, ['127.0.0.1', 30001]],
            [2, 16383, ['127.0.0.1', 30002]]
          ];
        } else if (argv[0] === 'get' && argv[1] === 'foo') {
          expect(asked).to.eql(true);
        } else if (argv[0] === 'asking') {
          asked = true;
        }
      });
      var node2 = new MockServer(30002, function (argv) {
        if (argv[0] === 'get' && argv[1] === 'foo') {
          if (++times === 2) {
            cluster.disconnect();
            disconnect([node1, node2], done);
          } else {
            return new Error('ASK ' + utils.calcSlot('foo') + ' 127.0.0.1:30001');
          }
        }
      });

      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' }
      ], { lazyConnect: false });
      cluster.get('foo', function () {
        cluster.get('foo');
      });
    });
  });
});

function disconnect (clients, callback) {
  var pending = 0;

  for (var i = 0; i < clients.length; ++i) {
    pending += 1;
    clients[i].disconnect(check);
  }

  function check () {
    if (!--pending) {
      callback();
    }
  }
}
