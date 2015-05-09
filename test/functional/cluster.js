'use strict';

var utils = require('../../lib/utils');

describe('cluster', function () {
  describe('connect', function () {
    it('should flush the queue when all startup nodes are unreachable', function (done) {
      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' }
      ], { clusterRetryStrategy: null });

      cluster.get('foo', function (err) {
        expect(err.message).to.match(/None of startup nodes is available/);
        cluster.disconnect();
        done();
      });
    });

    it('should invoke clusterRetryStrategy when all startup nodes are unreachable', function (done) {
      var t = 0;
      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' },
        { host: '127.0.0.1', port: '30002' }
      ], {
        clusterRetryStrategy: function (times) {
          expect(times).to.eql(++t);
          if (times === 3) {
            return;
          }
          return 0;
        }
      });

      cluster.get('foo', function (err) {
        expect(t).to.eql(3);
        expect(err.message).to.match(/None of startup nodes is available/);
        done();
      });
    });

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

    it('should send command to the correct node', function (done) {
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
          process.nextTick(function () {
            cluster.disconnect();
            disconnect([node1, node2], done);
          });
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
      var slotTable = [
        [0, 1, ['127.0.0.1', 30001]],
        [2, 16383, ['127.0.0.1', 30002]]
      ];
      var node1 = new MockServer(30001, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
        if (argv[0] === 'get' && argv[1] === 'foo') {
          if (times++ === 1) {
            expect(moved).to.eql(true);
            process.nextTick(function () {
              cluster.disconnect();
              disconnect([node1, node2], done);
            });
          }
        }
      });
      var node2 = new MockServer(30002, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
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

    it('should auto redirect the command within a pipeline', function (done) {
      var moved = false;
      var times = 0;
      var slotTable = [
        [0, 1, ['127.0.0.1', 30001]],
        [2, 16383, ['127.0.0.1', 30002]]
      ];
      var node1 = new MockServer(30001, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
        if (argv[0] === 'get' && argv[1] === 'foo') {
          if (times++ === 1) {
            expect(moved).to.eql(true);
            process.nextTick(function () {
              cluster.disconnect();
              disconnect([node1, node2], done);
            });
          }
        }
      });
      var node2 = new MockServer(30002, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
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
      var slotTable = [
        [0, 1, ['127.0.0.1', 30001]],
        [2, 16383, ['127.0.0.1', 30002]]
      ];
      var node1 = new MockServer(30001, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
        if (argv[0] === 'get' && argv[1] === 'foo') {
          expect(asked).to.eql(true);
        } else if (argv[0] === 'asking') {
          asked = true;
        }
      });
      var node2 = new MockServer(30002, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
        if (argv[0] === 'get' && argv[1] === 'foo') {
          if (++times === 2) {
            process.nextTick(function () {
              cluster.disconnect();
              disconnect([node1, node2], done);
            });
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

  describe('maxRedirections', function () {
    it('should return error when reached max redirection', function (done) {
      var redirectTimes = 0;
      var argvHandler = function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return [
            [0, 1, ['127.0.0.1', 30001]],
            [2, 16383, ['127.0.0.1', 30002]]
          ];
        } else if (argv[0] === 'get' && argv[1] === 'foo') {
          redirectTimes += 1;
          return new Error('ASK ' + utils.calcSlot('foo') + ' 127.0.0.1:30001');
        }
      };
      var node1 = new MockServer(30001, argvHandler);
      var node2 = new MockServer(30002, argvHandler);

      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' }
      ], { maxRedirections: 5 });
      cluster.get('foo', function (err) {
        expect(redirectTimes).to.eql(5);
        expect(err.message).to.match(/Too many Cluster redirections/);
        cluster.disconnect();
        disconnect([node1, node2], done);
      });
    });
  });

  describe('refreshAfterFails', function () {
    it('should re-fetch slots when reached refreshAfterFails', function (done) {
      var redirectTimes = 0;
      var argvHandler = function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          if (redirectTimes === 4) {
            cluster.disconnect();
            disconnect([node1, node2], done);
          }
          return [
            [0, 1, ['127.0.0.1', 30001]],
            [2, 16383, ['127.0.0.1', 30002]]
          ];
        } else if (argv[0] === 'get' && argv[1] === 'foo') {
          if (redirectTimes < 4) {
            redirectTimes += 1;
            return new Error('MOVED ' + utils.calcSlot('foo') + ' 127.0.0.1:30001');
          }
        }
      };
      var node1 = new MockServer(30001, argvHandler);
      var node2 = new MockServer(30002, argvHandler);

      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' }
      ], { refreshAfterFails: 4 });
      cluster.get('foo');
    });
  });

  it('should return the error successfully', function (done) {
    var called = false;
    var node1 = new MockServer(30001, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return [
          [0, 16383, ['127.0.0.1', 30001]]
        ];
      }
      if (argv.toString() === 'get,foo,bar') {
        called = true;
        return new Error('Wrong arguments count');
      }
    });

    var cluster = new Redis.Cluster([
      { host: '127.0.0.1', port: '30001' }
    ]);
    cluster.get('foo', 'bar', function (err, result) {
      expect(called).to.eql(true);
      expect(err.message).to.match(/Wrong arguments count/);
      cluster.disconnect();
      disconnect([node1], done);
    });
  });

  it('should get value successfully', function (done) {
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
        return 'bar';
      }
    });

    var cluster = new Redis.Cluster([
      { host: '127.0.0.1', port: '30001' }
    ]);
    cluster.get('foo', function (err, result) {
      expect(result).to.eql('bar');
      cluster.disconnect();
      disconnect([node1, node2], done);
    });
  });

  describe('pipeline', function () {
    it('should use the first key to calculate the slot', function (done) {
      var node1 = new MockServer(30001, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return [
            [0, 12181, ['127.0.0.1', 30001]],
            [12182, 12183, ['127.0.0.1', 30002]],
            [12184, 16383, ['127.0.0.1', 30001]],
          ];
        }
      });
      var pending = 2;
      var node2 = new MockServer(30002, function (argv) {
        if (argv.toString() === 'set,foo,bar') {
          pending -= 1;
        } else if (argv.toString() === 'get,foo2') {
          pending -= 1;
          if (!pending) {
            cluster.disconnect();
            disconnect([node1, node2], done);
          }
        }
      });

      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' }
      ]);
      cluster.pipeline().set('foo', 'bar').get('foo2').exec(function (err, result) {
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
