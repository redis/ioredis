import { expectAssignable, expectType } from "tsd";
import {
  Redis,
  Cluster,
  ScanStreamOptions,
  RedisStatus,
  ClusterStatus,
  MaintEndpointType,
  MaintNotifications,
} from "../../built";

// The types used by the public API are exported, so consumers can name them
// instead of re-deriving them with Parameters<...>/ReturnType<...>.

// ScanStreamOptions is the parameter type of the *scanStream() methods on both
// Redis and Cluster.
const scanOptions: ScanStreamOptions = {
  match: "user:*",
  type: "string",
  count: 100,
  noValues: false,
};
expectAssignable<Parameters<Redis["scanStream"]>[0]>(scanOptions);
expectAssignable<Parameters<Redis["hscanStream"]>[1]>(scanOptions);
expectAssignable<Parameters<Cluster["sscanStream"]>[1]>(scanOptions);

// RedisStatus is the type of the public `status` property and of the event
// names accepted by on()/once().
declare const redis: Redis;
expectType<RedisStatus>(redis.status);
expectAssignable<RedisStatus>("ready");
expectAssignable<RedisStatus>("connecting");

// ClusterStatus is the type of Cluster's public `status` property.
declare const cluster: Cluster;
expectType<ClusterStatus>(cluster.status);
expectAssignable<ClusterStatus>("ready");

// Smart Client Handoff option unions are public.
expectAssignable<MaintNotifications>("disabled");
expectAssignable<MaintEndpointType>("external-fqdn");
