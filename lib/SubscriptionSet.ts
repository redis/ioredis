import { CommandNameFlags } from "./Command";

type AddSet = CommandNameFlags["ENTER_SUBSCRIBER_MODE"][number];
type DelSet = CommandNameFlags["EXIT_SUBSCRIBER_MODE"][number];

/**
 * Tiny class to simplify dealing with subscription set
 */
export default class SubscriptionSet {
  private set: { [key: string]: { [channel: string]: boolean } } = {
    subscribe: {},
    psubscribe: {},
    ssubscribe: {},
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
