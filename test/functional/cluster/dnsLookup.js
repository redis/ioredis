describe('cluster:dnsLookup', () => {
  it('resolve hostnames to IPs', (done) => {
    const slotTable = [
      [0, 1000, ['127.0.0.1', 30001]],
      [1001, 16383, ['127.0.0.1', 30002]]
    ]
    new MockServer(30001, (argv, c) => {
    }, slotTable)
    new MockServer(30002, (argv, c) => {
    }, slotTable)

    const cluster = new Redis.Cluster([
      { host: 'localhost', port: '30001' }
    ])
    cluster.on('ready', () => {
      const nodes = cluster.nodes('master')
      expect(nodes.length).to.eql(2)
      expect(nodes[0].options.host).to.eql('127.0.0.1')
      expect(nodes[1].options.host).to.eql('127.0.0.1')
      done()
    })
  })

  it('support customize dnsLookup function', (done) => {
    let dnsLookupCalledCount = 0
    const slotTable = [
      [0, 1000, ['127.0.0.1', 30001]],
      [1001, 16383, ['127.0.0.1', 30002]]
    ]
    new MockServer(30001, (argv, c) => {
    }, slotTable)
    new MockServer(30002, (argv, c) => {
    }, slotTable)

    const cluster = new Redis.Cluster([
      { host: 'a.com', port: '30001' }
    ], {
      dnsLookup (hostname, callback) {
        dnsLookupCalledCount += 1
        if (hostname === 'a.com') {
          callback(null, '127.0.0.1')
        } else {
          callback(new Error('Unknown hostname'))
        }
      }
    })
    cluster.on('ready', () => {
      const nodes = cluster.nodes('master')
      expect(nodes.length).to.eql(2)
      expect(nodes[0].options.host).to.eql('127.0.0.1')
      expect(nodes[1].options.host).to.eql('127.0.0.1')
      expect(dnsLookupCalledCount).to.eql(1)
      done()
    })
  })
})
