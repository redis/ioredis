const { readFileSync } = require('fs')
const { join } = require('path')
const Cluster = require('./built/cluster').default

const numNodes = parseInt(process.env.NODES || '3', 10)
const iterations = parseInt(process.env.ITERATIONS || '10000', 10)
const batchSize = parseInt(process.env.BATCH_SIZE || '1000', 10)
const keys = readFileSync(join(__dirname, `benchmarks/fixtures/cluster-${numNodes}.txt`), 'utf-8').split('\n')
const configuration = Array.from(Array(numNodes), (_, i) => ({
  host: '127.0.0.1',
  port: 30000 + i + 1
}))

const cluster = new Cluster(configuration, { enableAutoPipelining: true })

function command() {
  const choice = Math.random()

  if (choice < 0.3) {
    return 'ttl'
  } else if (choice < 0.6) {
    return 'exists'
  }

  return 'get'
}

async function main() {
  for (let i = 0; i < 1500; i++) {
    const index = Math.floor(Math.random() * keys.length)

    await Promise.all(Array.from(Array(batchSize)).map(() => cluster[command()](keys[index])))
  }
}

main()
  .then(console.log, console.error)
  .finally(() => cluster.disconnect())
