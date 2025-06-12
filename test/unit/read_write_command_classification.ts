import { exists, hasFlag } from "@ioredis/commands";
import { expect } from "chai";
import Command from "../../lib/Command";

describe("Read/Write Command Classification", () => {
  function isReadOnlyCommand(command: Command): boolean {
    // This mirrors the logic in Redis.ts
    if (command.isReadOnly) {
      return true;
    }

    if (exists(command.name)) {
      return hasFlag(command.name, "readonly");
    }

    return false;
  }

  describe("Read-only commands", () => {
    const readCommands = [
      "get", "mget", "exists", "keys", "scan", "type", "ttl", "pttl",
      "strlen", "getbit", "getrange", "substr",
      "hget", "hmget", "hkeys", "hvals", "hgetall", "hexists", "hlen", "hscan",
      "llen", "lrange", "lindex",
      "scard", "sismember", "smembers", "srandmember", "sscan",
      "zcard", "zcount", "zlexcount", "zrange", "zrangebylex", "zrangebyscore",
      "zrank", "zrevrange", "zrevrangebylex", "zrevrangebyscore", "zrevrank", "zscore", "zscan",
      "pfcount",
      "info", "ping", "echo", "time", "lastsave", "dbsize",
      "randomkey", "dump"
    ];

    readCommands.forEach(cmdName => {
      it(`should classify ${cmdName.toUpperCase()} as read-only`, () => {
        const command = new Command(cmdName, ["arg1"]);
        expect(isReadOnlyCommand(command)).to.be.true;
      });
    });
  });

  describe("Write commands", () => {
    const writeCommands = [
      "set", "mset", "del", "expire", "expireat", "pexpire", "pexpireat",
      "setex", "psetex", "setnx", "msetnx", "incr", "decr", "incrby", "decrby",
      "append", "setbit", "setrange",
      "hset", "hmset", "hdel", "hincrby", "hincrbyfloat",
      "lpush", "rpush", "lpop", "rpop", "lset", "ltrim", "linsert", "lrem",
      "sadd", "srem", "spop", "smove",
      "zadd", "zrem", "zincrby", "zremrangebylex", "zremrangebyrank", "zremrangebyscore",
      "pfadd", "pfmerge",
      "flushdb", "flushall", "save", "bgsave", "bgrewriteaof"
    ];

    writeCommands.forEach(cmdName => {
      it(`should classify ${cmdName.toUpperCase()} as write`, () => {
        const command = new Command(cmdName, ["arg1"]);
        expect(isReadOnlyCommand(command)).to.be.false;
      });
    });
  });

  describe("Commands with explicit readOnly flag", () => {
    it("should respect explicit readOnly flag on command", () => {
      const command = new Command("customread", ["arg1"]);
      command.isReadOnly = true;
      expect(isReadOnlyCommand(command)).to.be.true;
    });

    it("should treat commands without readOnly flag and unknown to Redis as write", () => {
      const command = new Command("unknown_command", ["arg1"]);
      expect(isReadOnlyCommand(command)).to.be.false;
    });
  });

  describe("Special cases", () => {
    it("should handle EVAL scripts based on readOnly flag", () => {
      const readScript = new Command("eval", ["return redis.call('get', 'key')", "0"]);
      readScript.isReadOnly = true;
      expect(isReadOnlyCommand(readScript)).to.be.true;

      const writeScript = new Command("eval", ["return redis.call('set', 'key', 'val')", "0"]);
      expect(isReadOnlyCommand(writeScript)).to.be.false;
    });

    it("should handle MULTI/EXEC as write commands", () => {
      const multi = new Command("multi", []);
      const exec = new Command("exec", []);
      expect(isReadOnlyCommand(multi)).to.be.false;
      expect(isReadOnlyCommand(exec)).to.be.false;
    });
  });
});