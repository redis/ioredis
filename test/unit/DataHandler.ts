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

  it("does not shift the command queue for server-initiated RESP3 sunsubscribe pushes", async () => {
    const setup = setupDataHandler();
    const error = sinon.spy();
    const moved = sinon.spy();
    setup.redis.on("error", error);
    setup.redis.on("moved", moved);

    const subscribe = new Command("ssubscribe", ["channel"], {
      replyEncoding: "utf8",
    });
    setup.redis.commandQueue.push({ command: subscribe, select: 0 });
    setup.write(">3\r\n$10\r\nssubscribe\r\n$7\r\nchannel\r\n:1\r\n");
    expect(await subscribe.promise).to.equal(1);

    const command = new Command("get", ["key"], { replyEncoding: "utf8" });
    setup.redis.commandQueue.push({ command, select: 0 });
    setup.write(
      ">3\r\n$12\r\nsunsubscribe\r\n$7\r\nchannel\r\n:0\r\n+VALUE\r\n"
    );

    expect(await command.promise).to.equal("VALUE");
    expect(setup.redis.condition.subscriber).to.equal(false);
    expect(setup.redis.commandQueue.length).to.equal(0);
    expect(error.called).to.be.false;
    expect(moved.calledOnce).to.be.true;
  });

  it("resolves queued RESP3 sunsubscribe commands", async () => {
    const setup = setupDataHandler();
    const moved = sinon.spy();
    setup.redis.on("moved", moved);

    const subscribe = new Command("ssubscribe", ["channel"], {
      replyEncoding: "utf8",
    });
    setup.redis.commandQueue.push({ command: subscribe, select: 0 });
    setup.write(">3\r\n$10\r\nssubscribe\r\n$7\r\nchannel\r\n:1\r\n");
    expect(await subscribe.promise).to.equal(1);

    const unsubscribe = new Command("sunsubscribe", ["channel"], {
      replyEncoding: "utf8",
    });
    setup.redis.commandQueue.push({ command: unsubscribe, select: 0 });
    setup.write(">3\r\n$12\r\nsunsubscribe\r\n$7\r\nchannel\r\n:0\r\n");

    expect(await unsubscribe.promise).to.equal(0);
    expect(setup.redis.condition.subscriber).to.equal(false);
    expect(setup.redis.commandQueue.length).to.equal(0);
    expect(moved.called).to.be.false;
  });

  it("resolves uppercase unsubscribe commands without desyncing the queue", async () => {
    const setup = setupDataHandler();
    const error = sinon.spy();
    setup.redis.on("error", error);

    const subscribe = new Command("subscribe", ["channel"], {
      replyEncoding: "utf8",
    });
    setup.redis.commandQueue.push({ command: subscribe, select: 0 });
    setup.write(">3\r\n$9\r\nsubscribe\r\n$7\r\nchannel\r\n:1\r\n");
    expect(await subscribe.promise).to.equal(1);

    const unsubscribe = new Command("UNSUBSCRIBE", ["channel"], {
      replyEncoding: "utf8",
    });
    setup.redis.commandQueue.push({ command: unsubscribe, select: 0 });
    const command = new Command("get", ["key"], { replyEncoding: "utf8" });
    setup.redis.commandQueue.push({ command, select: 0 });

    setup.write(">3\r\n$11\r\nunsubscribe\r\n$7\r\nchannel\r\n:0\r\n+VALUE\r\n");

    expect(await unsubscribe.promise).to.equal(0);
    expect(await command.promise).to.equal("VALUE");
    expect(setup.redis.commandQueue.length).to.equal(0);
    expect(error.called).to.be.false;
  });

  it("settles ssubscribe commands on MOVED instead of leaving them pending", async () => {
    const setup = setupDataHandler();
    const moved = sinon.spy();
    setup.redis.on("moved", moved);

    const command = new Command("ssubscribe", ["channel"], {
      replyEncoding: "utf8",
    });
    setup.redis.commandQueue.push({ command, select: 0 });

    setup.write("-MOVED 1234 127.0.0.1:30002\r\n");

    expect(moved.calledOnce).to.be.true;
    expect(setup.redis.handleReconnection.calledOnce).to.be.true;
    expect(setup.redis.handleReconnection.firstCall.args[1].command).to.equal(
      command
    );

    try {
      await command.promise;
      expect.fail("Expected command to reject");
    } catch (err) {
      expect(err.message).to.equal("MOVED 1234 127.0.0.1:30002");
    }
  });

  it("does not emit moved for non-MOVED ssubscribe errors", async () => {
    const setup = setupDataHandler();
    const moved = sinon.spy();
    setup.redis.on("moved", moved);

    const command = new Command("ssubscribe", ["channel"], {
      replyEncoding: "utf8",
    });
    setup.redis.commandQueue.push({ command, select: 0 });

    setup.write("-ERR keys moved around\r\n");

    expect(moved.called).to.be.false;
    expect(setup.redis.handleReconnection.calledOnce).to.be.true;

    try {
      await command.promise;
      expect.fail("Expected command to reject");
    } catch (err) {
      expect(err.message).to.equal("ERR keys moved around");
    }
  });

  it("contains user listener exceptions without killing the connection", async () => {
    const setup = setupDataHandler();
    const listenerError = new Error("listener boom");

    const subscribe = new Command("subscribe", ["channel"], {
      replyEncoding: "utf8",
    });
    setup.redis.commandQueue.push({ command: subscribe, select: 0 });
    setup.write(">3\r\n$9\r\nsubscribe\r\n$7\r\nchannel\r\n:1\r\n");
    expect(await subscribe.promise).to.equal(1);

    setup.redis.on("message", () => {
      throw listenerError;
    });

    const command = new Command("get", ["key"], { replyEncoding: "utf8" });
    setup.redis.commandQueue.push({ command, select: 0 });

    const nextTick = sinon.stub(process, "nextTick");
    try {
      setup.write(
        ">3\r\n$7\r\nmessage\r\n$7\r\nchannel\r\n$5\r\nhello\r\n+VALUE\r\n"
      );
    } finally {
      nextTick.restore();
    }

    // The reply following the throwing listener is still parsed and resolved.
    expect(await command.promise).to.equal("VALUE");
    expect(setup.redis.recoverFromFatalError.called).to.be.false;

    // The listener exception is rethrown asynchronously as an uncaught
    // exception instead of being swallowed or misreported as a parser error.
    expect(nextTick.calledOnce).to.be.true;
    const rethrow = nextTick.firstCall.args[0];
    expect(rethrow).to.throw(listenerError);
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
