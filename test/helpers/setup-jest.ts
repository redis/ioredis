import { jest } from "@jest/globals";
import Redis from "../../lib";

const actualProcess = process;
// @ts-expect-error
process.actual = () => actualProcess;

let constructorSpy: any;
beforeEach(() => {
  constructorSpy = jest.spyOn(Redis.prototype, "connect");
});

afterEach(async () => {
  new Redis().pipeline().flushall().script("FLUSH").client("KILL", "normal");

  await Promise.all(
    constructorSpy.mock.contexts.map((redis: Redis) => {
      return new Promise<void>((resolve) => {
        if (redis.status === "end") {
          resolve();
        } else {
          redis.once("end", () => {
            resolve();
          });
          redis.disconnect();
        }
      });
    })
  );
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
