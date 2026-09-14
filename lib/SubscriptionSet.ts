import { CommandNameFlags } from "./Command";

type AddSet = CommandNameFlags["ENTER_SUBSCRIBER_MODE"][number];
type DelSet = CommandNameFlags["EXIT_SUBSCRIBER_MODE"][number];

type ChannelSet = { [channel: string]: boolean };

// Channel names come from the server, so they can collide with the names
// inherited from `Object.prototype`. Assigning `__proto__` on a plain object
// hits the prototype setter instead of creating an own key, which would hide
// the channel from `channels()` and from `isEmpty()`.
function createChannelSet(): ChannelSet {
  return Object.create(null) as ChannelSet;
}

/**
 * Tiny class to simplify dealing with subscription set
 */
export default class SubscriptionSet {
  private set: { [key: string]: ChannelSet } = {
    subscribe: createChannelSet(),
    psubscribe: createChannelSet(),
    ssubscribe: createChannelSet(),
  };

  add(set: AddSet, channel: string) {
    this.set[mapSet(set)][channel] = true;
  }

  del(set: DelSet, channel: string) {
    delete this.set[mapSet(set)][channel];
  }

  channels(set: AddSet | DelSet): string[] {
    return Object.keys(this.set[mapSet(set)]);
  }

  isEmpty(): boolean {
    return (
      this.channels("subscribe").length === 0 &&
      this.channels("psubscribe").length === 0 &&
      this.channels("ssubscribe").length === 0
    );
  }
}

function mapSet(set: AddSet | DelSet): AddSet {
  if (set === "unsubscribe") {
    return "subscribe";
  }
  if (set === "punsubscribe") {
    return "psubscribe";
  }
  if (set === "sunsubscribe") {
    return "ssubscribe";
  }
  return set;
}
