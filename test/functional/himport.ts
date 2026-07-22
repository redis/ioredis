import Redis from "../../lib/Redis";
import { expect, use } from "chai";

use(require("chai-as-promised"));

async function serverSupportsHimport(): Promise<boolean> {
  const redis = new Redis();
  try {
    const reply = (await redis.command("INFO", "himport")) as unknown[];
    return Boolean(reply && reply[0]);
  } finally {
    redis.disconnect();
  }
}

describe("himport", function () {
  before(async function () {
    if (!(await serverSupportsHimport())) {
      this.skip();
    }
  });

  describe("commands", () => {
    it("prepares, sets and discards fieldsets", async () => {
      const redis = new Redis();
      expect(
        await redis.himport("PREPARE", "shared", "name", "email", "age")
      ).to.eql("OK");
      expect(
        await redis.himport(
          "SET",
          "shared:1",
          "shared",
          "alice",
          "alice@example.com",
          "25"
        )
      ).to.eql("OK");
      expect(await redis.hgetall("shared:1")).to.deep.equal({
        name: "alice",
        email: "alice@example.com",
        age: "25",
      });
      expect(await redis.himport("DISCARD", "shared")).to.eql(1);
      expect(await redis.himport("DISCARD", "shared")).to.eql(0);
      redis.disconnect();
    });

    it("counts removed fieldsets in DISCARDALL", async () => {
      const redis = new Redis();
      await redis.himport("PREPARE", "fs1", "a");
      await redis.himport("PREPARE", "fs2", "b");
      expect(await redis.himport("DISCARDALL")).to.eql(2);
      expect(await redis.himport("DISCARDALL")).to.eql(0);
      redis.disconnect();
    });

    it("scopes fieldsets to the connection that prepared them", async () => {
      const redis = new Redis();
      const other = new Redis();
      await redis.himport("PREPARE", "scoped", "a");
      await expect(
        other.himport("SET", "scoped:1", "scoped", "v")
      ).to.eventually.be.rejectedWith(/no such fieldset/);
      redis.disconnect();
      other.disconnect();
    });

    it("propagates server errors unchanged", async () => {
      const redis = new Redis();
      await expect(
        redis.himport("PREPARE", "dup", "a", "a")
      ).to.eventually.be.rejectedWith(/duplicate field/);
      await redis.himport("PREPARE", "pair", "a", "b");
      await expect(
        redis.himport("SET", "pair:1", "pair", "only-one")
      ).to.eventually.be.rejectedWith(/value count/);
      await redis.set("a-string", "not-a-hash");
      await expect(
        redis.himport("SET", "a-string", "pair", "v1", "v2")
      ).to.eventually.be.rejectedWith(/WRONGTYPE/);
      redis.disconnect();
    });

    it("works inside a pipeline", async () => {
      const redis = new Redis();
      const results = await redis
        .pipeline()
        .himport("PREPARE", "piped", "f1", "f2")
        .himport("SET", "piped:1", "piped", "v1", "v2")
        .himport("DISCARD", "piped")
        .exec();
      expect(results).to.deep.equal([
        [null, "OK"],
        [null, "OK"],
        [null, 1],
      ]);
      expect(await redis.hgetall("piped:1")).to.deep.equal({
        f1: "v1",
        f2: "v2",
      });
      redis.disconnect();
    });
  });

  describe("himportFieldsets option", () => {
    it("prepares fieldsets during the handshake", async () => {
      const redis = new Redis({
        himportFieldsets: [{ name: "boot", fields: ["f1", "f2"] }],
      });
      expect(await redis.himport("SET", "boot:1", "boot", "a", "b")).to.eql(
        "OK"
      );
      expect(await redis.hgetall("boot:1")).to.deep.equal({
        f1: "a",
        f2: "b",
      });
      redis.disconnect();
    });

    it("supports multiple fieldsets", async () => {
      const redis = new Redis({
        himportFieldsets: [
          { name: "boot1", fields: ["a"] },
          { name: "boot2", fields: ["b"] },
        ],
      });
      expect(await redis.himport("SET", "boot1:1", "boot1", "v")).to.eql("OK");
      expect(await redis.himport("SET", "boot2:1", "boot2", "v")).to.eql("OK");
      redis.disconnect();
    });

    it("re-prepares fieldsets on reconnect", async () => {
      const redis = new Redis({
        himportFieldsets: [{ name: "boot", fields: ["f1"] }],
      });
      expect(await redis.himport("SET", "boot:1", "boot", "a")).to.eql("OK");

      redis.disconnect(true);
      await new Promise<void>((resolve) => redis.once("ready", resolve));

      expect(await redis.himport("SET", "boot:2", "boot", "b")).to.eql("OK");
      redis.disconnect();
    });

    it("serves SETs queued while offline after the handshake PREPARE", async () => {
      const redis = new Redis({
        lazyConnect: true,
        himportFieldsets: [{ name: "boot", fields: ["f1"] }],
      });
      // The SET is issued before the connection exists: it waits in the
      // offline queue, which is flushed only after the handshake PREPARE
      // has been written.
      expect(await redis.himport("SET", "boot:1", "boot", "a")).to.eql("OK");
      redis.disconnect();
    });
  });
});
