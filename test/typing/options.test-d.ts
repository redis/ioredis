import { expectAssignable, expectError, expectType } from "tsd";
import {
  Redis,
  Cluster,
  NatMap,
  DNSLookupFunction,
  HimportFieldset,
  MaintEndpointType,
  MaintNotifications,
} from "../../built";

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
const himportFieldsets: readonly HimportFieldset[] = [
  {
    name: Buffer.from("fieldset"),
    fields: ["field1", Buffer.from("field2")],
  },
];
expectType<Redis>(new Redis({ himportFieldsets }));
expectType<Redis>(
  new Redis({
    maintNotifications: "enabled",
    maintEndpointType: "internal-fqdn",
    maintRelaxedCommandTimeout: 15000,
    maintRelaxedSocketTimeout: 15000,
  })
);

expectAssignable<MaintNotifications>("auto");
expectAssignable<MaintEndpointType>("none");

// Socket
expectType<Redis>(new Redis("/tmp/redis.sock"));
expectType<Redis>(new Redis("/tmp/redis.sock", { password: "password" }));

// TLS
expectType<Redis>(new Redis({ tls: {} }));
expectType<Redis>(new Redis({ tls: { ca: "myca" } }));
for (const profile of ["RedisCloudFixed", "RedisCloudFlexible"] as const) {
  expectType<Redis>(new Redis({ tls: profile }));
  expectType<Redis>(
    new Redis({ tls: { profile, ca: "myca", servername: "localhost" } })
  );
  expectType<Redis>(
    new Redis({
      sentinels: [{ host: "localhost", port: 16379 }],
      name: "mymaster",
      tls: profile,
    })
  );
  expectType<Cluster>(
    new Cluster([30001, 30002], { redisOptions: { tls: profile } })
  );
  expectType<Cluster>(
    new Cluster([30001, 30002], {
      redisOptions: { tls: { profile, servername: "localhost" } },
    })
  );
}
expectError(new Redis({ tls: "unknown-profile" }));
expectError(new Redis({ tls: { profile: "unknown-profile" } }));
expectError(new Redis({ tls: { profile: 123 } }));
expectError(new Redis({ tls: 123 }));

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
    himportFieldsets,
    subscriberNodeRole: "master",
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
