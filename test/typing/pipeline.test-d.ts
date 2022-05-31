import { expectType } from "tsd";
import Redis, { Pipeline } from "../../built";

const redis = new Redis();

type RETURN_TYPE = Promise<[Error | null, unknown][] | null>;

expectType<RETURN_TYPE>(redis.pipeline().set("foo", "bar").get("foo").exec());

expectType<RETURN_TYPE>(
  redis
    .pipeline([
      ["set", "foo", "bar"],
      ["get", "foo"],
    ])
    .exec()
);

expectType<RETURN_TYPE>(
  redis
    .pipeline([
      ["set", Buffer.from("foo"), "bar"],
      ["incrby", "foo", 42],
    ])
    .exec()
);

expectType<number>(
  redis.pipeline([
    ["set", Buffer.from("foo"), "bar"],
    ["incrby", "foo", 42],
  ]).length
);

expectType<number>(({} as unknown as Pipeline).length);
