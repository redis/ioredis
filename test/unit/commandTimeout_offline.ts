import { expect } from "chai";
import Redis from "../../lib/Redis";
import AbstractConnector from "../../lib/connectors/AbstractConnector";
import { NetStream } from "../../lib/types";

/**
 * A connector whose connect() never settles, so commands stay in the
 * offline queue and are never written to a socket.
 */
class HangingConnector extends AbstractConnector {
  constructor(_options: unknown) {
    super(2000);
  }

  connect(): Promise<NetStream> {
    this.connecting = true;
    return new Promise(() => {});
  }
}

describe("commandTimeout and the offline queue (#2130)", function () {
  it("does not time out a command that is still waiting in the offline queue", async function () {
    const redis = new Redis({
      Connector: HangingConnector,
      lazyConnect: true,
      commandTimeout: 50,
      retryStrategy() {
        return null;
      },
    });

    try {
      const pending = redis.get("foo");
      // Let sendCommand queue the command, then wait past commandTimeout.
      await new Promise((resolve) => setTimeout(resolve, 120));
      expect((redis as any).offlineQueue.length).to.eql(1);

      const state = await Promise.race([
        pending.then(
          () => "settled",
          () => "settled"
        ),
        Promise.resolve("pending"),
      ]);
      expect(state).to.equal("pending");
    } finally {
      redis.disconnect();
    }
  });
});
