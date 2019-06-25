import { ISentinelAddress } from "./types";

function isSentinelEql(
  a: Partial<ISentinelAddress>,
  b: Partial<ISentinelAddress>
): boolean {
  return (
    (a.host || "127.0.0.1") === (b.host || "127.0.0.1") &&
    (a.port || 26379) === (b.port || 26379)
  );
}

export default class SentinelIterator
  implements Iterator<Partial<ISentinelAddress>> {
  private cursor: number = 0;

  constructor(private sentinels: Partial<ISentinelAddress>[]) {}

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

  add(sentinel: ISentinelAddress): boolean {
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
