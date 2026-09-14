import { CommandNameFlags } from "./Command";

type AddSet = CommandNameFlags["ENTER_SUBSCRIBER_MODE"][number];
type DelSet = CommandNameFlags["EXIT_SUBSCRIBER_MODE"][number];

// Channel names are binary safe, so they are keyed by their bytes rather than
// by their utf8 rendering: names that are distinct as bytes can render alike
// (e.g. the invalid sequences `<80>` and `<81>`, which both decode to U+FFFD),
// and sharing a key would drop one of them from the set. `latin1` maps every
// byte to one code unit, so the key round-trips the exact bytes. The value
// keeps the utf8 rendering, which is what `channels()` hands back.
type ChannelSet = Map<string, string>;

function channelKey(channel: string | Buffer): string {
  return (Buffer.isBuffer(channel) ? channel : Buffer.from(channel)).toString(
    "latin1"
  );
}

function channelName(channel: string | Buffer): string {
  return Buffer.isBuffer(channel) ? channel.toString() : channel;
}

/**
 * Tiny class to simplify dealing with subscription set
 */
export default class SubscriptionSet {
  private set: { [key: string]: ChannelSet } = {
    subscribe: new Map(),
    psubscribe: new Map(),
    ssubscribe: new Map(),
  };

  add(set: AddSet, channel: string | Buffer) {
    this.set[mapSet(set)].set(channelKey(channel), channelName(channel));
  }

  del(set: DelSet, channel: string | Buffer) {
    this.set[mapSet(set)].delete(channelKey(channel));
  }

  channels(set: AddSet | DelSet): string[] {
    return Array.from(this.set[mapSet(set)].values());
  }

  // Called once per unsubscribe acknowledgement, and the server sends one per
  // channel, so this stays O(1): counting the keys instead would make
  // unsubscribing N channels Θ(N²) work and stall the event loop.
  isEmpty(): boolean {
    return (
      this.set.subscribe.size === 0 &&
      this.set.psubscribe.size === 0 &&
      this.set.ssubscribe.size === 0
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
