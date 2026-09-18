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
});
