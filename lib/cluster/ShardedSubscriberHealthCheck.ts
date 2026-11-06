import { EventEmitter } from "events";
import Deque = require("denque");
import { Debug } from "../utils";
import { CommandItem } from "../types";
const debug = Debug("cluster:subscriberGroup:shardedSubscriber:healthCheck");

export interface HealthCheckedConnection extends EventEmitter {
  readonly commandQueue: Deque<CommandItem>;
  readonly status: string;
  ping(): Promise<unknown>;
  disconnect(): void;
}

export default class ShardedSubscriberHealthCheck {
  private timer: NodeJS.Timeout | undefined;
  // Head of commandQueue seen at the previous fire. Same object at the next
  // fire means that command waited a full interval with no reply.
  private suspect: CommandItem | undefined;

  constructor(
    private readonly instance: HealthCheckedConnection,
    private readonly intervalMs: number,
    private readonly nodeKey: string,
  ) {
    instance.on("connect", this.arm);
    instance.on("ready", this.touch);
    instance.on("smessageBuffer", this.onMessage);
  }

  stop = () => {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.suspect = undefined;
  };

  private arm = () => {
    this.stop();
    this.timer = setTimeout(this.onFire, this.intervalMs);
  };

  private touch = () => {
    this.timer?.refresh();
  };

  // A stuck proxy still delivers smessage, so a message proves liveness only
  // while nothing waits for a reply.
  private onMessage = () => {
    if (this.instance.commandQueue.length === 0) {
      this.touch();
    }
  };

  private onFire = () => {
    const head = this.instance.commandQueue.peekFront();
    if (head !== undefined && head === this.suspect) {
      this.stop();
      debug(
        "%s left %s unanswered, disconnecting",
        this.nodeKey,
        head.command.name,
      );
      this.instance.disconnect();
      return;
    }

    if (head === undefined && this.instance.status === "ready") {
      this.instance.ping().catch(() => {});
    }

    this.suspect = this.instance.commandQueue.peekFront();
    this.timer?.refresh();
  };
}
