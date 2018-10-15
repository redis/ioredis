describe('cluster:quit', () => {
  it('quit successfully when server is disconnecting', (done) => {
    const slotTable = [
      [0, 1000, ['127.0.0.1', 30001]],
      [1001, 16383, ['127.0.0.1', 30002]]
    ]
    const server = new MockServer(30001, (argv, c) => {
      if (argv[0] === 'quit') {
        c.destroy()
      }
    }, slotTable)
    new MockServer(30002, (argv, c) => {
      if (argv[0] === 'quit') {
        c.destroy()
      }
    }, slotTable)

    const cluster = new Redis.Cluster([
      { host: '127.0.0.1', port: '30001' }
    ])
    cluster.on('ready', () => {
      server.disconnect()
      cluster.quit((err, res) => {
        expect(err).to.eql(null)
        expect(res).to.eql('OK')
        cluster.disconnect()
        done()
      })
    })
  })

  it('failed when quit returns error', function (done) {
    const ERROR_MESSAGE = 'quit random error'
    const slotTable = [
      [0, 1000, ['127.0.0.1', 30001]],
      [1001, 16383, ['127.0.0.1', 30002]]
    ]
    new MockServer(30001, function (argv, c) {
      if (argv[0] === 'quit') {
        return new Error(ERROR_MESSAGE)
      }
    }, slotTable)
    new MockServer(30002, function (argv, c) {
      if (argv[0] === 'quit') {
        c.destroy()
      }
    }, slotTable)

    const cluster = new Redis.Cluster([
      { host: '127.0.0.1', port: '30001' }
    ])
    cluster.on('ready', () => {
      cluster.quit((err) => {
        expect(err.message).to.eql(ERROR_MESSAGE)
        cluster.disconnect()
        done()
      })
    })
  })
})
