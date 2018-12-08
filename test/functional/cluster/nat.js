const calculateSlot = require('cluster-key-slot')

describe('NAT', () => {
  it('works for normal case', (done) => {
    const slotTable = [
      [0, 1, ['192.168.1.1', 30001]],
      [2, 16383, ['192.168.1.2', 30001]]
    ]

    let cluster
    new MockServer(30001, null, slotTable)
    new MockServer(30002, ([command, arg]) => {
      if (command === 'get' && arg === 'foo') {
        cluster.disconnect()
        done()
      }
    }, slotTable)

    cluster = new Redis.Cluster([{
      host: '127.0.0.1',
      port: 30001
    }], {
      natMap: {
        '192.168.1.1:30001': {host: '127.0.0.1', port: 30001},
        '192.168.1.2:30001': {host: '127.0.0.1', port: 30002}
      }
    })

    cluster.get('foo')
  })

  it('works for moved', (done) => {
    const slotTable = [
      [0, 16383, ['192.168.1.1', 30001]]
    ]

    let cluster
    new MockServer(30001, ([command, arg]) => {
      if (command === 'get' && arg === 'foo') {
        return new Error('MOVED ' + calculateSlot('foo') + ' 192.168.1.2:30001');
      }
    }, slotTable)
    new MockServer(30002, ([command, arg]) => {
      if (command === 'get' && arg === 'foo') {
        cluster.disconnect()
        done()
      }
    }, slotTable)

    cluster = new Redis.Cluster([{
      host: '127.0.0.1',
      port: 30001
    }], {
      natMap: {
        '192.168.1.1:30001': {host: '127.0.0.1', port: 30001},
        '192.168.1.2:30001': {host: '127.0.0.1', port: 30002}
      }
    })

    cluster.get('foo')
  })

  it('works for ask', (done) => {
    const slotTable = [
      [0, 16383, ['192.168.1.1', 30001]]
    ]

    let cluster
    let asked = false
    new MockServer(30001, ([command, arg]) => {
      if (command === 'get' && arg === 'foo') {
        return new Error('ASK ' + calculateSlot('foo') + ' 192.168.1.2:30001');
      }
    }, slotTable)
    new MockServer(30002, ([command, arg]) => {
      if (command === 'asking') {
        asked = true
      }
      if (command === 'get' && arg === 'foo') {
        if (!asked) {
          throw new Error('expected asked to be true')
        }
        cluster.disconnect()
        done()
      }
    }, slotTable)

    cluster = new Redis.Cluster([{
      host: '127.0.0.1',
      port: 30001
    }], {
      natMap: {
        '192.168.1.1:30001': {host: '127.0.0.1', port: 30001},
        '192.168.1.2:30001': {host: '127.0.0.1', port: 30002}
      }
    })

    cluster.get('foo')
  })
})
