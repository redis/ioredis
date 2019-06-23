import {ISentinelAddress} from './types'

function isSentinelEql (a: Partial<ISentinelAddress>, b: Partial<ISentinelAddress>): boolean {
  return ((a.host || '127.0.0.1') === (b.host || '127.0.0.1')) &&
    ((a.port || 26379) === (b.port || 26379))
}

export default class SentinelIterator implements Iterator<Partial<ISentinelAddress>> {
  private cursor: number = 0
  private sentinels: Partial<ISentinelAddress>[]

  constructor (sentinels: Partial<ISentinelAddress>[]) {
    this.sentinels = [...sentinels];
  }

  next () {
    return this.cursor < this.sentinels.length
      ? { value: this.sentinels[this.cursor++], done: false }
      : { value: undefined, done: true };
  }

  reset (moveCurrentEndpointToFirst: true): SentinelIterator
  reset (moveCurrentEndpointToFirst?: false): void
  reset (moveCurrentEndpointToFirst?: boolean) {
    if (moveCurrentEndpointToFirst) {
      if (this.sentinels.length > 1 && this.cursor !== 1) {
        this.cursor = 0
        return this
      }
      return new SentinelIterator([...this.sentinels.slice(this.cursor - 1), ...this.sentinels.slice(0, this.cursor - 1)])
    }
    this.cursor = 0
  }

  add (sentinel: ISentinelAddress) {
    return this.sentinels.some(isSentinelEql.bind(null, sentinel))
      ? null
      : this.sentinels.push(sentinel);
  }

  toString (): string {
    return `${JSON.stringify(this.sentinels)} @${this.cursor}`
  }
}
