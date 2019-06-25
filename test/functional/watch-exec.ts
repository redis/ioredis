import Redis from "../../lib/redis";
import { expect } from "chai";

describe("watch-exec", function() {
  it("should support watch/exec transactions", function() {
    var redis1 = new Redis();
    return redis1
      .watch("watchkey")
      .then(function() {
        return redis1
          .multi()
          .set("watchkey", "1")
          .exec();
      })
      .then(function(result) {
        expect(result.length).to.eql(1);
        expect(result[0]).to.eql([null, "OK"]);
      });
  });

  it("should support watch/exec transaction rollback", function() {
    var redis1 = new Redis();
    var redis2 = new Redis();
    return redis1
      .watch("watchkey")
      .then(function() {
        return redis2.set("watchkey", "2");
      })
      .then(function() {
        return redis1
          .multi()
          .set("watchkey", "1")
          .exec();
      })
      .then(function(result) {
        expect(result).to.be.null;
      });
  });
});
