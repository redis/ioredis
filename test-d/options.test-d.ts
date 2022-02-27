import { expectType } from "tsd";
import Redis, { Cluster } from "../built";

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
