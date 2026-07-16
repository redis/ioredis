import Redis from "../../lib/Redis";
import { expect } from "chai";
import { isReCluster } from "../helpers/re-config";

describe("duplicate", () => {
  it("clone the options", function () {
    // Asserts the hardcoded default port 6379; against a managed Redis Enterprise
    // database the default connection port is the BDB port, not 6379.
    if (isReCluster()) {
      this.skip();
    }
    const redis = new Redis();
    const duplicatedRedis = redis.duplicate();
    redis.options.port = 1234;
    expect(duplicatedRedis.options.port).to.eql(6379);
  });
});
