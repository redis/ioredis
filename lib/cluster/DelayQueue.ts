import { Debug } from "../utils";
import { Deque } from "js-sdsl";

const debug = Debug("delayqueue");

export interface DelayQueueOptions {
  callback?: Function;
  timeout: number;
}

/**
 * Queue that runs items after specified duration
 */
export default class DelayQueue {
  private queues: { [key: string]: Deque<Function> } = {};
  private timeouts: { [key: string]: NodeJS.Timer } = {};

  /**
   * Add a new item to the queue
   *
   * @param bucket bucket name
   * @param item function that will run later
   * @param options
   */
  push(bucket: string, item: Function, options: DelayQueueOptions): void {
    const callback = options.callback || process.nextTick;
    if (!this.queues[bucket]) {
      this.queues[bucket] = new Deque();
    }

    const queue = this.queues[bucket];
    queue.pushBack(item);

    if (!this.timeouts[bucket]) {
      this.timeouts[bucket] = setTimeout(() => {
        callback(() => {
          this.timeouts[bucket] = null;
          this.execute(bucket);
        });
      }, options.timeout);
    }
  }

  private execute(bucket: string): void {
    const queue = this.queues[bucket];
    if (!queue) {
      return;
    }
    const length = queue.size();
    if (!length) {
      return;
    }
    debug("send %d commands in %s queue", length, bucket);

    this.queues[bucket] = null;
    while (!queue.empty()) {
      queue.front()();
      queue.popFront();
    }
  }
}
