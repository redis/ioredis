import * as calculateSlot from "cluster-key-slot";
import MockServer from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster } from "../../../lib";

describe("cluster:maxRedirections", function () {
  it("should return error when reached max redirection", function (done) {
    let redirectTimes = 0;
    const argvHandler = function (argv) {
      if (argv[0] === "cluster" && argv[1] === "slots") {
        return [
          [0, 1, ["127.0.0.1", 30001]],
          [2, 16383, ["127.0.0.1", 30002]],
        ];
      } else if (argv[0] === "get" && argv[1] === "foo") {
        redirectTimes += 1;
        return new Error("ASK " + calculateSlot("foo") + " 127.0.0.1:30001");
      }
    };
    new MockServer(30001, argvHandler);
    new MockServer(30002, argvHandler);

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      maxRedirections: 5,
    });
    cluster.get("foo", function (err) {
      expect(redirectTimes).to.eql(6);
      expect(err.message).to.match(/Too many Cluster redirections/);
      cluster.disconnect();
      done();
    });
  });
});
