import { EventEmitter } from "events";
import { ReplyError } from "redis-errors";
import Command from "../Command";
import { Debug } from "../utils";
const debug = Debug("cluster:subscriberGroup:shardedSubscriber:healthCheck");

export interface HealthCheckedConnection extends EventEmitter {
  sendCommand(command: Command): unknown;
  disconnect(): void;
}

/**
 * Disconnects a connection that stops answering commands.
 *
 * Before ready, the handshake must complete within one interval. After ready,
 * PING is sent once per interval and must be answered before the next one.
 * A `commandTimeout` shorter than the interval is extended for the PING, so
 * the interval alone decides. Replies arrive in order, so a PING queued behind
 * a stuck command hangs too. Sharded messages are ignored because a node can
 * keep pushing them while it answers no commands. A server error reply (for
 * example NOPERM) still proves the node answers, while a local rejection does
 * not, so only the former counts as an answer.
 */
export default class ShardedSubscriberHealthCheck {
  private timer: NodeJS.Timeout | undefined;
  private ready = false;
  private pendingPing: Command | undefined;

  constructor(
    private readonly instance: HealthCheckedConnection,
    private readonly intervalMs: number,
    private readonly nodeKey: string,
  ) {
    instance.on("connect", this.arm);
    instance.on("ready", this.onReady);
    instance.on("close", this.stop);
  }

  stop = () => {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.ready = false;
    this.pendingPing = undefined;
  };

  private arm = () => {
    this.stop();
    this.timer = setTimeout(this.onFire, this.intervalMs);
  };

  private onReady = () => {
    this.ready = true;
    this.timer?.refresh();
  };

  private onFire = () => {
    if (!this.ready || this.pendingPing) {
      const what = this.ready ? "PING" : "handshake";
      this.stop();
      debug(
        "%s left %s unanswered for %dms, disconnecting",
        this.nodeKey,
        what,
        this.intervalMs,
      );
      this.instance.disconnect();
      return;
    }

    const ping = new Command("ping");
    this.pendingPing = ping;
    const answered = () => {
      if (this.pendingPing === ping) {
        this.pendingPing = undefined;
      }
    };
    ping.promise.then(answered, (err) => {
      if (err instanceof ReplyError) {
        answered();
      }
    });
    this.instance.sendCommand(ping);
    ping.extendTimeout(this.intervalMs);
    this.timer?.refresh();
  };
}
