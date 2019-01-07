'use strict'
import * as tls from 'tls'
import * as net from 'net'

describe('tls option', () => {
  describe('Standalone', () => {
    it('supports tls', (done) => {
      let redis

      stub(tls, 'connect', (op) => {
        expect(op.ca).to.eql('123')
        expect(op.port).to.eql(6379)
        const stream = net.createConnection(op)
        stream.on('connect', data => {
          stream.emit('secureConnect', data)
        })
        return stream
      })

      redis = new Redis({tls: {ca: '123'}})
      redis.on('ready', () => {
        redis.disconnect()
        tls.connect.restore()
        redis.on('end', () => done())
      })
    })
  })

  describe('Sentinel', () => {
    it('does not use tls option by default', (done) => {
      new MockServer(27379, function (argv) {
        if (argv[0] === 'sentinel' && argv[1] === 'get-master-addr-by-name') {
          return ['127.0.0.1', '6379']
        }
      });

      stub(tls, 'connect', () => {
        throw new Error('called')
      })

      const redis = new Redis({sentinels: [{port: 27379}], name: 'my', tls: {ca: '123'}})
      redis.on('ready', () => {
        redis.disconnect()
        tls.connect.restore()
        done()
      })
    })

    it('can be enabled by `enableTLSForSentinelMode`', (done) => {
      new MockServer(27379, function (argv) {
        if (argv[0] === 'sentinel' && argv[1] === 'get-master-addr-by-name') {
          return ['127.0.0.1', '6379']
        }
      });

      let redis

      stub(tls, 'connect', (op) => {
        expect(op.ca).to.eql('123')
        redis.disconnect()
        tls.connect.restore()
        process.nextTick(done)
        return tls.connect(op)
      })

      redis = new Redis({sentinels: [{port: 27379}], name: 'my', tls: {ca: '123'}, enableTLSForSentinelMode: true})
    })

    it('supports sentinelTLS', (done) => {
      new MockServer(27379, function (argv) {
        if (argv[0] === 'sentinel' && argv[1] === 'get-master-addr-by-name') {
          return ['127.0.0.1', '6379']
        }
      });

      let redis

      stub(tls, 'connect', (op) => {
        expect(op.ca).to.eql('123')
        expect(op.port).to.eql(27379)
        const stream = net.createConnection(op)
        stream.on('connect', data => {
          stream.emit('secureConnect', data)
        })
        return stream
      })

      redis = new Redis({sentinels: [{port: 27379}], name: 'my', sentinelTLS: {ca: '123'}})
      redis.on('ready', () => {
        redis.disconnect()
        tls.connect.restore()
        redis.on('end', () => done())
      })
    })
  })
})
