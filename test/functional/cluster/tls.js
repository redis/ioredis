'use strict'

import * as tls from 'tls'
import * as net from 'net'

describe('cluster:tls option', () => {
  it('supports tls', (done) => {
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

    new MockServer(30001, argvHandler)
    new MockServer(30002, argvHandler)
    new MockServer(30003, argvHandler)

    stub(tls, 'connect', (op) => {
      expect(op.ca).to.eql('123')
      expect(op.port).to.be.oneOf([30001, 30003, 30003])
      const stream = net.createConnection(op)
      stream.on('connect', data => {
        stream.emit('secureConnect', data)
      })
      return stream
    })

    var cluster = new Redis.Cluster([
      { host: '127.0.0.1', port: '30001' },
      { host: '127.0.0.1', port: '30002' },
      { host: '127.0.0.1', port: '30003' }
    ], {
      redisOptions: { tls: { ca: '123' } }
    })

    cluster.on('ready', () => {
      expect(cluster.subscriber.subscriber.options.tls)
        .to.deep.equal({ ca: '123' })

      cluster.disconnect()
      tls.connect.restore()
      cluster.on('end', () => done())
    })
  })
})
