import * as Deque from 'denque'
const debug = require('../utils/debug')('ioredis:delayqueue')

export interface IDelayQueueOptions {
  callback?: Function
  timeout: number
}

export default class DelayQueue {
  private queues: {[key: string]: Deque | null} = {}
  private timeouts: {[key: string]: NodeJS.Timer} = {}

  public push (bucket: string, item: Function, options: IDelayQueueOptions): void {
    const callback = options.callback || process.nextTick
    if (!this.queues[bucket]) {
      this.queues[bucket] = new Deque()
    }

    const queue = this.queues[bucket]
    queue.push(item)

    if (!this.timeouts[bucket]) {
      this.timeouts[bucket] = setTimeout(() => {
        callback(() => {
          this.timeouts[bucket] = null
          this.execute(bucket)
        })
      }, options.timeout)
    }
  }

  private execute (bucket: string): void {
    const queue = this.queues[bucket]
    if (!queue) {
      return
    }
    const {length} = queue
    if (!length) {
      return
    }
    debug('send %d commands in %s queue', length, bucket)

    this.queues[bucket] = null
    while (queue.length > 0) {
      queue.shift()()
    }
  }
}
