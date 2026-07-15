import * as sinon from "sinon";
import Redis from "../../lib/Redis";
import { DEFAULT_REDIS_OPTIONS } from "../../lib/redis/RedisOptions";
import { isReCluster, loadREConnection } from "./re-config";

// When RE_CLUSTER=true, point the default connection used by `new Redis()` at the
// managed Redis Enterprise database resolved from REDIS_ENDPOINTS_CONFIG_PATH.
// Tests that pass an explicit host/port (mock servers, deliberate failure ports)
// are unaffected. When RE_CLUSTER is unset, behaviour is unchanged (localhost:6379).
if (isReCluster()) {
  const re = loadREConnection();
  DEFAULT_REDIS_OPTIONS.host = re.host;
  DEFAULT_REDIS_OPTIONS.port = re.port;
  if (re.username) {
    DEFAULT_REDIS_OPTIONS.username = re.username;
  }
  if (re.password) {
    DEFAULT_REDIS_OPTIONS.password = re.password;
  }
  if (re.tls) {
    DEFAULT_REDIS_OPTIONS.tls = { rejectUnauthorized: false };
  }
}

afterEach((done) => {
  sinon.restore();

  if (isReCluster()) {
    // A managed Redis Enterprise database does not permit CLIENT KILL / SCRIPT FLUSH
    // for the default user, and killing connections would disrupt the shared proxy;
    // FLUSHALL alone is enough to isolate tests on a dedicated BDB.
    new Redis().flushall().then(
      () => done(),
      (err) => done(err)
    );
    return;
  }

  new Redis()
    .pipeline()
    .flushall()
    .script("FLUSH")
    .client("KILL", "normal")
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
