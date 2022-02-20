import { SentinelAddress } from "./types";

function isSentinelEql(
  a: Partial<SentinelAddress>,
  b: Partial<SentinelAddress>
): boolean {
  return (
    (a.host || "127.0.0.1") === (b.host || "127.0.0.1") &&
    (a.port || 26379) === (b.port || 26379)
  );
}

export default class SentinelIterator
  implements Iterator<Partial<SentinelAddress>>
{
  private cursor = 0;
  private sentinels: Array<Partial<SentinelAddress>>;

  constructor(sentinels: Array<Partial<SentinelAddress>>) {
    this.sentinels = sentinels.slice(0);
  }

  next() {
    const done = this.cursor >= this.sentinels.length;
    return { done, value: done ? undefined : this.sentinels[this.cursor++] };
  }

  reset(moveCurrentEndpointToFirst: boolean): void {
    if (
      moveCurrentEndpointToFirst &&
      this.sentinels.length > 1 &&
      this.cursor !== 1
    ) {
      this.sentinels.unshift(...this.sentinels.splice(this.cursor - 1));
    }
    this.cursor = 0;
  }

  add(sentinel: SentinelAddress): boolean {
    for (let i = 0; i < this.sentinels.length; i++) {
      if (isSentinelEql(sentinel, this.sentinels[i])) {
        return false;
      }
    }

    this.sentinels.push(sentinel);
    return true;
  }

  toString(): string {
    return `${JSON.stringify(this.sentinels)} @${this.cursor}`;
  }
}
