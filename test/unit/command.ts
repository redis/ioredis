import { expect } from "chai";
import Command from "../../lib/Command";

describe("Command", () => {
  describe("constructor()", () => {
    it("should flatten the args", () => {
      const command = new Command("get", ["foo", ["bar", ["zoo", "zoo"]]]);
      expect(command.args).to.eql(["foo", "bar", "zoo,zoo"]);
    });
  });

  describe("#toWritable()", () => {
    it("should return correct string", () => {
      const command = new Command("get", ["foo", "bar", "zooo"]);
      expect(command.toWritable()).to.eql(
        "*4\r\n$3\r\nget\r\n$3\r\nfoo\r\n$3\r\nbar\r\n$4\r\nzooo\r\n"
      );
    });

    it("should return buffer when there's at least one arg is a buffer", () => {
      const command = new Command("get", ["foo", Buffer.from("bar"), "zooo"]);
      const result = command.toWritable();
      expect(result).to.be.instanceof(Buffer);
      expect(result.toString()).to.eql(
        "*4\r\n$3\r\nget\r\n$3\r\nfoo\r\n$3\r\nbar\r\n$4\r\nzooo\r\n"
      );
    });
  });

  describe("#resolve()", () => {
    it("should return buffer when replyEncoding is not set", (done) => {
      const command = new Command(
        "get",
        ["foo"],
        { replyEncoding: null },
        function (err, result) {
          expect(result).to.be.instanceof(Buffer);
          expect(result.toString()).to.eql("foo");
          done();
        }
      );
      command.resolve(Buffer.from("foo"));
    });

    it("should convert result to string if replyEncoding is specified", (done) => {
      const command = new Command(
        "get",
        ["foo"],
        { replyEncoding: "utf8" },
        function (err, result) {
          expect(result).to.eql("foo");
          done();
        }
      );
      command.resolve(Buffer.from("foo"));
    });

    it("should regard replyEncoding", (done) => {
      const base64 = Buffer.from("foo").toString("base64");
      const command = new Command(
        "get",
        ["foo"],
        { replyEncoding: "base64" },
        function (err, result) {
          expect(result).to.eql(base64);
          done();
        }
      );
      command.resolve(Buffer.from("foo"));
    });
  });

  describe("#getKeys()", () => {
    it("should return keys", () => {
      expect(getKeys("get", ["foo"])).to.eql(["foo"]);
      expect(getKeys("mget", ["foo", "bar"])).to.eql(["foo", "bar"]);
      expect(getKeys("mset", ["foo", "v1", "bar", "v2"])).to.eql([
        "foo",
        "bar",
      ]);
      expect(getKeys("hmset", ["key", "foo", "v1", "bar", "v2"])).to.eql([
        "key",
      ]);
      expect(getKeys("blpop", ["key1", "key2", "17"])).to.eql(["key1", "key2"]);
      expect(getKeys("evalsha", ["23123", "2", "foo", "bar", "zoo"])).to.eql([
        "foo",
        "bar",
      ]);
      expect(getKeys("evalsha", ["23123", 2, "foo", "bar", "zoo"])).to.eql([
        "foo",
        "bar",
      ]);
      expect(getKeys("sort", ["key"])).to.eql(["key"]);
      expect(getKeys("sort", ["key", "BY", "hash:*->field"])).to.eql([
        "key",
        "hash:*->field",
      ]);
      expect(
        getKeys("sort", [
          "key",
          "BY",
          "hash:*->field",
          "LIMIT",
          2,
          3,
          "GET",
          "gk",
          "GET",
          "#",
          "Get",
          "gh->f*",
          "DESC",
          "ALPHA",
          "STORE",
          "store",
        ])
      ).to.eql(["key", "hash:*->field", "gk", "gh->f*", "store"]);
      expect(
        getKeys("zunionstore", ["out", 2, "zset1", "zset2", "WEIGHTS", 2, 3])
      ).to.eql(["out", "zset1", "zset2"]);
      expect(
        getKeys("zinterstore", ["out", 2, "zset1", "zset2", "WEIGHTS", 2, 3])
      ).to.eql(["out", "zset1", "zset2"]);

      function getKeys(commandName, args) {
        const command = new Command(commandName, args);
        return command.getKeys();
      }
    });
  });

  describe("#getSlot()", () => {
    function expectSlot(key: any, slot: number) {
      expect(new Command("get", [key]).getSlot()).to.eql(slot);
    }

    it("should return correctly", () => {
      expectSlot("123", 5970);
      expectSlot(123, 5970);
      expectSlot("ab{c", 4619);
      expectSlot("ab{c}2", 7365);
      expectSlot("ab{{c}2", 2150);
      expectSlot("ab{qq}{c}2", 5598);
      expectSlot("ab}", 11817);
      expectSlot("encoding", 3060);
      expectSlot(true, 13635);
      expectSlot("true", 13635);
      expectSlot("", 0);
      expectSlot(null, 0);
      expectSlot(undefined, 0);
    });

    it("supports buffers", () => {
      expectSlot(Buffer.from("encoding"), 3060);
    });
  });

  describe(".checkFlag()", () => {
    it("should return correct result", () => {
      expect(Command.checkFlag("VALID_IN_SUBSCRIBER_MODE", "ping")).to.eql(
        true
      );
      expect(Command.checkFlag("VALID_IN_SUBSCRIBER_MODE", "get")).to.eql(
        false
      );
      expect(Command.checkFlag("WILL_DISCONNECT", "quit")).to.eql(true);
    });
  });
});
