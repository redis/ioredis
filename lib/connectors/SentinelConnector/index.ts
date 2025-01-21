import { EventEmitter } from "events";
import { createConnection, TcpNetConnectOpts } from "net";
import { NatMap } from "../../cluster/ClusterOptions";
import {
  CONNECTION_CLOSED_ERROR_MSG,
  packObject,
  sample,
  Debug,
} from "../../utils";
import { connect as createTLSConnection, ConnectionOptions } from "tls";
import SentinelIterator from "./SentinelIterator";
import { RedisClient, SentinelAddress, Sentinel } from "./types";
import AbstractConnector, { ErrorEmitter } from "../AbstractConnector";
import { NetStream } from "../../types";
import Redis from "../../Redis";
import { RedisOptions } from "../../redis/RedisOptions";
import { FailoverDetector } from "./FailoverDetector";

const debug = Debug("SentinelConnector");

interface AddressFromResponse {
  port: string;
  ip: string;
  flags?: string;
}

type PreferredSlaves =
  | ((slaves: AddressFromResponse[]) => AddressFromResponse | null)
  | Array<{ port: string; ip: string; prio?: number }>
  | { port: string; ip: string; prio?: number };

export { SentinelAddress, SentinelIterator };

export interface SentinelConnectionOptions {
  /**
   * Master group name of the Sentinel
   */
  name?: string;
  /**
   * @default "master"
   */
  role?: "master" | "slave";
  tls?: ConnectionOptions;
  sentinelUsername?: string;
  sentinelPassword?: string;
  sentinels?: Array<Partial<SentinelAddress>>;
  sentinelRetryStrategy?: (retryAttempts: number) => number | void | null;
  sentinelReconnectStrategy?: (retryAttempts: number) => number | void | null;
  preferredSlaves?: PreferredSlaves;
  connectTimeout?: number;
  disconnectTimeout?: number;
  sentinelCommandTimeout?: number;
  enableTLSForSentinelMode?: boolean;
  sentinelTLS?: ConnectionOptions;
  natMap?: NatMap;
  updateSentinels?: boolean;
  /**
   * @default 10
   */
  sentinelMaxConnections?: number;
  failoverDetector?: boolean;
}

export default class SentinelConnector extends AbstractConnector {
  emitter: EventEmitter | null = null;
  protected sentinelIterator: SentinelIterator;
  private retryAttempts: number;
  private failoverDetector: FailoverDetector | null = null;

  constructor(protected options: SentinelConnectionOptions) {
    super(options.disconnectTimeout);

    if (!this.options.sentinels.length) {
      throw new Error("Requires at least one sentinel to connect to.");
    }
    if (!this.options.name) {
      throw new Error("Requires the name of master.");
    }

    this.sentinelIterator = new SentinelIterator(this.options.sentinels);
  }

  check(info: { role?: string }): boolean {
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

  disconnect(): void {
    super.disconnect();

    if (this.failoverDetector) {
      this.failoverDetector.cleanup();
    }
  }

  connect(eventEmitter: ErrorEmitter): Promise<NetStream> {
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

      let resolved: TcpNetConnectOpts | null = null;
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
          this.stream.once("secureConnect", this.initFailoverDetector.bind(this));
        } else {
          this.stream = createConnection(resolved);
          this.stream.once("connect", this.initFailoverDetector.bind(this));
        }

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

  private async updateSentinels(client: RedisClient): Promise<void> {
    if (!this.options.updateSentinels) {
      return;
    }

    const result = await client.sentinel("sentinels", this.options.name);

    if (!Array.isArray(result)) {
      return;
    }

    result
      .map<AddressFromResponse>(
        packObject as (value: any) => AddressFromResponse
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
    client: RedisClient
  ): Promise<TcpNetConnectOpts | null> {
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
    client: RedisClient
  ): Promise<TcpNetConnectOpts | null> {
    const result = await client.sentinel("slaves", this.options.name);

    if (!Array.isArray(result)) {
      return null;
    }

    const availableSlaves = result
      .map<AddressFromResponse>(
        packObject as (value: any) => AddressFromResponse
      )
      .filter(
        (slave) =>
          slave.flags && !slave.flags.match(/(disconnected|s_down|o_down)/)
      );

    return this.sentinelNatResolve(
      selectPreferredSentinel(availableSlaves, this.options.preferredSlaves)
    );
  }

  private sentinelNatResolve(item: SentinelAddress | null) {
    if (!item || !this.options.natMap) return item;

    const key = `${item.host}:${item.port}`;

    let result = item;
    if(typeof this.options.natMap === "function") {
      result = this.options.natMap(key) || item;
    } else if (typeof this.options.natMap === "object") {
      result = this.options.natMap[key] || item;
    }

    return result;
  }

  private connectToSentinel(
    endpoint: Partial<SentinelAddress>,
    options?: Partial<RedisOptions>
  ): RedisClient {
    const redis = new Redis({
      port: endpoint.port || 26379,
      host: endpoint.host,
      username: this.options.sentinelUsername || null,
      password: this.options.sentinelPassword || null,
      family:
        endpoint.family ||
        // @ts-expect-error
        ("path" in this.options && this.options.path
          ? undefined
          : // @ts-expect-error
            this.options.family),
      tls: this.options.sentinelTLS,
      retryStrategy: null,
      enableReadyCheck: false,
      connectTimeout: this.options.connectTimeout,
      commandTimeout: this.options.sentinelCommandTimeout,
      ...options,
    });
    // @ts-expect-error
    return redis;
  }

  private async resolve(
    endpoint: Partial<SentinelAddress>
  ): Promise<TcpNetConnectOpts | null> {
    const client = this.connectToSentinel(endpoint);

    // ignore the errors since resolve* methods will handle them
    client.on("error", noop);

    try {
      if (this.options.role === "slave") {
        return await this.resolveSlave(client);
      } else {
        return await this.resolveMaster(client);
      }
    } finally {
      client.disconnect();
    }
  }

  private async initFailoverDetector(): Promise<void> {
    if (!this.options.failoverDetector) {
      return;
    }
    // Move the current sentinel to the first position
    this.sentinelIterator.reset(true);

    const sentinels: Sentinel[] = [];

    // In case of a large amount of sentinels, limit the number of concurrent connections
    while (sentinels.length < this.options.sentinelMaxConnections) {
      const { done, value } = this.sentinelIterator.next();

      if (done) {
        break;
      }

      const client = this.connectToSentinel(value, {
        lazyConnect: true,
        retryStrategy: this.options.sentinelReconnectStrategy,
      });

      client.on("reconnecting", () => {
        // Tests listen to this event
        this.emitter?.emit("sentinelReconnecting");
      });

      sentinels.push({ address: value, client });
    }

    this.sentinelIterator.reset(false);

    if (this.failoverDetector) {
      // Clean up previous detector
      this.failoverDetector.cleanup();
    }

    this.failoverDetector = new FailoverDetector(this, sentinels);
    await this.failoverDetector.subscribe();

    // Tests listen to this event
    this.emitter?.emit("failoverSubscribed");
  }
}

function selectPreferredSentinel(
  availableSlaves: AddressFromResponse[],
  preferredSlaves?: PreferredSlaves
): SentinelAddress | null {
  if (availableSlaves.length === 0) {
    return null;
  }

  let selectedSlave: AddressFromResponse;
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

function addressResponseToAddress(input: AddressFromResponse): SentinelAddress {
  return { host: input.ip, port: Number(input.port) };
}

function noop(): void {}
