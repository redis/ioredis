var disconnect = require('./_helpers').disconnect;

describe('cluster:pub/sub', function () {
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
      client.once('end', function () {
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
      client.once('end', function () {
        client.connect();
      });
      client.disconnect();
    });
  });
});

