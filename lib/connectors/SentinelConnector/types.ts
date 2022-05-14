import { RedisOptions } from "../../redis/RedisOptions";

export interface SentinelAddress {
  port: number;
  host: string;
  family?: number;
}

// TODO: A proper typedef. This one only declares a small subset of all the members.
export interface RedisClient {
  options: RedisOptions;
  sentinel(subcommand: "sentinels", name: string): Promise<string[]>;
  sentinel(
    subcommand: "get-master-addr-by-name",
    name: string
  ): Promise<string[]>;
  sentinel(subcommand: "slaves", name: string): Promise<string[]>;
  sentinel(subcommand: "replicas", name: string): Promise<string[]>;
  subscribe(...channelNames: string[]): Promise<number>;
  on(
    event: "message",
    callback: (channel: string, message: string) => void
  ): void;
  on(event: "error", callback: (error: Error) => void): void;
  on(event: "reconnecting", callback: () => void): void;
  disconnect(): void;
}

export interface Sentinel {
  address: Partial<SentinelAddress>;
  client: RedisClient;
}
