import { expect } from "chai";
import Command from "../../lib/Command";
import * as sinon from "sinon";

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

    it("should covert result to string if replyEncoding is specified", (done) => {
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

    it("should be case insensitive for command name", () => {
      expect(Command.checkFlag("VALID_IN_SUBSCRIBER_MODE", "PING")).to.eql(
        true
      );
      expect(Command.checkFlag("VALID_IN_SUBSCRIBER_MODE", "Get")).to.eql(
        false
      );
      expect(Command.checkFlag("WILL_DISCONNECT", "QuIt")).to.eql(true);
    });
  });

  describe("#setBlockingTimeout()", () => {
    it("should resolve command with null when timeout fires", async () => {
      const clock = sinon.useFakeTimers();
      const command = new Command("blpop", ["key", "0"]);

      command.setBlockingTimeout(25);

      clock.tick(30);

      const value = await command.promise;
      expect(value).to.be.null;

      clock.restore();
    });

    it("should clear timer when command resolves", async () => {
      const clock = sinon.useFakeTimers();
      const command = new Command("blpop", ["key", "0"]);

      command.setBlockingTimeout(50);

      command.resolve(["key", "value"]);

      clock.tick(100);
      const value = await command.promise;
      expect(value).to.deep.equal(["key", "value"]);
      clock.restore();
    });

    it("should not re-resolve after already resolved with value", async () => {
      const clock = sinon.useFakeTimers();
      const command = new Command("blpop", ["key", "0"]);

      command.resolve(["key", "value"]);

      command.setBlockingTimeout(10);

      clock.tick(20);

      const value = await command.promise;
      expect(value).to.deep.equal(["key", "value"]);
      clock.restore();
    });

    it("should ignore non-positive durations", () => {
      const clock = sinon.useFakeTimers();
      const command = new Command("blpop", ["key", "0"]);
      let resolved = false;

      command.promise.then(() => {
        resolved = true;
      });

      command.setBlockingTimeout(0);
      clock.tick(100);

      expect(resolved).to.be.false;
      clock.restore();
    });
  });

  describe("#extractBlockingTimeout()", () => {
    describe("returns undefined for", () => {
      it("non-blocking commands", () => {
        const command = new Command("get", ["key"]);
        expect(command.extractBlockingTimeout()).to.be.undefined;
      });

      it("commands with empty args", () => {
        const command = new Command("blpop", []);
        expect(command.extractBlockingTimeout()).to.be.undefined;
      });
    });

    describe("LAST_ARG_TIMEOUT_COMMANDS", () => {
      const lastArgCommands = [
        "blpop",
        "brpop",
        "brpoplpush",
        "blmove",
        "bzpopmin",
        "bzpopmax",
      ];

      lastArgCommands.forEach((cmd) => {
        it(`extracts timeout from ${cmd} with number arg`, () => {
          const command = new Command(cmd, ["key1", "key2", 5]);
          expect(command.extractBlockingTimeout()).to.equal(5000);
        });

        it(`extracts timeout from ${cmd} with string arg`, () => {
          const command = new Command(cmd, ["key1", "key2", "10"]);
          expect(command.extractBlockingTimeout()).to.equal(10000);
        });

        it(`extracts timeout from ${cmd.toUpperCase()} (case insensitive)`, () => {
          const command = new Command(cmd.toUpperCase(), ["key", 3]);
          expect(command.extractBlockingTimeout()).to.equal(3000);
        });

        it(`returns 0 for ${cmd} with zero timeout`, () => {
          const command = new Command(cmd, ["key", 0]);
          expect(command.extractBlockingTimeout()).to.equal(0);
        });

        it(`returns 0 for ${cmd} with negative timeout`, () => {
          const command = new Command(cmd, ["key", -5]);
          expect(command.extractBlockingTimeout()).to.equal(0);
        });

        it(`returns undefined for ${cmd} with invalid timeout arg`, () => {
          const command = new Command(cmd, ["key", "invalid"]);
          expect(command.extractBlockingTimeout()).to.be.undefined;
        });
      });

      it("handles Buffer timeout arg", () => {
        const command = new Command("blpop", ["key", Buffer.from("5")]);
        expect(command.extractBlockingTimeout()).to.equal(5000);
      });

      it("handles fractional seconds", () => {
        const command = new Command("blpop", ["key", "1.5"]);
        expect(command.extractBlockingTimeout()).to.equal(1500);
      });
    });

    describe("FIRST_ARG_TIMEOUT_COMMANDS", () => {
      const firstArgCommands = ["bzmpop", "blmpop"];

      firstArgCommands.forEach((cmd) => {
        it(`extracts timeout from ${cmd} with number arg`, () => {
          const command = new Command(cmd, [5, "1", "MIN", "key1"]);
          expect(command.extractBlockingTimeout()).to.equal(5000);
        });

        it(`extracts timeout from ${cmd} with string arg`, () => {
          const command = new Command(cmd, ["10", "1", "MAX", "key1"]);
          expect(command.extractBlockingTimeout()).to.equal(10000);
        });

        it(`extracts timeout from ${cmd.toUpperCase()} (case insensitive)`, () => {
          const command = new Command(cmd.toUpperCase(), [3, "1", "MIN", "key"]);
          expect(command.extractBlockingTimeout()).to.equal(3000);
        });

        it(`returns 0 for ${cmd} with zero timeout`, () => {
          const command = new Command(cmd, [0, "1", "MIN", "key"]);
          expect(command.extractBlockingTimeout()).to.equal(0);
        });

        it(`returns 0 for ${cmd} with negative timeout`, () => {
          const command = new Command(cmd, [-5, "1", "MIN", "key"]);
          expect(command.extractBlockingTimeout()).to.equal(0);
        });

        it(`returns undefined for ${cmd} with invalid timeout arg`, () => {
          const command = new Command(cmd, ["invalid", "1", "MIN", "key"]);
          expect(command.extractBlockingTimeout()).to.be.undefined;
        });
      });
    });

    describe("BLOCK_OPTION_COMMANDS", () => {
      const blockOptionCommands = ["xread", "xreadgroup"];

      blockOptionCommands.forEach((cmd) => {
        it(`extracts timeout from ${cmd} with BLOCK option`, () => {
          const command = new Command(cmd, ["BLOCK", 5000, "STREAMS", "stream", "0"]);
          expect(command.extractBlockingTimeout()).to.equal(5000);
        });

        it(`extracts timeout from ${cmd} with lowercase block option`, () => {
          const command = new Command(cmd, ["block", 3000, "STREAMS", "stream", "0"]);
          expect(command.extractBlockingTimeout()).to.equal(3000);
        });

        it(`returns null for ${cmd} without BLOCK option`, () => {
          const command = new Command(cmd, ["STREAMS", "stream", "0"]);
          expect(command.extractBlockingTimeout()).to.be.null;
        });

        it(`returns 0 for ${cmd} with zero BLOCK duration`, () => {
          const command = new Command(cmd, ["BLOCK", 0, "STREAMS", "stream", "0"]);
          expect(command.extractBlockingTimeout()).to.equal(0);
        });

        it(`returns 0 for ${cmd} with negative BLOCK duration`, () => {
          const command = new Command(cmd, ["BLOCK", -100, "STREAMS", "stream", "0"]);
          expect(command.extractBlockingTimeout()).to.equal(0);
        });

        it(`returns undefined for ${cmd} with invalid BLOCK duration`, () => {
          const command = new Command(cmd, ["BLOCK", "invalid", "STREAMS", "stream", "0"]);
          expect(command.extractBlockingTimeout()).to.be.undefined;
        });
      });

      it("handles BLOCK option with Buffer value", () => {
        const command = new Command("xread", ["BLOCK", Buffer.from("5000"), "STREAMS", "s", "0"]);
        expect(command.extractBlockingTimeout()).to.equal(5000);
      });

      it("handles BLOCK as Buffer token", () => {
        const command = new Command("xread", [Buffer.from("BLOCK"), 2000, "STREAMS", "s", "0"]);
        expect(command.extractBlockingTimeout()).to.equal(2000);
      });
    });
  });
});
