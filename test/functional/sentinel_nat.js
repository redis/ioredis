describe('sentinel_nat', function() {
  it('connects to server as expected', function(done) {

    var sentinel = new MockServer(27379, function (argv) {
      if (argv[0] === 'sentinel' && argv[1] === 'get-master-addr-by-name') {
        return ['127.0.0.1', '17380'];
      }
    })

    var redis = new Redis({
      sentinels: [
        { host: '127.0.0.1', port: '27379' }
      ],
      natMap: {
        '127.0.0.1:17380': {
          host: 'localhost',
          port: 6379,
        }
      },
      name: 'master',
      lazyConnect: true,
    })

    redis.connect(function(err) {
      if (err) {
        sentinel.disconnect(function() {})
        return done(err)
      }
      sentinel.disconnect(done)
    })
  })

  it('rejects connection if host is not defined in map', function(done) {
    var sentinel = new MockServer(27379, function (argv) {
      if (argv[0] === 'sentinel' && argv[1] === 'get-master-addr-by-name') {
        return ['127.0.0.1', '17380']
      }

      if (argv[0] === 'sentinel' && argv[1] === 'sentinels' &&argv[2] === 'master') {
        return ['127.0.0.1', '27379']
      }
    })

    var redis = new Redis({
      sentinels: [
        { host: '127.0.0.1', port: '27379' }
      ],
      natMap: {
        '127.0.0.1:17381': {
          host: 'localhost',
          port: 6379,
        }
      },
      maxRetriesPerRequest: 1,
      name: 'master',
      lazyConnect: true,
    })

    redis
      .connect()
      .then(function() {
        throw new Error("Should not call")
      })
      .catch(function(err) {
        if (err.message === 'Connection is closed.') {
          return done(null)
        }
        sentinel.disconnect(done)
      })
  })

  it('throws \'Empty natMap is not allowed.\' when empty natMap was given', function(done) {
    try {
      new Redis({
        sentinels: [
          { host: '127.0.0.1', port: '27379' }
        ],
        natMap: {},
        name: 'master',
      })
    } catch (error) {
      if (error.message === 'Empty natMap is not allowed.') {
        done(null)
      } else {
        done(new Error('Should not call'))
      }
    }
  })

})