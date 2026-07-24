import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { RESP_CONFIGS, ReplyMapping } from "../../helpers/respConfigs";
import { isRedisVersionLowerThan, sleep } from "../../helpers/util";

for (const { name, opts } of RESP_CONFIGS) {
  describe(`client (${name})`, function () {
    let redis: Redis;

    before(async function () {
      if (await isRedisVersionLowerThan("6.0.0")) {
        this.skip();
      }
    });

    beforeEach(() => {
      redis = new Redis(opts);
    });

    afterEach(() => {
      redis.disconnect();
    });

    it("ID returns the connection id", async () => {
      const id = await redis.client("ID");

      expect(id).to.be.a("number");
      expect(id).to.be.greaterThan(0);
    });

    it("LIST returns an entry per connection", async () => {
      const id = await redis.client("ID");
      const list = await redis.client("LIST");

      expect(list).to.be.a("string");
      expect(list).to.include(`id=${id}`);
    });

    it("LIST filters by TYPE", async () => {
      expect(await redis.client("LIST", "TYPE", "NORMAL")).to.include(
        "cmd=client"
      );
    });

    it("GETNAME returns null when the connection has no name", async () => {
      expect(await redis.client("GETNAME")).to.equal(null);
    });

    it("SETNAME sets the name returned by GETNAME", async () => {
      expect(await redis.client("SETNAME", "ioredis_test_client")).to.equal(
        "OK"
      );
      expect(await redis.client("GETNAME")).to.equal("ioredis_test_client");
    });

    it("KILL terminates another connection by id", async () => {
      const victim = new Redis({ ...opts, retryStrategy: () => null });

      try {
        const id = await victim.client("ID");

        expect(await redis.client("KILL", "ID", id)).to.equal(1);
      } finally {
        victim.disconnect();
      }
    });

    it("UNBLOCK unblocks a blocked client", async () => {
      const blocked = new Redis({ ...opts, retryStrategy: () => null });

      try {
        const id = await blocked.client("ID");
        const blpop = blocked.blpop("ioredis_test_client_list", 0);
        blpop.catch(() => {});

        const isBlocked = async () => {
          const list = (await redis.client("LIST")) as string;
          return list
            .split("\n")
            .some(
              (line) =>
                line.includes(`id=${id} `) && line.includes("cmd=blpop")
            );
        };

        while (!(await isBlocked())) {
          await sleep(10);
        }

        expect(await redis.client("UNBLOCK", id)).to.equal(1);
        expect(await blpop).to.equal(null);
      } finally {
        blocked.disconnect();
      }
    });

    it("PAUSE returns OK", async () => {
      expect(await redis.client("PAUSE", 0)).to.equal("OK");
    });

    it("TRACKING ON and OFF transition GETREDIR", async () => {
      expect(await redis.client("GETREDIR")).to.equal(-1);

      expect(await redis.client("TRACKING", "ON")).to.equal("OK");
      expect(await redis.client("GETREDIR")).to.equal(0);

      expect(await redis.client("TRACKING", "OFF")).to.equal("OK");
      expect(await redis.client("GETREDIR")).to.equal(-1);
    });

    it("TRACKING REDIRECT reports the target id via GETREDIR", async () => {
      const target = new Redis(opts);

      try {
        const targetId = await target.client("ID");

        expect(
          await redis.client("TRACKING", "ON", "REDIRECT", targetId)
        ).to.equal("OK");
        expect(await redis.client("GETREDIR")).to.equal(targetId);
      } finally {
        target.disconnect();
      }
    });

    it("CACHING returns OK in OPTIN mode", async () => {
      expect(await redis.client("TRACKING", "ON", "OPTIN")).to.equal("OK");
      expect(await redis.client("CACHING", "YES")).to.equal("OK");
    });

    describe("INFO", function () {
      before(async function () {
        if (await isRedisVersionLowerThan("6.2.0")) {
          this.skip();
        }
      });

      it("returns information about the current connection", async () => {
        const info = (await redis.client("INFO")) as string;

        expect(info).to.match(/\bid=\d+/);
        expect(info).to.include("addr=");

        const resp = info.match(/\bresp=(\d+)/);
        if (resp) {
          expect(resp[1]).to.equal(String(opts.protocol));
        }
      });
    });

    describe("TRACKINGINFO", function () {
      before(async function () {
        if (await isRedisVersionLowerThan("6.2.0")) {
          this.skip();
        }
      });

      it("returns tracking information", async () => {
        const reply = (await redis.client("TRACKINGINFO")) as unknown;

        const expected: Record<ReplyMapping, unknown> = {
          legacy: [
            "flags",
            ["off"],
            "redirect",
            -1,
            "prefixes",
            [],
          ],
          resp3: {
            flags: ["off"],
            redirect: -1,
            prefixes: [],
          },
        };

        expect(reply).to.eql(expected[opts.replyMapping]);
      });
    });

    describe("UNPAUSE", function () {
      before(async function () {
        if (await isRedisVersionLowerThan("6.2.0")) {
          this.skip();
        }
      });

      it("returns OK", async () => {
        expect(await redis.client("UNPAUSE")).to.equal("OK");
      });
    });

    describe("NO-EVICT", function () {
      before(async function () {
        if (await isRedisVersionLowerThan("7.0.0")) {
          this.skip();
        }
      });

      it("ON and OFF return OK", async () => {
        expect(await redis.client("NO-EVICT", "ON")).to.equal("OK");
        expect(await redis.client("NO-EVICT", "OFF")).to.equal("OK");
      });
    });

    describe("NO-TOUCH", function () {
      before(async function () {
        if (await isRedisVersionLowerThan("7.2.0")) {
          this.skip();
        }
      });

      it("ON and OFF return OK", async () => {
        expect(await redis.client("NO-TOUCH", "ON")).to.equal("OK");
        expect(await redis.client("NO-TOUCH", "OFF")).to.equal("OK");
      });
    });
  });
}
