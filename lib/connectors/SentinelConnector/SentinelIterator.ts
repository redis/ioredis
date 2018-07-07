import {ISentinelAddress} from './types'

function isSentinelEql (a: ISentinelAddress, b: ISentinelAddress): boolean {
  return ((a.host || '127.0.0.1') === (b.host || '127.0.0.1')) &&
    ((a.port || 26379) === (b.port || 26379))
}

export default class SentinelIterator {
  private cursor: number = 0

  constructor (private sentinels: ISentinelAddress[]) {}

  hasNext (): boolean {
    return this.cursor < this.sentinels.length
  }

  next (): ISentinelAddress | null {
    return this.hasNext() ? this.sentinels[this.cursor++] : null
  }

  reset (success: boolean): void {
    if (success && this.sentinels.length > 1 && this.cursor !== 1) {
      const remains = this.sentinels.slice(this.cursor - 1)
      this.sentinels = remains.concat(this.sentinels.slice(0, this.cursor - 1))
    }
    this.cursor = 0
  }

  add (sentinel: ISentinelAddress): boolean {
    for (let i = 0; i < this.sentinels.length; i++) {
      if (isSentinelEql(sentinel, this.sentinels[i])) {
        return false
      }
    }

    this.sentinels.push(sentinel)
    return true
  }

  toString (): string {
    return JSON.stringify(this.sentinels)
  }
}