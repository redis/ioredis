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
import { ISentinelAddress } from "./types";
import AbstractConnector, { ErrorEmitter } from "../AbstractConnector";
import { NetStream } from "../../types";
import Redis from "../../redis";

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
  preferredSlaves?: PreferredSlaves;
  connectTimeout?: number;
  disconnectTimeout?: number;
  sentinelCommandTimeout?: number;
  enableTLSForSentinelMode?: boolean;
  sentinelTLS?: ConnectionOptions;
  natMap?: INatMap;
  updateSentinels?: boolean;
}

export default class SentinelConnector extends AbstractConnector {
  private retryAttempts: number;
  protected sentinelIterator: SentinelIterator;

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

      if (resolved) {
        debug("resolved: %s:%s", resolved.host, resolved.port);
        if (this.options.enableTLSForSentinelMode && this.options.tls) {
          Object.assign(resolved, this.options.tls);
          this.stream = createTLSConnection(resolved);
        } else {
          this.stream = createConnection(resolved);
        }

        this.stream.once("error", (err) => {
          this.firstError = err;
        });

        this.sentinelIterator.reset(true);
        return this.stream;
      } else {
        const endpointAddress = endpoint.value.host + ":" + endpoint.value.port;
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

  private async updateSentinels(client): Promise<void> {
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

  private async resolveMaster(client): Promise<ITcpConnectionOptions | null> {
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

  private async resolveSlave(client): Promise<ITcpConnectionOptions | null> {
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

  private async resolve(endpoint): Promise<ITcpConnectionOptions | null> {
    const client = new Redis({
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
