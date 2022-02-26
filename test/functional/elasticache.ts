import Redis from "../../lib/Redis";
import { expect } from "chai";
import MockServer from "../helpers/mock_server";

// AWS Elasticache closes the connection immediately when it encounters a READONLY error
function simulateElasticache(options: {
  reconnectOnErrorValue: boolean | number;
}) {
  let inTransaction = false;
  const mockServer = new MockServer(30000, (argv, socket, flags) => {
    switch (argv[0]) {
      case "multi":
        inTransaction = true;
        return MockServer.raw("+OK\r\n");
      case "del":
        flags.disconnect = true;
        return new Error(
          "READONLY You can't write against a read only replica."
        );
      case "get":
        return inTransaction ? MockServer.raw("+QUEUED\r\n") : argv[1];
      case "exec":
        inTransaction = false;
        return [];
    }
  });

  return new Redis({
    port: 30000,
    reconnectOnError(err: Error): boolean | number {
      // bring the mock server back up
      mockServer.connect();
      return options.reconnectOnErrorValue;
    },
  });
}

function expectReplyError(err) {
  expect(err).to.exist;
  expect(err.name).to.eql("ReplyError");
}

function expectAbortError(err) {
  expect(err).to.exist;
  expect(err.name).to.eql("AbortError");
  expect(err.message).to.eql("Command aborted due to connection close");
}

describe("elasticache", () => {
  it("should abort a failed transaction when connection is lost", (done) => {
    const redis = simulateElasticache({ reconnectOnErrorValue: true });

    redis
      .multi()
      .del("foo")
      .del("bar")
      .exec((err) => {
        expectAbortError(err);
        expect(err.command).to.eql({
          name: "exec",
          args: [],
        });
        expect(err.previousErrors).to.have.lengthOf(2);
        expectReplyError(err.previousErrors[0]);
        expect(err.previousErrors[0].command).to.eql({
          name: "del",
          args: ["foo"],
        });
        expectAbortError(err.previousErrors[1]);
        expect(err.previousErrors[1].command).to.eql({
          name: "del",
          args: ["bar"],
        });

        // ensure we've recovered into a healthy state
        redis.get("foo", (err, res) => {
          expect(res).to.eql("foo");
          done();
        });
      });
  });

  it("should not resend failed transaction commands", (done) => {
    const redis = simulateElasticache({ reconnectOnErrorValue: 2 });
    redis
      .multi()
      .del("foo")
      .get("bar")
      .exec((err) => {
        expectAbortError(err);
        expect(err.command).to.eql({
          name: "exec",
          args: [],
        });
        expect(err.previousErrors).to.have.lengthOf(2);
        expectAbortError(err.previousErrors[0]);
        expect(err.previousErrors[0].command).to.eql({
          name: "del",
          args: ["foo"],
        });
        expectAbortError(err.previousErrors[1]);
        expect(err.previousErrors[1].command).to.eql({
          name: "get",
          args: ["bar"],
        });

        // ensure we've recovered into a healthy state
        redis.get("foo", (err, res) => {
          expect(res).to.eql("foo");
          done();
        });
      });
  });

  it("should resend intact pipelines", (done) => {
    const redis = simulateElasticache({ reconnectOnErrorValue: true });

    let p1Result;
    redis
      .pipeline()
      .del("foo")
      .get("bar")
      .exec((err, result) => (p1Result = result));

    redis
      .pipeline()
      .get("baz")
      .get("qux")
      .exec((err, p2Result) => {
        // First pipeline should have been aborted
        expect(p1Result).to.have.lengthOf(2);
        expect(p1Result[0]).to.have.lengthOf(1);
        expect(p1Result[1]).to.have.lengthOf(1);
        expectReplyError(p1Result[0][0]);
        expect(p1Result[0][0].command).to.eql({
          name: "del",
          args: ["foo"],
        });
        expectAbortError(p1Result[1][0]);
        expect(p1Result[1][0].command).to.eql({
          name: "get",
          args: ["bar"],
        });

        // Second pipeline was intact and should have been retried successfully
        expect(p2Result).to.have.lengthOf(2);
        expect(p2Result[0]).to.eql([null, "baz"]);
        expect(p2Result[1]).to.eql([null, "qux"]);

        done();
      });
  });
});
