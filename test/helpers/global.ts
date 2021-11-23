import * as sinon from "sinon";
import Redis from "../../lib/redis";

afterEach(function (done) {
  sinon.restore();
  new Redis()
    .pipeline()
    .flushall()
    .script("flush")
    .client("kill", "normal")
    .exec(done);
});

process.on("unhandledRejection", (reason) => {
  console.log("mocha test saw unexpected unhandledRejection", reason);
  throw new Error("mocha test saw unexpected unhandledRejection: " + reason);
});

// Suppress "Unhandled error event" logs from edge cases that are deliberately being tested.
// Don't suppress other error types, such as errors in typescript files.
const error = console.error;
console.error = function (...args) {
  if (
    typeof args[0] === "string" &&
    args[0].indexOf("[ioredis] Unhandled error event") === 0
  ) {
    return;
  }
  error.call(console, ...args);
};
