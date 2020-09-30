import { cronometro } from 'cronometro'
import { readFileSync } from 'fs'
import { join } from 'path'
import Cluster from '../lib/cluster'

const numNodes = parseInt(process.env.NODES || '3', 10)
const iterations = parseInt(process.env.ITERATIONS || '10000', 10)
const batchSize = parseInt(process.env.BATCH_SIZE || '1000', 10)
const keys = readFileSync(join(__dirname, `fixtures/cluster-${numNodes}.txt`), 'utf-8').split('\n')
const configuration = Array.from(Array(numNodes), (_, i) => ({ host: '127.0.0.1', port: 30000 + i + 1 }))
let cluster

function command(): string {
  const choice = Math.random()

  if (choice < 0.3) {
    return 'ttl'
  } else if (choice < 0.6) {
    return 'exists'
  }

  return 'get'
}

function test() {
  const index = Math.floor(Math.random() * keys.length)

  return Promise.all(Array.from(Array(batchSize)).map(() => cluster[command()](keys[index])))
}

function after(cb) {
  cluster.quit()
  cb()
}

cronometro(
  {
    default: {
      test,
      before(cb) {
        cluster = new Cluster(configuration)

        cb()
      },
      after
    },
    'enableAutoPipelining=true': {
      test,
      before(cb) {
        cluster = new Cluster(configuration, { enableAutoPipelining: true })
        cb()
      },
      after
    }
  },
  {
    iterations,
    print: { compare: true }
  }
)
