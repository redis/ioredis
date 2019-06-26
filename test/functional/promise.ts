import Redis from "../../lib/redis";
import { expect } from "chai";
import * as bluebirdPromise from "bluebird";

var nativePromise = global.Promise;

describe("Promise", function() {
  it("uses native promise by default", function() {
    var redis = new Redis();
    expect(redis.get("foo").constructor).to.eql(nativePromise);
  });

  it("can switch to a custom Promise implementation", function() {
    var origin = Promise;

    // @ts-ignore
    Redis.Promise = bluebirdPromise;

    var redis = new Redis();
    expect(redis.get("foo").constructor).to.eql(bluebirdPromise);

    // @ts-ignore
    Redis.Promise = origin;
    expect(redis.get("foo").constructor).to.eql(origin);
  });
});
