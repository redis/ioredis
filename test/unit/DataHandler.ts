import { expect } from "chai";
import Deque = require("denque");
import { EventEmitter } from "events";
import * as sinon from "sinon";
import Command from "../../lib/Command";
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

  it("parses replies with the internal RESP decoder", async () => {
    const setup = setupDataHandler();
    const command = new Command("ping", [], { replyEncoding: "utf8" });
    setup.redis.commandQueue.push({ command, select: 0 });

    setup.write("+PONG\r\n");

    expect(await command.promise).to.equal("PONG");
  });

  it("honors stringNumbers with the internal RESP decoder", async () => {
    const setup = setupDataHandler({ stringNumbers: true });
    const command = new Command("dbsize", [], { replyEncoding: "utf8" });
    setup.redis.commandQueue.push({ command, select: 0 });

    setup.write(":123\r\n");

    expect(await command.promise).to.equal("123");
  });

  it("routes Redis errors as ReplyError-compatible errors", async () => {
    const setup = setupDataHandler();
    const command = new Command("get", ["key"], { replyEncoding: "utf8" });
    setup.redis.commandQueue.push({ command, select: 0 });

    setup.write("-ERR test error\r\n");

    try {
      await command.promise;
      expect.fail("Expected command to reject");
    } catch (err) {
      expect(err.message).to.equal("ERR test error");
      expect(err.name).to.equal("ReplyError");
    }
  });

  it("does not shift the command queue for push frames", async () => {
    const setup = setupDataHandler();
    const command = new Command("get", ["key"], { replyEncoding: "utf8" });
    setup.redis.commandQueue.push({ command, select: 0 });

    setup.write(
      ">3\r\n$7\r\nmessage\r\n$7\r\nchannel\r\n$5\r\nhello\r\n+VALUE\r\n"
    );

    expect(await command.promise).to.equal("VALUE");
  });

  it("handles RESP3 subscribe acknowledgements as push frames", async () => {
    const setup = setupDataHandler();
    const command = new Command("subscribe", ["channel"], {
      replyEncoding: "utf8",
    });
    setup.redis.commandQueue.push({ command, select: 0 });

    setup.write(">3\r\n$9\r\nsubscribe\r\n$7\r\nchannel\r\n:1\r\n");

    expect(await command.promise).to.equal(1);
    expect(setup.redis.condition.subscriber.channels("subscribe")).to.eql([
      "channel",
    ]);
  });

  it("ignores empty RESP3 push frames without firing fatal error", () => {
    const setup = setupDataHandler();
    const command = new Command("ping", [], { replyEncoding: "utf8" });
    setup.redis.commandQueue.push({ command, select: 0 });

    setup.write(">0\r\n");

    expect(setup.redis.recoverFromFatalError.called).to.be.false;
    expect(setup.redis.commandQueue.length).to.equal(1);
  });
});

function setupDataHandler(parserOptions = { stringNumbers: false }) {
  let dataHandler: (data: Buffer) => void;
  const redis = new EventEmitter() as any;
  redis.stream = {
    prependListener: sinon.spy(
      (event: string, handler: (data: Buffer) => void) => {
        expect(event).to.equal("data");
        dataHandler = handler;
      }
    ),
    resume: sinon.spy(),
  };
  redis.status = "ready";
  redis.condition = {
    select: 0,
    subscriber: false,
  };
  redis.commandQueue = new Deque();
  redis.disconnect = sinon.spy();
  redis.recoverFromFatalError = sinon.spy();
  redis.handleReconnection = sinon.spy((err: Error, item) => {
    item.command.reject(err);
  });

  new DataHandler(redis, parserOptions);

  return {
    redis,
    write(data: string) {
      dataHandler(Buffer.from(data));
    },
  };
}
