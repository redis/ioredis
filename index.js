const Redis = require('./built/index')

const redis = new Redis({
  connectTimeout: 3000
})

