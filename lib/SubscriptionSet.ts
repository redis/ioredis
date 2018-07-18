type AddSet = 'subscribe' | 'psubscribe'
type DelSet = 'unsubscribe' | 'punsubscribe'

/**
 * Tiny class to simplify dealing with subscription set
 *
 * @export
 * @class SubscriptionSet
 */
export default class SubscriptionSet {
  private set: {[key: string]: {[channel: string]: boolean}} = {
    subscribe: {},
    psubscribe: {}
  }

  add (set: AddSet, channel: string) {
    this.set[mapSet(set)][channel] = true
  }

  del (set: DelSet, channel: string) {
    delete this.set[mapSet(set)][channel]
  }

  channels (set: AddSet | DelSet): string[] {
    return Object.keys(this.set[mapSet(set)])
  }

  isEmpty (): boolean {
    return this.channels('subscribe').length === 0 &&
      this.channels('psubscribe').length === 0
  }
}


function mapSet (set: AddSet | DelSet): AddSet {
  if (set === 'unsubscribe') {
    return 'subscribe'
  }
  if (set === 'punsubscribe') {
    return 'psubscribe'
  }
  return set
}
