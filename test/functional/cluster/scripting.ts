import MockServer from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster } from "../../../lib";

describe("cluster:scripting", () => {
  it("should throw when not all keys in a pipeline command belong to the same slot", async () => {
    const lua = "return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}";
    const handler = (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return [
          [0, 12181, ["127.0.0.1", 30001]],
          [12182, 16383, ["127.0.0.1", 30002]],
        ];
      }
      console.log(argv);
      if (argv[0] === "eval" && argv[1] === lua && argv[2] === "2") {
        return argv.slice(3);
      }
    };
    new MockServer(30001, handler);
    new MockServer(30002, handler);

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      scripts: { test: { lua, numberOfKeys: 2 }, testDynamic: { lua } },
    });

    // @ts-expect-error
    expect(await cluster.test("{foo}1", "{foo}2", "argv1", "argv2")).to.eql([
      "{foo}1",
      "{foo}2",
      "argv1",
      "argv2",
    ]);

    expect(
      // @ts-expect-error
      await cluster.testDynamic(2, "{foo}1", "{foo}2", "argv1", "argv2")
    ).to.eql(["{foo}1", "{foo}2", "argv1", "argv2"]);

    cluster.disconnect();
  });
});
