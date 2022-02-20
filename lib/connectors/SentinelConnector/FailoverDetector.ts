import { Debug } from "../../utils";
import SentinelConnector from "./index";
import { Sentinel } from "./types";

const debug = Debug("FailoverDetector");

const CHANNEL_NAME = "+switch-master";

export class FailoverDetector {
  private connector: SentinelConnector;
  private sentinels: Sentinel[];
  private isDisconnected = false;

  // sentinels can't be used for regular commands after this
  constructor(connector: SentinelConnector, sentinels: Sentinel[]) {
    this.connector = connector;
    this.sentinels = sentinels;
  }

  public cleanup() {
    this.isDisconnected = true;

    for (const sentinel of this.sentinels) {
      sentinel.client.disconnect();
    }
  }

  public async subscribe() {
    debug("Starting FailoverDetector");

    const promises: Promise<unknown>[] = [];

    for (const sentinel of this.sentinels) {
      const promise = sentinel.client.subscribe(CHANNEL_NAME).catch((err) => {
        debug(
          "Failed to subscribe to failover messages on sentinel %s:%s (%s)",
          sentinel.address.host || "127.0.0.1",
          sentinel.address.port || 26739,
          err.message
        );
      });

      promises.push(promise);

      sentinel.client.on("message", (channel: string) => {
        if (!this.isDisconnected && channel === CHANNEL_NAME) {
          this.disconnect();
        }
      });
    }

    await Promise.all(promises);
  }

  private disconnect() {
    // Avoid disconnecting more than once per failover.
    // A new FailoverDetector will be created after reconnecting.
    this.isDisconnected = true;

    debug("Failover detected, disconnecting");

    // Will call this.cleanup()
    this.connector.disconnect();
  }
}
