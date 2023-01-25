import Redis from "../../lib/Redis";
import { describe, expect, it } from "@jest/globals";
import MockServer from "../helpers/mock_server";

describe("fatal_error", () => {
  it("should handle fatal error of parser", async () => {
    let recovered = false;
    new MockServer(30000, (argv) => {
      if (recovered) {
        return;
      }
      if (argv[0] === "get") {
        return MockServer.raw("&");
      }
    });
    const redis = new Redis(30000);
    await expect(redis.get("foo")).rejects.toThrow(/Protocol error/);

    recovered = true;
    await redis.get("bar");
  });
});
