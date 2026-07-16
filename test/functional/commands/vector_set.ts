import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { isRedisVersionLowerThan } from "../../helpers/util";
import { isReCluster } from "../../helpers/re-config";

describe("vector set commands", function () {
  let redis: Redis;

  before(async function () {
    // Vector set commands are not available across all managed Redis Enterprise
    // versions (e.g. VRANGE is missing on RE 8.0.x), so skip them on RE for
    // consistent behaviour across the version matrix.
    if (isReCluster() || (await isRedisVersionLowerThan("8.0"))) {
      this.skip();
    }
  });

  beforeEach(() => {
    redis = new Redis();
  });

  afterEach(() => {
    redis.disconnect();
  });

  const key = (name: string) =>
    `vector_set_${name}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const toInfoRecord = (reply: (string | number | Buffer)[] | null) => {
    const record: Record<string, string | number | Buffer | undefined> = {};

    if (!reply) {
      return record;
    }

    for (let index = 0; index < reply.length; index += 2) {
      const rawField = reply[index];
      const field = Buffer.isBuffer(rawField)
        ? rawField.toString()
        : String(rawField);
      record[field] = reply[index + 1];
    }

    return record;
  };

  async function addVector(
    vectorKey: string,
    element: string,
    values: number[] = [1, 2, 3],
    attributes?: Record<string, unknown>
  ) {
    const args: (string | Buffer | number)[] = [
      "VALUES",
      values.length,
      ...values,
      element,
    ];

    if (attributes) {
      args.push("SETATTR", JSON.stringify(attributes));
    }

    return redis.vadd(vectorKey, ...args);
  }

  const expectMembers = (members: string[], expected: string[]) => {
    expect(members.slice().sort()).to.eql(expected.slice().sort());
  };

  describe("vadd", () => {
    it("adds new elements and updates existing elements", async () => {
      const vectorKey = key("vadd");

      expect(await addVector(vectorKey, "one")).to.eql(1);
      expect(await addVector(vectorKey, "one", [1, 2, 4])).to.eql(0);
      expect(await addVector(vectorKey, "two", [4, 5, 6])).to.eql(1);
    });
  });

  describe("vcard", () => {
    it("returns the number of elements in a vector set", async () => {
      const vectorKey = key("vcard");

      await addVector(vectorKey, "one");
      await addVector(vectorKey, "two", [4, 5, 6]);

      expect(await redis.vcard(vectorKey)).to.eql(2);
      expect(await redis.vcard(key("vcard_missing"))).to.eql(0);
    });

    it("supports callback replies", async () => {
      const vectorKey = key("vcard_callback");

      await addVector(vectorKey, "one");

      const cardinality = await new Promise<number>((resolve, reject) => {
        redis.vcard(vectorKey, (err, result) => {
          if (err) {
            reject(err);
            return;
          }

          resolve(result as number);
        });
      });

      expect(cardinality).to.eql(1);
    });
  });

  describe("vdim", () => {
    it("returns the dimension of vectors in a vector set", async () => {
      const vectorKey = key("vdim");

      await addVector(vectorKey, "one");

      expect(await redis.vdim(vectorKey)).to.eql(3);
    });
  });

  describe("vemb", () => {
    it("returns vectors and null for missing elements", async () => {
      const vectorKey = key("vemb");

      await addVector(vectorKey, "one");

      const vector = await redis.vemb(vectorKey, "one");
      expect(vector).to.have.lengthOf(3);
      expect(Number(vector?.[0])).to.be.closeTo(1, 0.2);
      expect(Number(vector?.[1])).to.be.closeTo(2, 0.2);
      expect(Number(vector?.[2])).to.be.closeTo(3, 0.2);
      expect(await redis.vemb(vectorKey, "missing")).to.eql(null);
    });

    it("supports Buffer replies", async () => {
      const vectorKey = key("vemb_buffer");

      await addVector(vectorKey, "one");

      const vector = await redis.vembBuffer(vectorKey, "one");
      expect(vector).to.have.lengthOf(3);
      expect(Buffer.isBuffer(vector?.[0])).to.eql(true);
      expect(Number(vector?.[0]?.toString())).to.be.closeTo(1, 0.2);
    });
  });

  describe("vgetattr and vsetattr", () => {
    it("sets and gets JSON attributes", async () => {
      const vectorKey = key("attributes");

      await addVector(vectorKey, "one");
      expect(await redis.vgetattr(vectorKey, "one")).to.eql(null);

      expect(
        await redis.vsetattr(vectorKey, "one", JSON.stringify({ tag: "blue" }))
      ).to.eql(1);
      expect(await redis.vgetattr(vectorKey, "one")).to.eql('{"tag":"blue"}');

      expect(
        await redis.vsetattr(vectorKey, "missing", JSON.stringify({ tag: "x" }))
      ).to.eql(0);
    });

    it("supports Buffer replies", async () => {
      const vectorKey = key("attributes_buffer");

      await addVector(vectorKey, "one", [1, 2, 3], { tag: "blue" });

      expect(await redis.vgetattrBuffer(vectorKey, "one")).to.eql(
        Buffer.from('{"tag":"blue"}')
      );
    });
  });

  describe("vinfo", () => {
    it("returns vector set metadata", async () => {
      const vectorKey = key("vinfo");

      await addVector(vectorKey, "one", [1, 2, 3], { tag: "blue" });
      await addVector(vectorKey, "two", [4, 5, 6]);

      const info = toInfoRecord(await redis.vinfo(vectorKey));
      expect(info["vector-dim"]).to.eql(3);
      expect(info.size).to.eql(2);
      expect(info["attributes-count"]).to.eql(1);
    });

    it("supports Buffer replies", async () => {
      const vectorKey = key("vinfo_buffer");

      await addVector(vectorKey, "one");

      const info = toInfoRecord(await redis.vinfoBuffer(vectorKey));
      expect(info["vector-dim"]).to.eql(3);
      expect(Buffer.isBuffer(info["quant-type"])).to.eql(true);
    });
  });

  describe("vlinks", () => {
    it("returns HNSW graph neighbors", async () => {
      const vectorKey = key("vlinks");

      await addVector(vectorKey, "one", [1, 2, 3]);
      await addVector(vectorKey, "two", [1, 2.1, 3]);

      const links = await redis.vlinks(vectorKey, "one");
      expect(links).to.be.an("array");
      expect(links?.some((layer) => layer.includes("two"))).to.eql(true);
    });

    it("supports Buffer replies", async () => {
      const vectorKey = key("vlinks_buffer");

      await addVector(vectorKey, "one", [1, 2, 3]);
      await addVector(vectorKey, "two", [1, 2.1, 3]);

      const links = await redis.vlinksBuffer(vectorKey, "one");
      expect(links?.some((layer) => layer.some(Buffer.isBuffer))).to.eql(true);
    });
  });

  describe("vrandmember", () => {
    it("returns scalar, counted, and missing-key replies", async () => {
      const vectorKey = key("vrandmember");

      await addVector(vectorKey, "one", [1, 2, 3]);
      await addVector(vectorKey, "two", [4, 5, 6]);
      await addVector(vectorKey, "three", [7, 8, 9]);

      expect(["one", "two", "three"]).to.include(
        await redis.vrandmember(vectorKey)
      );

      const members = await redis.vrandmember(vectorKey, 2);
      expect(members).to.have.lengthOf(2);
      members.forEach((member) => {
        expect(["one", "two", "three"]).to.include(member);
      });

      const repeated = await redis.vrandmember(vectorKey, -5);
      expect(repeated).to.have.lengthOf(5);
      repeated.forEach((member) => {
        expect(["one", "two", "three"]).to.include(member);
      });

      expect(await redis.vrandmember(key("vrandmember_missing"))).to.eql(null);
      expect(
        await redis.vrandmember(key("vrandmember_missing_count"), 2)
      ).to.eql([]);
    });

    it("supports Buffer replies", async () => {
      const vectorKey = key("vrandmember_buffer");

      await addVector(vectorKey, "one");
      await addVector(vectorKey, "two", [4, 5, 6]);

      const member = await redis.vrandmemberBuffer(vectorKey);
      expect(Buffer.isBuffer(member)).to.eql(true);

      const members = await redis.vrandmemberBuffer(vectorKey, 2);
      expect(members).to.have.lengthOf(2);
      expect(members.every(Buffer.isBuffer)).to.eql(true);
    });
  });

  describe("vsim", () => {
    it("searches by element or vector", async () => {
      const vectorKey = key("vsim");

      await addVector(vectorKey, "one", [1, 2, 3]);
      await addVector(vectorKey, "two", [1, 2.1, 3]);
      await addVector(vectorKey, "far", [7, 8, 9]);

      const byElement = await redis.vsim(vectorKey, "ELE", "one", "COUNT", 2);
      expect(byElement).to.include("one");
      expect(byElement).to.have.lengthOf(2);

      const byVector = await redis.vsim(
        vectorKey,
        "VALUES",
        3,
        7,
        8,
        9,
        "COUNT",
        1
      );
      expect(byVector).to.eql(["far"]);
    });

    it("supports WITHSCORES, WITHATTRIBS, and Buffer replies", async () => {
      const vectorKey = key("vsim_options");

      await addVector(vectorKey, "one", [1, 2, 3], { tag: "blue" });
      await addVector(vectorKey, "two", [1, 2.1, 3]);

      expect(
        await redis.vsim(
          vectorKey,
          "ELE",
          "one",
          "WITHSCORES",
          "WITHATTRIBS",
          "COUNT",
          1
        )
      ).to.eql(["one", "1", '{"tag":"blue"}']);

      const result = await redis.vsimBuffer(
        vectorKey,
        "ELE",
        "one",
        "COUNT",
        1
      );
      expect(result).to.eql([Buffer.from("one")]);
    });
  });

  describe("vrem", () => {
    it("removes elements and reports whether an element existed", async () => {
      const vectorKey = key("vrem");

      await addVector(vectorKey, "one");

      expect(await redis.vrem(vectorKey, "one")).to.eql(1);
      expect(await redis.vrem(vectorKey, "one")).to.eql(0);
      expect(await redis.vcard(vectorKey)).to.eql(0);
    });
  });

  describe("vismember", function () {
    before(async function () {
      if (await isRedisVersionLowerThan("8.2")) {
        this.skip();
      }
    });

    it("checks whether elements exist", async () => {
      const vectorKey = key("vismember");

      await addVector(vectorKey, "one");

      expect(await redis.vismember(vectorKey, "one")).to.eql(1);
      expect(await redis.vismember(vectorKey, "missing")).to.eql(0);
      expect(await redis.vismember(key("vismember_missing"), "one")).to.eql(0);
    });
  });

  describe("vrange", function () {
    before(async function () {
      if (await isRedisVersionLowerThan("8.4")) {
        this.skip();
      }
    });

    it("returns vector set elements in lexicographic order", async () => {
      const vectorKey = key("vrange");

      await addVector(vectorKey, "beta", [4, 5, 6]);
      await addVector(vectorKey, "alpha", [1, 2, 3]);
      await addVector(vectorKey, "gamma", [7, 8, 9]);

      expect(await redis.vrange(vectorKey, "-", "+")).to.eql([
        "alpha",
        "beta",
        "gamma",
      ]);
      expect(await redis.vrange(vectorKey, "-", "+", 2)).to.eql([
        "alpha",
        "beta",
      ]);
      expectMembers(await redis.vrange(vectorKey, "[beta", "+"), [
        "beta",
        "gamma",
      ]);
    });

    it("supports Buffer replies", async () => {
      const vectorKey = key("vrange_buffer");

      await addVector(vectorKey, "alpha", [1, 2, 3]);
      await addVector(vectorKey, "beta", [4, 5, 6]);

      expect(await redis.vrangeBuffer(vectorKey, "-", "+")).to.eql([
        Buffer.from("alpha"),
        Buffer.from("beta"),
      ]);
    });
  });
});
