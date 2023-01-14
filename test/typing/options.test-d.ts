import { expectAssignable, expectType } from "tsd";
import { Redis, Cluster, NatMap, DNSLookupFunction } from "../../built";

expectType<Redis>(new Redis());

// TCP
expectType<Redis>(new Redis());
expectType<Redis>(new Redis(6379));
expectType<Redis>(new Redis({ port: 6379 }));
expectType<Redis>(new Redis({ host: "localhost" }));
expectType<Redis>(new Redis({ host: "localhost", port: 6379 }));
expectType<Redis>(new Redis({ host: "localhost", port: 6379, family: 4 }));
expectType<Redis>(new Redis({ host: "localhost", port: 6379, family: 4 }));
expectType<Redis>(new Redis(6379, "localhost", { password: "password" }));

// Socket
expectType<Redis>(new Redis("/tmp/redis.sock"));
expectType<Redis>(new Redis("/tmp/redis.sock", { password: "password" }));

// TLS
expectType<Redis>(new Redis({ tls: {} }));
expectType<Redis>(new Redis({ tls: { ca: "myca" } }));

// Sentinels
expectType<Redis>(
  new Redis({
    sentinels: [{ host: "localhost", port: 16379 }],
    sentinelPassword: "password",
  })
);

// Cluster
expectType<Cluster>(new Cluster([30001, 30002]));
expectType<Cluster>(new Redis.Cluster([30001, 30002]));
expectType<Cluster>(new Redis.Cluster([30001, "localhost"]));
expectType<Cluster>(new Redis.Cluster([30001, "localhost", { port: 30002 }]));
expectType<Cluster>(
  new Redis.Cluster([30001, 30002], {
    enableAutoPipelining: true,
  })
);

expectAssignable<NatMap>({
  "10.0.1.230:30001": { host: "203.0.113.73", port: 30001 },
  "10.0.1.231:30001": { host: "203.0.113.73", port: 30002 },
  "10.0.1.232:30001": { host: "203.0.113.73", port: 30003 },
});

expectAssignable<DNSLookupFunction>((address, callback) =>
  callback(null, address)
);
