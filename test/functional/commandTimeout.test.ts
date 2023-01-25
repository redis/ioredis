import { describe, expect, it, jest } from "@jest/globals";
import Redis from "../../lib/Redis";
import MockServer from "../helpers/mock_server";

jest.useFakeTimers();

describe("commandTimeout", () => {
  it("rejects if command timed out", (done) => {
    new MockServer(30001, (argv, _socket, flags) => {
      if (argv[0] === "hget") {
        flags.hang = true;
        return;
      }
    });

    const redis = new Redis({ port: 30001, commandTimeout: 1000 });
    redis.hget("foo", "bar", (err) => {
      expect(err?.message).toBe("Command timed out");
      done();
    });
    jest.advanceTimersByTime(1000);
  });

  it("does not leak timers for commands in offline queue", async () => {
    new MockServer(30001);
    const redis = new Redis({ port: 30001, commandTimeout: 1000 });
    await redis.hget("foo", "bar");
    expect(jest.getTimerCount()).toBe(0);
  });
});
