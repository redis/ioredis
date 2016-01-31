'use strict';

var utils = require('../../lib/utils');
var Promise = require('bluebird');

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
        cluster.disconnect();
        done();
      });
    });

    it('should invoke clusterRetryStrategy when none nodes are ready', function (done) {
      var argvHandler = function (argv) {
        if (argv[0] === 'cluster') {
          return new Error('CLUSTERDOWN');
        }
      };
      var node1 = new MockServer(30001, argvHandler);
      var node2 = new MockServer(30002, argvHandler);

      var t = 0;
      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' },
        { host: '127.0.0.1', port: '30002' }
      ], {
        clusterRetryStrategy: function (times) {
          expect(times).to.eql(++t);
          if (times === 3) {
            cluster.disconnect();
            disconnect([node1, node2], done);
            return;
          }
          return 0;
        }
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

    it('should support url schema', function (done) {
      var node = new MockServer(30001);

      var cluster = new Redis.Cluster([
        'redis://127.0.0.1:30001'
      ]);

      node.once('connect', function () {
        cluster.disconnect();
        disconnect([node], done);
      });
    });

    it('should support a single port', function (done) {
      var node = new MockServer(30001);

      var cluster = new Redis.Cluster([30001]);

      node.once('connect', function () {
        cluster.disconnect();
        disconnect([node], done);
      });
    });

    it('should return a promise to be resolved when connected', function (done) {
      var slotTable = [
        [0, 5460, ['127.0.0.1', 30001]],
        [5461, 10922, ['127.0.0.1', 30002]],
        [10923, 16383, ['127.0.0.1', 30003]]
      ];
      var argvHandler = function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
      };
      var node1 = new MockServer(30001, argvHandler);
      var node2 = new MockServer(30002, argvHandler);
      var node3 = new MockServer(30003, argvHandler);

      stub(Redis.Cluster.prototype, 'connect', function () {
        return Promise.resolve();
      });
      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' }
      ], { lazyConnect: false });
      Redis.Cluster.prototype.connect.restore();

      cluster.connect().then(function () {
        cluster.disconnect();
        disconnect([node1, node2, node3], done);
      });
    });

    it('should return a promise to be rejected when closed', function (done) {
      stub(Redis.Cluster.prototype, 'connect', function () {
        return Promise.resolve();
      });
      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' }
      ], { lazyConnect: false });
      Redis.Cluster.prototype.connect.restore();

      cluster.connect().catch(function () {
        cluster.disconnect();
        done();
      });
    });

    it('should stop reconnecting when disconnected', function (done) {
      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' }
      ], {
        clusterRetryStrategy: function () {
          return 0;
        }
      });

      cluster.on('close', function () {
        cluster.disconnect();
        stub(Redis.Cluster.prototype, 'connect').throws(new Error('`connect` should not be called'));
        setTimeout(function () {
          Redis.Cluster.prototype.connect.restore();
          done();
        }, 1);
      });
    });

    it('should discover other nodes automatically', function (done) {
      var slotTable = [
        [0, 5460, ['127.0.0.1', 30001]],
        [5461, 10922, ['127.0.0.1', 30002]],
        [10923, 16383, ['127.0.0.1', 30003]]
      ];
      var argvHandler = function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
      };
      var node1 = new MockServer(30001, argvHandler);
      var node2 = new MockServer(30002, argvHandler);
      var node3 = new MockServer(30003, argvHandler);

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

    it('should emit errors when cluster cannot be connected', function (done) {
      var errorMessage = 'ERR This instance has cluster support disabled';
      var argvHandler = function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return new Error(errorMessage);
        }
      };
      var node1 = new MockServer(30001, argvHandler);
      var node2 = new MockServer(30002, argvHandler);

      var pending = 2;
      var retry = 0;
      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' },
        { host: '127.0.0.1', port: '30002' }
      ], {
        clusterRetryStrategy: function () {
          cluster.once('error', function (err) {
            retry = false;
            expect(err.message).to.eql('Failed to refresh slots cache.');
            expect(err.lastNodeError.message).to.eql(errorMessage);
            checkDone();
          });
          return retry;
        }
      });

      cluster.once('node error', function (err) {
        expect(err.message).to.eql(errorMessage);
        checkDone();
      });
      function checkDone() {
        if (!--pending) {
          cluster.disconnect();
          disconnect([node1, node2], done);
        }
      }
    });

    it('should using the specified password', function (done) {
      var node1, node2, node3;
      var slotTable = [
        [0, 5460, ['127.0.0.1', 30001]],
        [5461, 10922, ['127.0.0.1', 30002]],
        [10923, 16383, ['127.0.0.1', 30003]]
      ];
      var argvHandler = function (port, argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
        if (argv[0] === 'auth') {
          var password = argv[1];
          if (port === 30001) {
            expect(password).to.eql('other password');
          } else if (port === 30002) {
            throw new Error('30002 got password');
          } else if (port === 30003) {
            expect(password).to.eql('default password');
            cluster.disconnect();
            disconnect([node1, node2, node3], done);
          }
        }
      };
      node1 = new MockServer(30001, argvHandler.bind(null, 30001));
      node2 = new MockServer(30002, argvHandler.bind(null, 30002));
      node3 = new MockServer(30003, argvHandler.bind(null, 30003));

      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001', password: 'other password' },
        { host: '127.0.0.1', port: '30002' }
      ], { lazyConnect: false, password: 'default password' });
    });
  });

  describe('MOVED', function () {
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

  describe('CLUSTERDOWN', function () {
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
        expect(redirectTimes).to.eql(6);
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
    cluster.get('foo', 'bar', function (err) {
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
    it('should throw when not all keys belong to the same slot', function (done) {
      var slotTable = [
        [0, 12181, ['127.0.0.1', 30001]],
        [12182, 12183, ['127.0.0.1', 30002]],
        [12184, 16383, ['127.0.0.1', 30001]]
      ];
      var node1 = new MockServer(30001, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
      });
      var node2 = new MockServer(30002, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
      });

      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' }
      ]);
      cluster.pipeline().set('foo', 'bar').get('foo2').exec().catch(function (err) {
        expect(err.message).to.match(/All keys in the pipeline should belong to the same slot/);
        cluster.disconnect();
        disconnect([node1, node2], done);
      });
    });

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
        if (argv[0] === 'get' && argv[1] === 'foo') {
          return 'bar';
        }
      });
      var node2 = new MockServer(30002, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
        if (argv[1] === 'foo') {
          if (argv[0] === 'set') {
            expect(moved).to.eql(false);
            moved = true;
          }
          return new Error('MOVED ' + utils.calcSlot('foo') + ' 127.0.0.1:30001');
        }
      });

      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' }
      ]);
      cluster.pipeline().get('foo').set('foo', 'bar').exec(function (err, result) {
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
        if (argv[0] === 'get' && argv[1] === 'foo') {
          expect(asked).to.eql(true);
          return 'bar';
        }
        if (argv[0] !== 'asking') {
          asked = false;
        }
      });
      var node2 = new MockServer(30002, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
        if (argv[1] === 'foo') {
          return new Error('ASK ' + utils.calcSlot('foo') + ' 127.0.0.1:30001');
        }
      });

      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' }
      ]);
      cluster.pipeline().get('foo').set('foo', 'bar').exec(function (err, result) {
        expect(err).to.eql(null);
        expect(result[0]).to.eql([null, 'bar']);
        expect(result[1]).to.eql([null, 'OK']);
        cluster.disconnect();
        disconnect([node1, node2], done);
      });
    });

    it('should not redirect commands on a non-readonly command is successful', function (done) {
      var slotTable = [
        [0, 12181, ['127.0.0.1', 30001]],
        [12182, 12183, ['127.0.0.1', 30002]],
        [12184, 16383, ['127.0.0.1', 30001]]
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
          return new Error('MOVED ' + utils.calcSlot('foo') + ' 127.0.0.1:30001');
        }
      });

      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' }
      ]);
      cluster.pipeline().get('foo').set('foo', 'bar').exec(function (err, result) {
        expect(err).to.eql(null);
        expect(result[0][0].message).to.match(/MOVED/);
        expect(result[1]).to.eql([null, 'OK']);
        cluster.disconnect();
        disconnect([node1, node2], done);
      });
    });

    it('should retry when redis is down', function (done) {
      var slotTable = [
        [0, 12181, ['127.0.0.1', 30001]],
        [12182, 12183, ['127.0.0.1', 30002]],
        [12184, 16383, ['127.0.0.1', 30001]]
      ];
      var node1 = new MockServer(30001, function (argv) {
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

      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' }
      ], { retryDelayOnFailover: 1 });
      stub(cluster, 'refreshSlotsCache', function () {
        node2.connect();
        cluster.refreshSlotsCache.restore();
        cluster.refreshSlotsCache.apply(cluster, arguments);
      });
      node2.disconnect();
      cluster.pipeline().get('foo').set('foo', 'bar').exec(function (err, result) {
        expect(err).to.eql(null);
        expect(result[0]).to.eql([null, 'bar']);
        expect(result[1]).to.eql([null, 'OK']);
        cluster.disconnect();
        disconnect([node1, node2], done);
      });
    });
  });

  describe('transaction', function () {
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
          return new Error('MOVED ' + utils.calcSlot('foo') + ' 127.0.0.1:30001');
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
          return new Error('ASK ' + utils.calcSlot('foo') + ' 127.0.0.1:30001');
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

  describe('pub/sub', function () {
    it('should receive messages', function (done) {
      var handler = function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return [
            [0, 1, ['127.0.0.1', 30001]],
            [2, 16383, ['127.0.0.1', 30002]]
          ];
        }
      };
      var node1 = new MockServer(30001, handler);
      var node2 = new MockServer(30002, handler);

      var options = [{ host: '127.0.0.1', port: '30001' }];
      var sub = new Redis.Cluster(options);

      sub.subscribe('test cluster', function () {
        node1.write(node1.clients[0], ['message', 'test channel', 'hi']);
      });
      sub.on('message', function (channel, message) {
        expect(channel).to.eql('test channel');
        expect(message).to.eql('hi');
        sub.disconnect();
        disconnect([node1, node2], done);
      });
    });

    it('should re-subscribe after reconnection', function (done) {
      var server = new MockServer(30001, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return [
            [0, 16383, ['127.0.0.1', 30001]]
          ];
        } else if (argv[0] === 'subscribe' || argv[0] === 'psubscribe') {
          return [argv[0], argv[1]];
        }
      });
      var client = new Redis.Cluster([{ host: '127.0.0.1', port: '30001' }]);

      client.subscribe('test cluster', function () {
        stub(Redis.prototype, 'subscribe', function (channels) {
          expect(channels).to.eql(['test cluster']);
          Redis.prototype.subscribe.restore();
          client.disconnect();
          disconnect([server], done);
          return Redis.prototype.subscribe.apply(this, arguments);
        });
        client.on('end', function () {
          client.connect();
        });
        client.disconnect();
      });
    });

    it('should re-psubscribe after reconnection', function (done) {
      var server = new MockServer(30001, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return [
            [0, 16383, ['127.0.0.1', 30001]]
          ];
        } else if (argv[0] === 'subscribe' || argv[0] === 'psubscribe') {
          return [argv[0], argv[1]];
        }
      });
      var client = new Redis.Cluster([{ host: '127.0.0.1', port: '30001' }]);

      client.psubscribe('test?', function () {
        stub(Redis.prototype, 'psubscribe', function (channels) {
          expect(channels).to.eql(['test?']);
          Redis.prototype.psubscribe.restore();
          client.disconnect();
          disconnect([server], done);
          return Redis.prototype.psubscribe.apply(this, arguments);
        });
        client.on('end', function () {
          client.connect();
        });
        client.disconnect();
      });
    });
  });

  describe('readonly', function () {
    it('should connect all nodes and issue a readonly', function (done) {
      var setReadOnlyNode1 = false;
      var setReadOnlyNode2 = false;
      var setReadOnlyNode3 = false;
      var slotTable = [
        [0, 5460, ['127.0.0.1', 30001], ['127.0.0.1', 30003]],
        [5461, 10922, ['127.0.0.1', 30002]]
      ];
      var node1 = new MockServer(30001, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
        if (argv[0] === 'readonly') {
          setReadOnlyNode1 = true;
          return 'OK';
        }
      });
      var node2 = new MockServer(30002, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
        if (argv[0] === 'readonly') {
          setReadOnlyNode2 = true;
          return 'OK';
        }
      });

      var node3 = new MockServer(30003, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
        if (argv[0] === 'readonly') {
          setReadOnlyNode3 = true;
          return 'OK';
        }
      });

      var cluster = new Redis.Cluster(
        [{ host: '127.0.0.1', port: '30001' }],
        { readOnly: true }
      );
      cluster.on('ready', function () {
        expect(setReadOnlyNode1 || setReadOnlyNode2 || setReadOnlyNode3).to.eql(true);
        cluster.disconnect();
        disconnect([node1, node2, node3], done);
      });

    });
  });

  describe('#masterNodes', function () {
    it('should contains master nodes', function (done) {
      var slotTable = [
        [0, 5460, ['127.0.0.1', 30001], ['127.0.0.1', 30003]],
        [5461, 10922, ['127.0.0.1', 30002]]
      ];
      var node1 = new MockServer(30001, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
      });
      var node2 = new MockServer(30002, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
      });

      var node3 = new MockServer(30003, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
      });

      var cluster = new Redis.Cluster([{ host: '127.0.0.1', port: '30001' }]);
      cluster.on('ready', function () {
        cluster.nodes['127.0.0.1:30001'].on('end', function () {
          expect(Object.keys(cluster.masterNodes).length).to.eql(1);
          cluster.disconnect();
          disconnect([node2, node3], done);
        });
        disconnect([node1]);
      });

    });
  });

  describe('#getInfoFromNode', function () {
    it('should refresh master nodes', function (done) {
      var slotTable = [
        [0, 5460, ['127.0.0.1', 30001], ['127.0.0.1', 30003]],
        [5461, 10922, ['127.0.0.1', 30002]]
      ];
      var node1 = new MockServer(30001, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
      });
      var node2 = new MockServer(30002, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
      });

      var node3 = new MockServer(30003, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
      });

      var cluster = new Redis.Cluster([{ host: '127.0.0.1', port: '30001' }]);
      cluster.on('ready', function () {
        expect(Object.keys(cluster.masterNodes).length).to.eql(2);
        slotTable = [
          [0, 5460, ['127.0.0.1', 30003]],
          [5461, 10922, ['127.0.0.1', 30002]]
        ];
        cluster.refreshSlotsCache(function () {
          expect(Object.keys(cluster.masterNodes).length).to.eql(2);
          expect(cluster.masterNodes).to.have.property('127.0.0.1:30003');
          expect(cluster.masterNodes).to.have.property('127.0.0.1:30002');
          cluster.disconnect();
          disconnect([node1, node2, node3], done);
        });
      });
    });
  });

  describe('#to', function () {
    it('should throw when the group does not exist', function () {
      stub(Redis.Cluster.prototype, 'connect', function () {
        return Promise.resolve();
      });
      var cluster = new Redis.Cluster([{}]);
      expect(function () {
        cluster.to('non-exist');
      }).to.throw(/is not a valid group of nodes/);
      Redis.Cluster.prototype.connect.restore();
    });

    it('should return the correct nodes', function (done) {
      var slotTable = [
        [0, 5460, ['127.0.0.1', 30001], ['127.0.0.1', 30003]],
        [5461, 16383, ['127.0.0.1', 30002]]
      ];
      var argvHandler = function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        } else if (argv[0] === 'keys') {
          return ['key' + this.port];
        }
      };
      var node1 = new MockServer(30001, argvHandler);
      var node2 = new MockServer(30002, argvHandler);
      var node3 = new MockServer(30003, argvHandler);
      var pending = 3;
      [node1, node2, node3].forEach(function (node) {
        node.on('connect', function () {
          if (!--pending) {
            run();
          }
        });
      });
      var cluster = new Redis.Cluster([{ host: '127.0.0.1', port: '30001' }], { readOnly: true });
      function run() {
        expect(cluster.to('masters').nodes).to.have.lengthOf(2);
        expect(cluster.to('slaves').nodes).to.have.lengthOf(1);
        expect(cluster.to('all').nodes).to.have.lengthOf(3);
        cluster.to('masters').call('keys', function (err, keys) {
          expect(keys).to.have.lengthOf(2);
          expect([].concat.apply([], keys).sort()).to.eql(['key30001', 'key30002']);
          cluster.disconnect();
          disconnect([node1, node2, node3], done);
        });
      }
    });
  });
});

function disconnect(clients, callback) {
  var pending = 0;

  for (var i = 0; i < clients.length; ++i) {
    pending += 1;
    clients[i].disconnect(check);
  }

  function check() {
    if (!--pending && callback) {
      callback();
    }
  }
}
