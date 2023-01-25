import { describe, expect, it, jest } from "@jest/globals";
import Redis from "../../lib/Redis";
import MockServer from "../helpers/mock_server";

jest.useFakeTimers();

describe("disconnection", () => {
  it("should clear all timers on disconnect", (done) => {
    new MockServer(30000);

    const redis = new Redis({});
    redis.on("connect", () => {
      redis.disconnect();
    });

    redis.on("end", () => {
      expect(jest.getTimerCount()).toBe(0);
      done();
    });
  });

  it("should clear all timers on server exits", (done) => {
    const server = new MockServer(30000);

    const redis = new Redis({
      port: 30000,
      retryStrategy: null,
    });
    redis.on("end", () => {
      expect(jest.getTimerCount()).toBe(0);
      done();
    });

    server.disconnect();
  });
});
