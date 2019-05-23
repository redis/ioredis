'use strict';

var utils = require('../../../lib/utils');

describe('cluster', function () {
  it('should return the error successfully', function (done) {
    var called = false;
    new MockServer(30001, function (argv) {
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
      done();
    });
  });

  it('should get value successfully', function (done) {
    new MockServer(30001, function (argv) {
      if (argv[0] === 'cluster' && argv[1] === 'slots') {
        return [
          [0, 1, ['127.0.0.1', 30001]],
          [2, 16383, ['127.0.0.1', 30002]]
        ];
      }
    });
    new MockServer(30002, function (argv) {
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
      done();
    });
  });

  describe('enableReadyCheck', function () {
    it('should reconnect when cluster state is not ok', function (done) {
      var state = 'fail';
      new MockServer(30001, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return [
            [0, 16383, ['127.0.0.1', 30001]]
          ];
        } else if (argv[0] === 'cluster' && argv[1] === 'info') {
          return 'cluster_state:' + state;
        }
      });
      var count = 0;
      var client = new Redis.Cluster([{
        host: '127.0.0.1', port: '30001'
      }], {
        clusterRetryStrategy: function (times) {
          expect(++count).to.eql(times);
          if (count === 3) {
            state = 'ok';
          }
          return 0;
        }
      });
      client.on('ready', function () {
        client.disconnect();
        done();
      });
    });
  });

  describe('startupNodes', function () {
    it('should allow updating startupNodes', function (done) {
      new MockServer(30001, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return [
            [0, 16383, ['127.0.0.1', 30001]]
          ];
        }
        if (argv[0] === 'cluster' && argv[1] === 'info') {
          return 'cluster_state:fail';
        }
      });
      var client = new Redis.Cluster([{
        host: '127.0.0.1', port: '30001'
      }], {
        clusterRetryStrategy: function () {
          this.startupNodes = [{ port: 30002 }];
          return 0;
        }
      });
      let hasDone = false
      new MockServer(30002, function () {
        if (hasDone) {
          return
        }
        hasDone = true
        client.disconnect();
        done();
      });
    });
  });

  describe('scaleReads', function () {
    beforeEach(function () {
      function handler(port, argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return [
            [0, 16381, ['127.0.0.1', 30001], ['127.0.0.1', 30003], ['127.0.0.1', 30004]],
            [16382, 16383, ['127.0.0.1', 30002]]
          ];
        }
        return port;
      }
      this.node1 = new MockServer(30001, handler.bind(null, 30001));
      this.node2 = new MockServer(30002, handler.bind(null, 30002));
      this.node3 = new MockServer(30003, handler.bind(null, 30003));
      this.node4 = new MockServer(30004, handler.bind(null, 30004));
    });

    context('master', function () {
      it('should only send reads to master', function (done) {
        var cluster = new Redis.Cluster([{ host: '127.0.0.1', port: '30001' }]);
        cluster.on('ready', function () {
          stub(utils, 'sample').throws('sample is called');
          cluster.get('foo', function (err, res) {
            utils.sample.restore();
            expect(res).to.eql(30001);
            cluster.disconnect();
            done();
          });
        });
      });
    });

    context('slave', function () {
      it('should only send reads to slave', function (done) {
        var cluster = new Redis.Cluster([{ host: '127.0.0.1', port: '30001' }], {
          scaleReads: 'slave'
        });
        cluster.on('ready', function () {
          stub(utils, 'sample').callsFake((array, from) => {
            expect(array).to.eql(['127.0.0.1:30001', '127.0.0.1:30003', '127.0.0.1:30004']);
            expect(from).to.eql(1);
            return '127.0.0.1:30003';
          });
          cluster.get('foo', function (err, res) {
            utils.sample.restore();
            expect(res).to.eql(30003);
            cluster.disconnect();
            done();
          });
        });
      });

      it('should send writes to masters', function (done) {
        var cluster = new Redis.Cluster([{ host: '127.0.0.1', port: '30001' }], {
          scaleReads: 'slave'
        });
        cluster.on('ready', function () {
          stub(utils, 'sample').throws('sample is called');
          cluster.set('foo', 'bar', function (err, res) {
            utils.sample.restore();
            expect(res).to.eql(30001);
            cluster.disconnect();
            done();
          });
        });
      });
    });

    context('custom', function () {
      it('should send to selected slave', function (done) {
        var cluster = new Redis.Cluster([{ host: '127.0.0.1', port: '30001' }], {
          scaleReads: function (node, command) {
            if (command.name === 'get') {
              return node[1];
            }
            return node[2];
          }
        });
        cluster.on('ready', function () {
          stub(utils, 'sample')callsFake((array, from) => {
            expect(array).to.eql(['127.0.0.1:30001', '127.0.0.1:30003', '127.0.0.1:30004']);
            expect(from).to.eql(1);
            return '127.0.0.1:30003';
          });
          cluster.hgetall('foo', function (err, res) {
            utils.sample.restore();
            expect(res).to.eql(30004);
            cluster.disconnect();
            done();
          });
        });
      });

      it('should send writes to masters', function (done) {
        var cluster = new Redis.Cluster([{ host: '127.0.0.1', port: '30001' }], {
          scaleReads: function (node, command) {
            if (command.name === 'get') {
              return node[1];
            }
            return node[2];
          }
        });
        cluster.on('ready', function () {
          stub(utils, 'sample').throws('sample is called');
          cluster.set('foo', 'bar', function (err, res) {
            utils.sample.restore();
            expect(res).to.eql(30001);
            cluster.disconnect();
            done();
          });
        });
      });
    });

    context('all', function () {
      it('should send reads to all nodes randomly', function (done) {
        var cluster = new Redis.Cluster([{ host: '127.0.0.1', port: '30001' }], {
          scaleReads: 'all'
        });
        cluster.on('ready', function () {
          stub(utils, 'sample').callsFake((array, from) => {
            expect(array).to.eql(['127.0.0.1:30001', '127.0.0.1:30003', '127.0.0.1:30004']);
            expect(from).to.eql(undefined);
            return '127.0.0.1:30003';
          });
          cluster.get('foo', function (err, res) {
            utils.sample.restore();
            expect(res).to.eql(30003);
            cluster.disconnect();
            done();
          });
        });
      });
    });
  });

  describe('#nodes()', function () {
    it('should return the corrent nodes', function (done) {
      var slotTable = [
        [0, 16381, ['127.0.0.1', 30001], ['127.0.0.1', 30003]],
        [16382, 16383, ['127.0.0.1', 30002]]
      ];
      var node = new MockServer(30001, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
      });
      new MockServer(30002, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
      });

      new MockServer(30003, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
      });

      var cluster = new Redis.Cluster([{ host: '127.0.0.1', port: '30001' }]);
      // Make sure 30001 has been connected
      cluster.get('foo', function () {
        expect(cluster.nodes()).to.have.lengthOf(3);
        expect(cluster.nodes('all')).to.have.lengthOf(3);
        expect(cluster.nodes('master')).to.have.lengthOf(2);
        expect(cluster.nodes('slave')).to.have.lengthOf(1);

        cluster.once('-node', function () {
          expect(cluster.nodes()).to.have.lengthOf(2);
          expect(cluster.nodes('all')).to.have.lengthOf(2);
          expect(cluster.nodes('master')).to.have.lengthOf(1);
          expect(cluster.nodes('slave')).to.have.lengthOf(1);
          cluster.disconnect();
          done();
        });
        node.disconnect();
      });

    });
  });

  describe('#getInfoFromNode', function () {
    it('should refresh master nodes', function (done) {
      var slotTable = [
        [0, 5460, ['127.0.0.1', 30001], ['127.0.0.1', 30003]],
        [5461, 10922, ['127.0.0.1', 30002]]
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

      new MockServer(30003, function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
      });

      var cluster = new Redis.Cluster([{ host: '127.0.0.1', port: '30001' }], {
        redisOptions: { showFriendlyErrorStack: true }
      });
      cluster.on('ready', function () {
        expect(cluster.nodes('master')).to.have.lengthOf(2);
        slotTable = [
          [0, 5460, ['127.0.0.1', 30003]],
          [5461, 10922, ['127.0.0.1', 30002]]
        ];
        cluster.refreshSlotsCache(function () {
          cluster.once('-node', function (removed) {
            expect(removed.options.port).to.eql(30001);
            expect(cluster.nodes('master')).to.have.lengthOf(2);
            expect([
              cluster.nodes('master')[0].options.port,
              cluster.nodes('master')[1].options.port
            ].sort()).to.eql([30002, 30003]);
            cluster.nodes('master').forEach(function (node) {
              expect(node.options).to.have.property('readOnly', false);
            });
            cluster.disconnect();
            done();
          });
        });
      });
    });
  });

  describe('#quit()', function () {
    it('should quit the connection gracefully', function (done) {
      var slotTable = [
        [0, 1, ['127.0.0.1', 30001]],
        [2, 16383, ['127.0.0.1', 30002], ['127.0.0.1', 30003]]
      ];
      var argvHandler = function (argv) {
        if (argv[0] === 'cluster' && argv[1] === 'slots') {
          return slotTable;
        }
      };
      new MockServer(30001, argvHandler);
      new MockServer(30002, argvHandler);
      new MockServer(30003, argvHandler);

      var cluster = new Redis.Cluster([
        { host: '127.0.0.1', port: '30001' }
      ]);

      var setCommandHandled = false;
      cluster.on('ready', function () {
        cluster.set('foo', 'bar', function () {
          setCommandHandled = true;
        });
        cluster.quit(function (err, state) {
          expect(setCommandHandled).to.eql(true);
          expect(state).to.eql('OK');
          cluster.disconnect();
          done();
        });
      });
    });
  });
});
