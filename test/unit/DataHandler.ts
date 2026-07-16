import { expect } from "chai";
import * as sinon from "sinon";
import DataHandler from "../../lib/DataHandler";

describe("DataHandler", () => {
  it("attaches data handler to stream in correct order | https://github.com/redis/ioredis/issues/1919", () => {
    const prependListener = sinon.spy((event: string, handler: Function) => {
      expect(event).to.equal("data");
    });

    const resume = sinon.spy();

    new DataHandler(
      {
        stream: {
          prependListener,
          resume,
        },
      } as any,
      {} as any
    );

    expect(prependListener.calledOnce).to.be.true;
    expect(resume.calledOnce).to.be.true;
    expect(resume.calledAfter(prependListener)).to.be.true;
  });

  it("recovers instead of crashing on a reply that overflows the parser stack | https://github.com/redis/ioredis/issues/2108", () => {
    let dataListener: (data: Buffer) => void;
    const prependListener = (
      event: string,
      handler: (data: Buffer) => void
    ) => {
      dataListener = handler;
    };

    const recoverFromFatalError = sinon.spy();

    new DataHandler(
      {
        stream: {
          prependListener,
          resume: sinon.spy(),
        },
        recoverFromFatalError,
      } as any,
      {} as any
    );

    // a RESP2 reply nesting arrays deeply enough to overflow the parser's
    // call stack (redis-parser recurses once per level of nesting, with no
    // depth limit) - this is what a malicious/compromised server or an
    // on-path attacker could send in place of a real reply
    let deeplyNested = ":1\r\n";
    for (let i = 0; i < 50000; i++) {
      deeplyNested = "*1\r\n" + deeplyNested;
    }

    expect(() => dataListener(Buffer.from(deeplyNested))).to.not.throw();
    expect(recoverFromFatalError.calledOnce).to.be.true;

    const [commandError, err, options] = recoverFromFatalError.firstCall.args;
    expect(commandError).to.be.instanceOf(Error);
    expect(err).to.be.instanceOf(Error);
    expect(commandError.message).to.include(
      "Unhandled error while parsing the Redis reply"
    );
    expect(options).to.deep.equal({ offlineQueue: false });
  });
});
