import { strict as assert } from "assert";
import { execFileSync } from "child_process";
import { VerbatimString } from "../../../lib/resp/verbatim-string";

describe("VerbatimString", () => {
  it("does not add properties to strings", () => {
    assert.equal(Reflect.has(String.prototype, "ioredisVerbatimString"), false);
    assert.equal(
      Reflect.has(new VerbatimString("txt", "a"), "ioredisVerbatimString"),
      false
    );
    assert.deepEqual(Object.keys(new VerbatimString("txt", "ab")), [
      "0",
      "1",
      "format",
    ]);
  });

  it("keeps String.prototype in fast mode after the class is defined", function () {
    this.timeout(30_000);

    const stripTypes = "--no-experimental-strip-types";
    // A fresh process that loads only this module: this one has already
    // defined the class, and ts-node compiling more modules can hide the bug.
    const output = execFileSync(
      process.execPath,
      [
        "--allow-natives-syntax",
        ...(process.allowedNodeEnvironmentFlags.has(stripTypes)
          ? [stripTypes]
          : []),
        "--require",
        "ts-node/register",
        "--eval",
        `
          const before = %HasFastProperties(String.prototype);
          require(${JSON.stringify(
            require.resolve("../../../lib/resp/verbatim-string")
          )});
          const after = %HasFastProperties(String.prototype);
          process.stdout.write(JSON.stringify({ before, after }));
        `,
      ],
      {
        cwd: __dirname,
        encoding: "utf8",
        env: { ...process.env, TS_NODE_TRANSPILE_ONLY: "true" },
        timeout: 20_000,
      }
    );

    assert.deepEqual(JSON.parse(output), { before: true, after: true });
  });
});
