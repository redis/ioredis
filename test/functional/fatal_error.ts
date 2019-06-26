import Redis from "../../lib/redis";
import { expect } from "chai";
import MockServer from "../helpers/mock_server";

describe("fatal_error", function() {
  it("should handle fatal error of parser", function(done) {
    var recovered = false;
    new MockServer(30000, argv => {
      if (recovered) {
        return;
      }
      if (argv[0] === "get") {
        return MockServer.raw("&");
      }
    });
    var redis = new Redis(30000);
    redis.get("foo", function(err) {
      expect(err.message).to.match(/Protocol error/);

      recovered = true;
      redis.get("bar", function(err) {
        expect(err).to.eql(null);
        done();
      });
    });
  });
});
