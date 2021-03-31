import { EventEmitter } from "events";
import { createConnection } from "net";
import { INatMap } from "../../cluster/ClusterOptions";
import {
  CONNECTION_CLOSED_ERROR_MSG,
  packObject,
  sample,
  Debug,
} from "../../utils";
import { connect as createTLSConnection, ConnectionOptions } from "tls";
import {
  ITcpConnectionOptions,
  isIIpcConnectionOptions,
} from "../StandaloneConnector";
import SentinelIterator from "./SentinelIterator";
import { IRedisClient, ISentinelAddress, ISentinel } from "./types";
import AbstractConnector, { ErrorEmitter } from "../AbstractConnector";
import { NetStream } from "../../types";
import Redis from "../../redis";
import { FailoverDetector } from "./FailoverDetector";

const debug = Debug("SentinelConnector");

interface IAddressFromResponse {
  port: string;
  ip: string;
  flags?: string;
}

type PreferredSlaves =
  | ((slaves: IAddressFromResponse[]) => IAddressFromResponse | null)
  | Array<{ port: string; ip: string; prio?: number }>
  | { port: string; ip: string; prio?: number };

export { ISentinelAddress, SentinelIterator };

export interface ISentinelConnectionOptions extends ITcpConnectionOptions {
  role: "master" | "slave";
  name: string;
  sentinelUsername?: string;
  sentinelPassword?: string;
  sentinels: Array<Partial<ISentinelAddress>>;
  sentinelRetryStrategy?: (retryAttempts: number) => number | void | null;
  sentinelReconnectStrategy?: (retryAttempts: number) => number | void | null;
  preferredSlaves?: PreferredSlaves;
  connectTimeout?: number;
  disconnectTimeout?: number;
  sentinelCommandTimeout?: number;
  enableTLSForSentinelMode?: boolean;
  sentinelTLS?: ConnectionOptions;
  natMap?: INatMap;
  updateSentinels?: boolean;
  sentinelMaxConnections?: number;
}

export default class SentinelConnector extends AbstractConnector {
  private retryAttempts: number;
  private failoverDetector: FailoverDetector | null = null;
  protected sentinelIterator: SentinelIterator;
  public emitter: EventEmitter | null = null;

  constructor(protected options: ISentinelConnectionOptions) {
    super(options.disconnectTimeout);

    if (!this.options.sentinels.length) {
      throw new Error("Requires at least one sentinel to connect to.");
    }
    if (!this.options.name) {
      throw new Error("Requires the name of master.");
    }

    this.sentinelIterator = new SentinelIterator(this.options.sentinels);
  }

  public check(info: { role?: string }): boolean {
    const roleMatches: boolean = !info.role || this.options.role === info.role;
    if (!roleMatches) {
      debug(
        "role invalid, expected %s, but got %s",
        this.options.role,
        info.role
      );
      // Start from the next item.
      // Note that `reset` will move the cursor to the previous element,
      // so we advance two steps here.
      this.sentinelIterator.next();
      this.sentinelIterator.next();
      this.sentinelIterator.reset(true);
    }
    return roleMatches;
  }

  public disconnect(): void {
    super.disconnect();

    if (this.failoverDetector) {
      this.failoverDetector.cleanup();
    }
  }

  public connect(eventEmitter: ErrorEmitter): Promise<NetStream> {
    this.connecting = true;
    this.retryAttempts = 0;

    let lastError;

    const connectToNext = async (): Promise<NetStream> => {
      const endpoint = this.sentinelIterator.next();

      if (endpoint.done) {
        this.sentinelIterator.reset(false);
        const retryDelay =
          typeof this.options.sentinelRetryStrategy === "function"
            ? this.options.sentinelRetryStrategy(++this.retryAttempts)
            : null;

        let errorMsg =
          typeof retryDelay !== "number"
            ? "All sentinels are unreachable and retry is disabled."
            : `All sentinels are unreachable. Retrying from scratch after ${retryDelay}ms.`;

        if (lastError) {
          errorMsg += ` Last error: ${lastError.message}`;
        }

        debug(errorMsg);

        const error = new Error(errorMsg);
        if (typeof retryDelay === "number") {
          eventEmitter("error", error);
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          return connectToNext();
        } else {
          throw error;
        }
      }

      let resolved: ITcpConnectionOptions | null = null;
      let err: Error | null = null;

      try {
        resolved = await this.resolve(endpoint.value);
      } catch (error) {
        err = error;
      }

      if (!this.connecting) {
        throw new Error(CONNECTION_CLOSED_ERROR_MSG);
      }

      const endpointAddress = endpoint.value.host + ":" + endpoint.value.port;

      if (resolved) {
        debug(
          "resolved: %s:%s from sentinel %s",
          resolved.host,
          resolved.port,
          endpointAddress
        );
        if (this.options.enableTLSForSentinelMode && this.options.tls) {
          Object.assign(resolved, this.options.tls);
          this.stream = createTLSConnection(resolved);
        } else {
          this.stream = createConnection(resolved);
        }

        this.stream.once("connect", () => this.activateFailoverDetector());

        this.stream.once("error", (err) => {
          this.firstError = err;
        });

        return this.stream;
      } else {
        const errorMsg = err
          ? "failed to connect to sentinel " +
            endpointAddress +
            " because " +
            err.message
          : "connected to sentinel " +
            endpointAddress +
            " successfully, but got an invalid reply: " +
            resolved;

        debug(errorMsg);

        eventEmitter("sentinelError", new Error(errorMsg));

        if (err) {
          lastError = err;
        }

        return connectToNext();
      }
    };

    return connectToNext();
  }

  private async updateSentinels(client: IRedisClient): Promise<void> {
    if (!this.options.updateSentinels) {
      return;
    }

    const result = await client.sentinel("sentinels", this.options.name);

    if (!Array.isArray(result)) {
      return;
    }

    result
      .map<IAddressFromResponse>(
        packObject as (value: any) => IAddressFromResponse
      )
      .forEach((sentinel) => {
        const flags = sentinel.flags ? sentinel.flags.split(",") : [];
        if (
          flags.indexOf("disconnected") === -1 &&
          sentinel.ip &&
          sentinel.port
        ) {
          const endpoint = this.sentinelNatResolve(
            addressResponseToAddress(sentinel)
          );
          if (this.sentinelIterator.add(endpoint)) {
            debug("adding sentinel %s:%s", endpoint.host, endpoint.port);
          }
        }
      });
    debug("Updated internal sentinels: %s", this.sentinelIterator);
  }

  private async resolveMaster(
    client: IRedisClient
  ): Promise<ITcpConnectionOptions | null> {
    const result = await client.sentinel(
      "get-master-addr-by-name",
      this.options.name
    );

    await this.updateSentinels(client);

    return this.sentinelNatResolve(
      Array.isArray(result)
        ? { host: result[0], port: Number(result[1]) }
        : null
    );
  }

  private async resolveSlave(
    client: IRedisClient
  ): Promise<ITcpConnectionOptions | null> {
    const result = await client.sentinel("slaves", this.options.name);

    if (!Array.isArray(result)) {
      return null;
    }

    const availableSlaves = result
      .map<IAddressFromResponse>(
        packObject as (value: any) => IAddressFromResponse
      )
      .filter(
        (slave) =>
          slave.flags && !slave.flags.match(/(disconnected|s_down|o_down)/)
      );

    return this.sentinelNatResolve(
      selectPreferredSentinel(availableSlaves, this.options.preferredSlaves)
    );
  }

  sentinelNatResolve(item: ISentinelAddress | null) {
    if (!item || !this.options.natMap) return item;

    return this.options.natMap[`${item.host}:${item.port}`] || item;
  }

  private connectToSentinel(endpoint: Partial<ISentinelAddress>): IRedisClient {
    return new Redis({
      port: endpoint.port || 26379,
      host: endpoint.host,
      username: this.options.sentinelUsername || null,
      password: this.options.sentinelPassword || null,
      family:
        endpoint.family ||
        (isIIpcConnectionOptions(this.options)
          ? undefined
          : this.options.family),
      tls: this.options.sentinelTLS,
      retryStrategy: null,
      enableReadyCheck: false,
      connectTimeout: this.options.connectTimeout,
      commandTimeout: this.options.sentinelCommandTimeout,
      dropBufferSupport: true,
    });
  }

  private async resolve(
    endpoint: Partial<ISentinelAddress>
  ): Promise<ITcpConnectionOptions | null> {
    const client = this.connectToSentinel(endpoint);

    // ignore the errors since resolve* methods will handle them
    client.on("error", noop);

    let result: ITcpConnectionOptions | null = null;

    try {
      if (this.options.role === "slave") {
        result = await this.resolveSlave(client);
      } else {
        result = await this.resolveMaster(client);
      }

      if (result) {
        this.initFailoverDetector({
          address: endpoint,
          isConnected: true,
          getClient: () => client,
        });
      }

      return result;
    } finally {
      if (!result) {
        // Only disconnect if we didn't get a result.
        // Otherwise we'll use this connection for failover detection.
        client.disconnect();
      }
    }
  }

  private initFailoverDetector(firstSentinel: ISentinel): void {
    // Move the current sentinel to the first position
    this.sentinelIterator.reset(true);

    const sentinels: ISentinel[] = [firstSentinel];

    // Skip the first sentinel that we've already connected to
    this.sentinelIterator.next();

    // In case of a large amount of sentinels, limit the number of concurrent connections
    while (sentinels.length < this.options.sentinelMaxConnections) {
      const { done, value } = this.sentinelIterator.next();

      if (done) {
        break;
      }

      let client: IRedisClient | null = null;

      const sentinel = {
        address: value,
        isConnected: false,
        getClient: () => {
          if (!client) {
            client = this.connectToSentinel(value);
            sentinel.isConnected = true;
          }

          return client;
        },
      };

      sentinels.push(sentinel);
    }

    this.sentinelIterator.reset(false);

    if (this.failoverDetector) {
      // Clean up previous detector
      this.failoverDetector.cleanup();
    }

    this.failoverDetector = new FailoverDetector(this, sentinels);
  }

  private async activateFailoverDetector() {
    if (!this.failoverDetector) {
      return;
    }

    for (const client of this.failoverDetector.getClients()) {
      // Apply reconnect strategy to sentinels now that we're no longer looking for master
      client.options.retryStrategy = this.options.sentinelReconnectStrategy;

      // Tests listen to this event
      client.on("reconnecting", () => {
        this.emitter?.emit("sentinelReconnecting");
      });
    }

    // The sentinel clients can't be used for regular commands after this
    await this.failoverDetector.subscribe();

    // Tests listen to this event
    this.emitter?.emit("failoverSubscribed");
  }
}

function selectPreferredSentinel(
  availableSlaves: IAddressFromResponse[],
  preferredSlaves?: PreferredSlaves
): ISentinelAddress | null {
  if (availableSlaves.length === 0) {
    return null;
  }

  let selectedSlave: IAddressFromResponse;
  if (typeof preferredSlaves === "function") {
    selectedSlave = preferredSlaves(availableSlaves);
  } else if (preferredSlaves !== null && typeof preferredSlaves === "object") {
    const preferredSlavesArray = Array.isArray(preferredSlaves)
      ? preferredSlaves
      : [preferredSlaves];

    // sort by priority
    preferredSlavesArray.sort((a, b) => {
      // default the priority to 1
      if (!a.prio) {
        a.prio = 1;
      }
      if (!b.prio) {
        b.prio = 1;
      }

      // lowest priority first
      if (a.prio < b.prio) {
        return -1;
      }
      if (a.prio > b.prio) {
        return 1;
      }
      return 0;
    });

    // loop over preferred slaves and return the first match
    for (let p = 0; p < preferredSlavesArray.length; p++) {
      for (let a = 0; a < availableSlaves.length; a++) {
        const slave = availableSlaves[a];
        if (slave.ip === preferredSlavesArray[p].ip) {
          if (slave.port === preferredSlavesArray[p].port) {
            selectedSlave = slave;
            break;
          }
        }
      }
      if (selectedSlave) {
        break;
      }
    }
  }

  // if none of the preferred slaves are available, a random available slave is returned
  if (!selectedSlave) {
    selectedSlave = sample(availableSlaves);
  }
  return addressResponseToAddress(selectedSlave);
}

function addressResponseToAddress(
  input: IAddressFromResponse
): ISentinelAddress {
  return { host: input.ip, port: Number(input.port) };
}

function noop(): void {}
