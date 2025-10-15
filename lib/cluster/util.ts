import { parseURL, resolveTLSProfile } from "../utils";
import { isIP } from "net";
import { SrvRecord } from "dns";

export type NodeKey = string;
export type NodeRole = "master" | "slave" | "all";

export interface RedisOptions {
  port: number;
  host: string;
  username?: string;
  password?: string;
  nodeId?: string;
  [key: string]: any;
}

export interface SrvRecordsGroup {
  totalWeight: number;
  records: SrvRecord[];
}

export interface GroupedSrvRecords {
  [key: number]: SrvRecordsGroup;
}

export function getNodeKey(node: RedisOptions): NodeKey {
  node.port = node.port || 6379;
  node.host = node.host || "127.0.0.1";
  return node.host + ":" + node.port;
}

export function nodeKeyToRedisOptions(nodeKey: NodeKey): RedisOptions {
  const portIndex = nodeKey.lastIndexOf(":");
  if (portIndex === -1) {
    throw new Error(`Invalid node key ${nodeKey}`);
  }
  return {
    host: nodeKey.slice(0, portIndex),
    port: Number(nodeKey.slice(portIndex + 1)),
  };
}

export function normalizeNodeOptions(
  nodes: Array<string | number | object>
): RedisOptions[] {
  return nodes.map((node) => {
    const options: any = {};
    if (typeof node === "object") {
      Object.assign(options, node);
    } else if (typeof node === "string") {
      Object.assign(options, parseURL(node));
    } else if (typeof node === "number") {
      options.port = node;
    } else {
      throw new Error("Invalid argument " + node);
    }
    if (typeof options.port === "string") {
      options.port = parseInt(options.port, 10);
    }

    // Cluster mode only support db 0
    delete options.db;

    if (!options.port) {
      options.port = 6379;
    }
    if (!options.host) {
      options.host = "127.0.0.1";
    }

    return resolveTLSProfile(options);
  });
}

export function getUniqueHostnamesFromOptions(nodes: RedisOptions[]): string[] {
  const uniqueHostsMap = {};
  nodes.forEach((node) => {
    uniqueHostsMap[node.host] = true;
  });

  return Object.keys(uniqueHostsMap).filter((host) => !isIP(host));
}

export function groupSrvRecords(records: SrvRecord[]): GroupedSrvRecords {
  const recordsByPriority = {};
  for (const record of records) {
    if (!recordsByPriority.hasOwnProperty(record.priority)) {
      recordsByPriority[record.priority] = {
        totalWeight: record.weight,
        records: [record],
      };
    } else {
      recordsByPriority[record.priority].totalWeight += record.weight;
      recordsByPriority[record.priority].records.push(record);
    }
  }

  return recordsByPriority;
}

export function weightSrvRecords(recordsGroup: SrvRecordsGroup): SrvRecord {
  if (recordsGroup.records.length === 1) {
    recordsGroup.totalWeight = 0;
    return recordsGroup.records.shift();
  }

  // + `recordsGroup.records.length` to support `weight` 0
  const random = Math.floor(
    Math.random() * (recordsGroup.totalWeight + recordsGroup.records.length)
  );
  let total = 0;
  for (const [i, record] of recordsGroup.records.entries()) {
    total += 1 + record.weight;
    if (total > random) {
      recordsGroup.totalWeight -= record.weight;
      recordsGroup.records.splice(i, 1);
      return record;
    }
  }
}

export function getConnectionName(component, nodeConnectionName) {
  const prefix = `ioredis-cluster(${component})`;
  return nodeConnectionName ? `${prefix}:${nodeConnectionName}` : prefix;
}
