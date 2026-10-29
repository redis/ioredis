import { expect } from "chai";
import * as sinon from "sinon";
import Redis from "../../../../lib/Redis";
import SentinelConnector from "../../../../lib/connectors/SentinelConnector";
import { FailoverDetector } from "../../../../lib/connectors/SentinelConnector/FailoverDetector";

describe("FailoverDetector", () => {
  it("should clean up subscriptions only once after failover", async () => {
    const address = { host: "127.0.0.1", port: 27379 };
    const client = new Redis({ lazyConnect: true });
    const connector = new SentinelConnector({
      sentinels: [address],
      name: "master",
    });
    const detector = new FailoverDetector(connector, [{ address, client }]);
    const disconnect = sinon.spy(client, "disconnect");
    const subscribe = sinon.stub(client, "subscribe").resolves(1);
    const close = sinon.stub(connector, "disconnect").callsFake(() => {
      detector.cleanup();
    });

    try {
      await detector.subscribe();
      client.emit("message", "+switch-master", "master changed");
      expect(close.calledOnce).to.equal(true);
      expect(disconnect.calledOnce).to.equal(true);

      // The owning stream may close after explicit failover cleanup.
      detector.cleanup();
      client.emit("message", "+switch-master", "master changed again");
      expect(close.calledOnce).to.equal(true);
      expect(disconnect.calledOnce).to.equal(true);
    } finally {
      close.restore();
      subscribe.restore();
      disconnect.restore();
    }
  });

  it("should handle error events on failover detector sentinel clients", async () => {
    const subscribeStub = sinon
      .stub(Redis.prototype, "subscribe")
      .resolves(1 as any);
    try {
      const address = { host: "127.0.0.1", port: 27379 };
      const connector = new SentinelConnector({
        sentinels: [address],
        name: "master",
        failoverDetector: true,
        sentinelMaxConnections: 10,
      });
      const stream = new (require("events").EventEmitter)();
      (connector as any).stream = stream;

      await (connector as any).initFailoverDetector();
      const detector = (connector as any).failoverDetector;
      expect(detector).to.be.an.instanceOf(FailoverDetector);
      const client = (detector as any).sentinels[0].client;

      expect(() => {
        client.emit("error", new Error("connection reset by peer"));
      }).to.not.throw();

      detector.cleanup();
    } finally {
      subscribeStub.restore();
    }
  });
});
