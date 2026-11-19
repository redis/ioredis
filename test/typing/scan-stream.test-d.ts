import { expectError, expectType } from "tsd";
import { Redis, Cluster } from "../../built";
import ScanStream from "../../built/ScanStream";

declare const redis: Redis;
declare const cluster: Cluster;
const binaryKey = Buffer.from([0xff, 0x00, 0x80]);

for (const client of [redis, cluster]) {
  expectType<ScanStream>(client.sscanStream(binaryKey));
  expectType<ScanStream>(client.sscanBufferStream(binaryKey));
  expectType<ScanStream>(client.hscanStream(binaryKey));
  expectType<ScanStream>(client.hscanBufferStream(binaryKey));
  expectType<ScanStream>(client.zscanStream(binaryKey));
  expectType<ScanStream>(client.zscanBufferStream(binaryKey));

  expectType<ScanStream>(client.sscanStream("key", { count: 10 }));
  expectType<ScanStream>(client.hscanStream("key", { match: "field:*" }));
  expectType<ScanStream>(client.zscanStream("key"));

  expectError(client.sscanStream(1));
  expectError(client.sscanBufferStream(1));
  expectError(client.hscanStream(1));
  expectError(client.hscanBufferStream(1));
  expectError(client.zscanStream(1));
  expectError(client.zscanBufferStream(1));
}
