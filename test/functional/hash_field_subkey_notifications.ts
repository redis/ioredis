import Redis from "../../lib/Redis";
import { expect } from "chai";
import { isRedisVersionLowerThan } from "../helpers/util";

describe("hash field subkey notifications", function () {
  let previousNotifyConfig = "";
  let restoreNotifyConfig = false;

  before(async function () {
    if (await isRedisVersionLowerThan("8.8")) {
      this.skip();
    }

    const redis = new Redis();
    try {
      const [, config = ""] = (await redis.config(
        "GET",
        "notify-keyspace-events"
      )) as string[];
      previousNotifyConfig = config;
      await redis.config("SET", "notify-keyspace-events", "STIVh");
      restoreNotifyConfig = true;
    } finally {
      redis.disconnect();
    }
  });

  after(async function () {
    if (!restoreNotifyConfig) {
      return;
    }

    const redis = new Redis();
    try {
      await redis.config("SET", "notify-keyspace-events", previousNotifyConfig);
    } finally {
      redis.disconnect();
    }
  });

  it("should receive hash field subkey notifications", async function () {
    const redis = new Redis();
    const subscriber = redis.duplicate();

    try {
      const HASH_KEY = "skn:hash";
      const FIELD = "field-alpha";
      const SUBKEYEVENT = "8:skn:hash|11:field-alpha";
      const SUBKEYSPACEEVENT = "11:field-alpha";

      const expected: Array<[string, string]> = [
        ["__subkeyevent@0__:hexpire", SUBKEYEVENT],
        ["__subkeyevent@0__:hexpired", SUBKEYEVENT],
        [`__subkeyspaceitem@0__:${HASH_KEY}\n${FIELD}`, "hexpire"],
        [`__subkeyspaceitem@0__:${HASH_KEY}\n${FIELD}`, "hexpired"],
        [`__subkeyspaceevent@0__:hexpire|${HASH_KEY}`, SUBKEYSPACEEVENT],
        [`__subkeyspaceevent@0__:hexpired|${HASH_KEY}`, SUBKEYSPACEEVENT],
      ];

      const sortNotifications = (notifications: Array<[string, string]>) =>
        [...notifications].sort(
          ([leftChannel, leftMessage], [rightChannel, rightMessage]) =>
            `${leftChannel}\0${leftMessage}`.localeCompare(
              `${rightChannel}\0${rightMessage}`
            )
        );

      await redis.del(HASH_KEY);
      await redis.hset(HASH_KEY, FIELD, "value");

      const pending = new Map<string, () => void>();
      const received: Array<[string, string]> = [];
      const waiters = expected.map(
        ([c, m]) =>
          new Promise<void>((resolve) => pending.set(`${c}\0${m}`, resolve))
      );

      subscriber.on("message", (channel, message) => {
        received.push([channel, message]);

        const key = `${channel}\0${message}`;
        const resolve = pending.get(key);
        if (resolve) {
          pending.delete(key);
          resolve();
        }
      });

      const channels = [...new Set(expected.map(([c]) => c))];
      await Promise.all(channels.map((c) => subscriber.subscribe(c)));

      expect(
        await redis.hpexpire(HASH_KEY, 50, "FIELDS", 1, FIELD)
      ).to.deep.equal([1]);

      await Promise.all(waiters);
      expect(sortNotifications(received)).to.deep.equal(
        sortNotifications(expected)
      );
    } finally {
      subscriber.disconnect();
      redis.disconnect();
    }
  });
});
