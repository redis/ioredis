exports = module.exports = require('./redis').default

export {ReplyError} from 'redis-errors'
export const Cluster = require('./cluster').default
export const Command = require('./command').default
export const ScanStream = require('./ScanStream').default
export const Pipeline = require('./pipeline').default

const PromiseContainer = require('./promiseContainer')
Object.defineProperty(exports, 'Promise', {
  get() {
    return PromiseContainer.get()
  },
  set(lib) {
    PromiseContainer.set(lib)
  }
})

export function print(err: Error | null, reply?: any) {
  if (err) {
    console.log('Error: ' + err)
  } else {
    console.log('Reply: ' + reply)
  }
}
