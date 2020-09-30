import { readFileSync } from "fs"
import { join } from "path"
import Redis from "../../lib"
import Cluster from "../../lib/cluster"

async function main () {
  const numNodes = parseInt(process.env.NODES || '3', 10)
  let redis

  if(process.env.CLUSTER === 'true') {
    const configuration = Array.from(Array(numNodes), (_, i) => ({ host: '127.0.0.1', port: 30000 + i + 1 }))
    redis = new Cluster(configuration)
    console.log('Inserting fixtures keys in the cluster ...')
  } else {
    redis = new Redis()
    console.log('Inserting fixtures keys in the server ...')
  }

  // Use Redis to set the keys
  const start = process.hrtime.bigint()
  const keys = readFileSync(join(__dirname, `cluster-${numNodes}.txt`), 'utf-8').split('\n')
  const keysCount = keys.length

  while (keys.length) {
    const promises = []

    for (const key of keys.splice(0, 1000)) {
      promises.push(redis.set(key, key))
    }

    await Promise.all(promises)
  }

  console.log(`Inserted ${keysCount} keys in ${(Number(process.hrtime.bigint() - start) / 1e6).toFixed(2)} ms.`)
  process.exit(0)
}

main().catch(console.error)