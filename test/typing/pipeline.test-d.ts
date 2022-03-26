import { expectType } from "tsd";
import Redis from "../../built";

const redis = new Redis();

expectType<Promise<[Error | null, unknown][] | null>>(
  redis.pipeline().set("foo", "bar").get("foo").exec()
);

expectType<Promise<[Error | null, unknown][] | null>>(
  redis
    .pipeline([
      ["set", "foo", "bar"],
      ["get", "foo"],
    ])
    .exec()
);
