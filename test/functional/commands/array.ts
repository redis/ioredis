import Redis from "../../../lib/Redis";
import { expect } from "chai";
import { isRedisVersionLowerThan } from "../../helpers/util";
import { isReCluster } from "../../helpers/re-config";

describe("array commands", () => {
  let redis: Redis;

  before(async function () {
    // The AR.* array commands are an OSS preview not shipped in managed Redis Enterprise.
    if (isReCluster() || (await isRedisVersionLowerThan("8.7"))) {
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
    `array_${name}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const toInfoRecord = (reply: unknown) => {
    const record: Record<string, unknown> = {};
    if (!Array.isArray(reply)) {
      return reply as Record<string, unknown>;
    }

    for (let index = 0; index < reply.length; index += 2) {
      const rawKey = reply[index];
      const field = Buffer.isBuffer(rawKey)
        ? rawKey.toString()
        : String(rawKey);
      record[field] = reply[index + 1];
    }
    return record;
  };

  describe("arcount", () => {
    it("returns the populated element count and 0 for missing keys", async () => {
      const arrayKey = key("arcount");

      expect(await redis.arcount(arrayKey)).to.eql(0);
      await redis.arset(arrayKey, 0, "zero");
      await redis.arset(arrayKey, 3, "three");

      expect(await redis.arcount(arrayKey)).to.eql(2);
    });
  });

  describe("ardel", () => {
    it("deletes one index", async () => {
      const arrayKey = key("ardel_one");

      await redis.arset(arrayKey, 0, "zero", "one", "two");

      expect(await redis.ardel(arrayKey, "1")).to.eql(1);
      expect(await redis.argetrange(arrayKey, 0, 2)).to.eql([
        "zero",
        null,
        "two",
      ]);
    });

    it("deletes multiple indexes and ignores missing indexes", async () => {
      const arrayKey = key("ardel_many");

      await redis.arset(arrayKey, 0, "zero", "one", "two", "three");

      expect(await redis.ardel(arrayKey, 0, 2, "99")).to.eql(2);
      expect(await redis.arcount(arrayKey)).to.eql(2);
    });
  });

  describe("ardelrange", () => {
    it("deletes a forward range", async () => {
      const arrayKey = key("ardelrange_forward");

      await redis.arset(arrayKey, 0, "zero", "one", "two", "three");

      expect(await redis.ardelrange(arrayKey, 1, 2)).to.eql(2);
      expect(await redis.argetrange(arrayKey, 0, 3)).to.eql([
        "zero",
        null,
        null,
        "three",
      ]);
    });

    it("deletes a reversed range", async () => {
      const arrayKey = key("ardelrange_reversed");

      await redis.arset(arrayKey, 0, "zero", "one", "two", "three");

      expect(await redis.ardelrange(arrayKey, 2, 1)).to.eql(2);
      expect(await redis.arcount(arrayKey)).to.eql(2);
    });

    it("deletes multiple ranges and counts overlapping elements once", async () => {
      const arrayKey = key("ardelrange_many");

      await redis.arset(arrayKey, 0, "zero", "one", "two", "three", "four");

      expect(await redis.ardelrange(arrayKey, 0, 2, 2, 4)).to.eql(5);
      expect(await redis.arcount(arrayKey)).to.eql(0);
    });

    it("returns 0 for missing keys", async () => {
      expect(await redis.ardelrange(key("ardelrange_missing"), 0, 3)).to.eql(0);
    });
  });

  describe("arget", () => {
    it("returns a value or null", async () => {
      const arrayKey = key("arget");

      await redis.arset(arrayKey, 1, "one");

      expect(await redis.arget(arrayKey, 1)).to.eql("one");
      expect(await redis.arget(arrayKey, "0")).to.eql(null);
      expect(await redis.arget(key("arget_missing"), 1)).to.eql(null);
    });

    it("supports Buffer replies", async () => {
      const arrayKey = key("arget_buffer");

      await redis.arset(arrayKey, 0, Buffer.from("zero"));

      expect(await redis.argetBuffer(arrayKey, 0)).to.eql(Buffer.from("zero"));
      expect(await redis.argetBuffer(arrayKey, 1)).to.eql(null);
    });
  });

  describe("argetrange", () => {
    it("returns forward ranges including empty slots", async () => {
      const arrayKey = key("argetrange_forward");

      await redis.arset(arrayKey, 1, "one", "two");

      expect(await redis.argetrange(arrayKey, 0, 3)).to.eql([
        null,
        "one",
        "two",
        null,
      ]);
      expect(await redis.argetrange(key("argetrange_missing"), 0, 2)).to.eql([
        null,
        null,
        null,
      ]);
    });

    it("returns reversed ranges", async () => {
      const arrayKey = key("argetrange_reversed");

      await redis.arset(arrayKey, 1, "one", "two");

      expect(await redis.argetrange(arrayKey, 3, 0)).to.eql([
        null,
        "two",
        "one",
        null,
      ]);
    });

    it("supports Buffer replies", async () => {
      const arrayKey = key("argetrange_buffer");

      await redis.arset(arrayKey, 1, "one", Buffer.from("two"));

      expect(await redis.argetrangeBuffer(arrayKey, 0, 2)).to.eql([
        null,
        Buffer.from("one"),
        Buffer.from("two"),
      ]);
    });
  });

  describe("argrep", () => {
    it("supports every predicate type", async () => {
      const arrayKey = key("argrep_predicates");

      await redis.arset(arrayKey, 0, "Alpha", "beta", "alphabet", "gamma");

      expect(await redis.argrep(arrayKey, 0, 3, "EXACT", "beta")).to.eql([1]);
      expect(await redis.argrep(arrayKey, 0, 3, "MATCH", "alp")).to.eql([2]);
      expect(await redis.argrep(arrayKey, 0, 3, "GLOB", "a*")).to.eql([2]);
      expect(await redis.argrep(arrayKey, 0, 3, "RE", "^g")).to.eql([3]);
    });

    it("supports AND, OR, LIMIT, WITHVALUES, NOCASE, and reversed traversal", async () => {
      const arrayKey = key("argrep_options");

      await redis.arset(arrayKey, 0, "Alpha", "beta", "alphabet", "gamma");

      expect(
        await redis.argrep(arrayKey, 0, 3, "MATCH", "alpha", "NOCASE")
      ).to.eql([0, 2]);
      expect(
        await redis.argrep(arrayKey, 0, 3, "MATCH", "a", "LIMIT", 2)
      ).to.eql([0, 1]);
      expect(
        await redis.argrep(
          arrayKey,
          0,
          3,
          "MATCH",
          "alpha",
          "WITHVALUES",
          "NOCASE"
        )
      ).to.eql([
        [0, "Alpha"],
        [2, "alphabet"],
      ]);
      expect(
        await redis.argrep(
          arrayKey,
          0,
          3,
          "MATCH",
          "alpha",
          "MATCH",
          "bet",
          "AND"
        )
      ).to.eql([2]);
      expect(
        await redis.argrep(
          arrayKey,
          0,
          3,
          "EXACT",
          "beta",
          "EXACT",
          "gamma",
          "OR"
        )
      ).to.eql([1, 3]);
      expect(await redis.argrep(arrayKey, 3, 0, "MATCH", "a")).to.eql([
        3, 2, 1, 0,
      ]);
    });

    it("returns empty arrays for missing keys or no matches", async () => {
      const arrayKey = key("argrep_empty");

      await redis.arset(arrayKey, 0, "zero");

      expect(await redis.argrep(arrayKey, 0, 2, "MATCH", "missing")).to.eql([]);
      expect(
        await redis.argrep(key("argrep_missing"), 0, 2, "MATCH", "z")
      ).to.eql([]);
    });

    it("supports Buffer replies", async () => {
      const arrayKey = key("argrep_buffer");

      await redis.arset(arrayKey, 0, "Alpha", "beta");

      expect(await redis.argrepBuffer(arrayKey, 0, 1, "EXACT", "beta")).to.eql([
        1,
      ]);
      expect(
        await redis.argrepBuffer(arrayKey, 0, 1, "EXACT", "beta", "WITHVALUES")
      ).to.eql([[1, Buffer.from("beta")]]);
    });
  });

  describe("arinfo", () => {
    it("returns top-level metadata", async () => {
      const arrayKey = key("arinfo");

      await redis.arset(arrayKey, 0, "zero", "one");

      const info = toInfoRecord(await redis.arinfo(arrayKey));
      expect(info.count).to.eql(2);
      expect(info.len).to.eql(2);
      expect(info["next-insert-index"]).to.eql(0);
      expect(info).to.have.property("slice-size");
    });

    it("supports FULL metadata", async () => {
      const arrayKey = key("arinfo_full");

      await redis.arset(arrayKey, 0, "zero", "one");

      const info = toInfoRecord(await redis.arinfo(arrayKey, "FULL"));
      expect(info).to.have.property("dense-slices");
      expect(info).to.have.property("sparse-slices");
    });

    it("supports Buffer replies", async () => {
      const arrayKey = key("arinfo_buffer");

      await redis.arset(arrayKey, 0, "zero");

      const info = toInfoRecord(await redis.arinfoBuffer(arrayKey, "FULL"));
      expect(info.count).to.eql(1);
      expect(info).to.have.property("dense-slices");
    });

    it("raises a server error for missing keys", async () => {
      let error: Error | undefined;

      try {
        await redis.arinfo(key("arinfo_missing"));
      } catch (err) {
        error = err as Error;
      }
      expect(error?.message).to.include("no such key");
    });
  });

  describe("arinsert", () => {
    it("inserts one value at the current cursor", async () => {
      const arrayKey = key("arinsert_one");

      expect(await redis.arinsert(arrayKey, "zero")).to.eql(0);
      expect(await redis.arget(arrayKey, 0)).to.eql("zero");
      expect(await redis.arnext(arrayKey)).to.eql(1);
    });

    it("inserts multiple string, Buffer, and number values", async () => {
      const arrayKey = key("arinsert_many");

      expect(
        await redis.arinsert(arrayKey, "zero", Buffer.from("one"), 2)
      ).to.eql(2);
      expect(await redis.argetrange(arrayKey, 0, 2)).to.eql([
        "zero",
        "one",
        "2",
      ]);
    });
  });

  describe("arlastitems", () => {
    it("returns the latest items in chronological order", async () => {
      const arrayKey = key("arlastitems");

      await redis.arinsert(arrayKey, "a", "b", "c");

      expect(await redis.arlastitems(arrayKey, 2)).to.eql(["b", "c"]);
      expect(await redis.arlastitems(arrayKey, 10)).to.eql(["a", "b", "c"]);
      expect(await redis.arlastitems(key("arlastitems_missing"), 2)).to.eql([]);
    });

    it("supports REV", async () => {
      const arrayKey = key("arlastitems_rev");

      await redis.arinsert(arrayKey, "a", "b", "c");

      expect(await redis.arlastitems(arrayKey, 2, "REV")).to.eql(["c", "b"]);
    });

    it("returns null sparse slots and supports Buffer replies", async () => {
      const arrayKey = key("arlastitems_buffer");

      await redis.arinsert(arrayKey, "a", "b");
      await redis.arseek(arrayKey, 5);
      await redis.arinsert(arrayKey, "f");

      expect(await redis.arlastitems(arrayKey, 2)).to.eql([null, "f"]);
      expect(await redis.arlastitemsBuffer(arrayKey, 2, "REV")).to.eql([
        Buffer.from("f"),
        null,
      ]);
    });
  });

  describe("arlen", () => {
    it("returns max index plus one or 0 for missing keys", async () => {
      const arrayKey = key("arlen");

      expect(await redis.arlen(arrayKey)).to.eql(0);
      await redis.arset(arrayKey, 3, "three");

      expect(await redis.arlen(arrayKey)).to.eql(4);
    });
  });

  describe("armget", () => {
    it("returns values in requested order with nulls for missing slots", async () => {
      const arrayKey = key("armget");

      await redis.arset(arrayKey, 1, "one", "two");

      expect(await redis.armget(arrayKey, 2, "0", 1)).to.eql([
        "two",
        null,
        "one",
      ]);
      expect(await redis.armget(key("armget_missing"), 0, 2)).to.eql([
        null,
        null,
      ]);
    });

    it("supports Buffer replies", async () => {
      const arrayKey = key("armget_buffer");

      await redis.arset(arrayKey, 0, "zero", Buffer.from("one"));

      expect(await redis.armgetBuffer(arrayKey, 1, 0, 9)).to.eql([
        Buffer.from("one"),
        Buffer.from("zero"),
        null,
      ]);
    });
  });

  describe("armset", () => {
    it("sets one index-value pair", async () => {
      const arrayKey = key("armset_one");

      expect(await redis.armset(arrayKey, 1, "one")).to.eql(1);
      expect(await redis.argetrange(arrayKey, 0, 1)).to.eql([null, "one"]);
    });

    it("sets multiple non-contiguous pairs with string, Buffer, and number values", async () => {
      const arrayKey = key("armset_many");

      expect(
        await redis.armset(arrayKey, 3, Buffer.from("three"), 1, "one", 5, 5)
      ).to.eql(3);
      expect(await redis.armget(arrayKey, 1, 3, 5)).to.eql([
        "one",
        "three",
        "5",
      ]);
    });

    it("counts only newly populated slots", async () => {
      const arrayKey = key("armset_existing");

      await redis.armset(arrayKey, 0, "zero", 2, "two");
      expect(await redis.armset(arrayKey, 0, "ZERO", 1, "one")).to.eql(1);
    });
  });

  describe("arnext", () => {
    it("returns 0 for missing keys and the next insert cursor", async () => {
      const arrayKey = key("arnext");

      expect(await redis.arnext(arrayKey)).to.eql(0);
      await redis.arinsert(arrayKey, "zero", "one");

      expect(await redis.arnext(arrayKey)).to.eql(2);
    });

    it("reflects ARSEEK cursor changes", async () => {
      const arrayKey = key("arnext_seek");

      await redis.arinsert(arrayKey, "zero");
      await redis.arseek(arrayKey, 5);

      expect(await redis.arnext(arrayKey)).to.eql(5);
    });
  });

  describe("arop", () => {
    it("returns string aggregates for SUM, MIN, and MAX", async () => {
      const arrayKey = key("arop_strings");

      await redis.arset(arrayKey, 0, 1, 2, 3);

      expect(await redis.arop(arrayKey, 0, 2, "SUM")).to.eql("6");
      expect(await redis.arop(arrayKey, 2, 0, "SUM")).to.eql("6");
      expect(await redis.arop(arrayKey, 0, 2, "MIN")).to.eql("1");
      expect(await redis.arop(arrayKey, 0, 2, "MAX")).to.eql("3");
    });

    it("supports Buffer replies for string aggregates", async () => {
      const arrayKey = key("arop_buffer");

      await redis.arset(arrayKey, 0, 1, 2, 3);

      expect(await redis.aropBuffer(arrayKey, 0, 2, "SUM")).to.eql(
        Buffer.from("6")
      );
      expect(await redis.aropBuffer(arrayKey, 0, 2, "MIN")).to.eql(
        Buffer.from("1")
      );
      expect(await redis.aropBuffer(arrayKey, 0, 2, "MAX")).to.eql(
        Buffer.from("3")
      );
    });

    it("returns integer or null aggregates for AND, OR, XOR, MATCH, and USED", async () => {
      const arrayKey = key("arop_numbers");

      await redis.arset(arrayKey, 0, 1, 2, 3);

      expect(await redis.arop(arrayKey, 0, 2, "AND")).to.eql(0);
      expect(await redis.arop(arrayKey, 0, 2, "OR")).to.eql(3);
      expect(await redis.arop(arrayKey, 0, 2, "XOR")).to.eql(0);
      expect(await redis.arop(arrayKey, 0, 2, "MATCH", 2)).to.eql(1);
      expect(await redis.arop(arrayKey, 0, 2, "MATCH", "missing")).to.eql(0);
      expect(await redis.arop(arrayKey, 0, 2, "USED")).to.eql(3);
    });

    it("returns null or 0 for empty aggregate ranges", async () => {
      const arrayKey = key("arop_empty");

      await redis.arset(arrayKey, 0, "not-a-number");

      expect(await redis.arop(arrayKey, 0, 0, "SUM")).to.eql(null);
      expect(await redis.arop(key("arop_missing"), 0, 2, "AND")).to.eql(null);
      expect(await redis.arop(key("arop_missing"), 0, 2, "USED")).to.eql(0);
    });
  });

  describe("arring", () => {
    it("inserts one or more values and returns the last index", async () => {
      const arrayKey = key("arring");

      expect(await redis.arring(arrayKey, 3, "a")).to.eql(0);
      expect(await redis.arring(arrayKey, 3, "b", "c")).to.eql(2);
      expect(await redis.argetrange(arrayKey, 0, 2)).to.eql(["a", "b", "c"]);
    });

    it("wraps, overwrites, and shrinks the ring window", async () => {
      const arrayKey = key("arring_wrap");

      await redis.arring(arrayKey, 3, "a", "b", "c");
      expect(await redis.arring(arrayKey, 3, "d")).to.eql(0);
      expect(await redis.argetrange(arrayKey, 0, 2)).to.eql(["d", "b", "c"]);
      expect(await redis.arlastitems(arrayKey, 3)).to.eql(["b", "c", "d"]);

      expect(await redis.arring(arrayKey, 2, "e")).to.eql(0);
      expect(await redis.arlen(arrayKey)).to.eql(2);
      expect(await redis.arlastitems(arrayKey, 3)).to.eql(["d", "e"]);
    });

    it("accepts Buffer and number values", async () => {
      const arrayKey = key("arring_values");

      expect(await redis.arring(arrayKey, 2, Buffer.from("a"), 1)).to.eql(1);
      expect(await redis.argetrange(arrayKey, 0, 1)).to.eql(["a", "1"]);
    });
  });

  describe("arscan", () => {
    it("returns populated index-value pairs and skips sparse slots", async () => {
      const arrayKey = key("arscan");

      await redis.arset(arrayKey, 0, "zero");
      await redis.arset(arrayKey, 3, "three");

      expect(await redis.arscan(arrayKey, 0, 5)).to.eql([
        [0, "zero"],
        [3, "three"],
      ]);
      expect(await redis.arscan(key("arscan_missing"), 0, 5)).to.eql([]);
    });

    it("supports reversed traversal and LIMIT", async () => {
      const arrayKey = key("arscan_options");

      await redis.arset(arrayKey, 0, "zero");
      await redis.arset(arrayKey, 3, "three");

      expect(await redis.arscan(arrayKey, 5, 0)).to.eql([
        [3, "three"],
        [0, "zero"],
      ]);
      expect(await redis.arscan(arrayKey, 0, 5, "LIMIT", 1)).to.eql([
        [0, "zero"],
      ]);
    });

    it("supports Buffer replies", async () => {
      const arrayKey = key("arscan_buffer");

      await redis.arset(arrayKey, 0, "zero");
      await redis.arset(arrayKey, 3, Buffer.from("three"));

      expect(await redis.arscanBuffer(arrayKey, 0, 5)).to.eql([
        [0, Buffer.from("zero")],
        [3, Buffer.from("three")],
      ]);
      expect(await redis.arscanBuffer(arrayKey, 0, 5, "LIMIT", 1)).to.eql([
        [0, Buffer.from("zero")],
      ]);
    });
  });

  describe("arseek", () => {
    it("sets the insert cursor for existing arrays", async () => {
      const arrayKey = key("arseek");

      await redis.arinsert(arrayKey, "zero", "one");

      expect(await redis.arseek(arrayKey, "5")).to.eql(1);
      expect(await redis.arnext(arrayKey)).to.eql(5);
      expect(await redis.arinsert(arrayKey, "five")).to.eql(5);
      expect(await redis.arget(arrayKey, 5)).to.eql("five");
    });

    it("returns 0 for missing keys", async () => {
      expect(await redis.arseek(key("arseek_missing"), 1)).to.eql(0);
    });
  });

  describe("arset", () => {
    it("sets one value at a number or string index", async () => {
      const arrayKey = key("arset_one");

      expect(await redis.arset(arrayKey, 0, "zero")).to.eql(1);
      expect(await redis.arset(arrayKey, "2", "two")).to.eql(1);
      expect(await redis.argetrange(arrayKey, 0, 2)).to.eql([
        "zero",
        null,
        "two",
      ]);
    });

    it("sets multiple contiguous string, Buffer, and number values", async () => {
      const arrayKey = key("arset_many");

      expect(
        await redis.arset(arrayKey, 1, "one", Buffer.from("two"), 3)
      ).to.eql(3);
      expect(await redis.argetrange(arrayKey, 0, 3)).to.eql([
        null,
        "one",
        "two",
        "3",
      ]);
    });

    it("counts only newly populated slots", async () => {
      const arrayKey = key("arset_existing");

      await redis.arset(arrayKey, 0, "zero", "one");
      expect(await redis.arset(arrayKey, 1, "ONE", "two")).to.eql(1);
    });
  });
});
