import { expect } from "chai";
import { Socket } from "net";
import { Cluster } from "../../../lib";
import MockServer, {
  MockServerHandler,
  pushFrame,
} from "../../helpers/mock_server";

describe("cluster: sharded unsubscribe channel identity", () => {
  for (const protocol of [2, 3] as const) {
    for (const [name, channel, removed] of [
      ["distinct buffers", Buffer.from("news{tag}"), Buffer.from("news{tag}")],
      ["string and buffer", "news{tag}", Buffer.from("news{tag}")],
      ["buffer and string", Buffer.from("news{tag}"), "news{tag}"],
    ] as const) {
      it(`does not restore an unsubscribed channel after moving slots (${name}, RESP${protocol})`, async () => {
        let ownerPort = 30001;
        const restored: string[] = [];
        const subscriptions = new WeakMap<Socket, Set<string>>();
        let controlRestored: () => void;
        const replayed = new Promise<void>((resolve) => {
          controlRestored = resolve;
        });
        const handler: MockServerHandler = (argv, socket, flags) => {
          if (argv[0] === "cluster" && argv[1] === "SLOTS") {
            return [[0, 16383, ["127.0.0.1", ownerPort]]];
          }
          if (argv[0] === "ssubscribe" || argv[0] === "sunsubscribe") {
            if (socket.localPort === 30002 && argv[0] === "ssubscribe") {
              restored.push(...argv.slice(1));
              if (argv.includes("control{tag}")) controlRestored();
            }
            const channels = subscriptions.get(socket) ?? new Set<string>();
            subscriptions.set(socket, channels);
            for (const channel of argv.slice(1)) {
              if (argv[0] === "ssubscribe") channels.add(channel);
              else channels.delete(channel);
              target.write(
                socket,
                protocol === 3
                  ? pushFrame(argv[0], channel, channels.size)
                  : [argv[0], channel, channels.size]
              );
            }
            flags.hang = true;
          }
        };
        new MockServer(30001, handler);
        const target = new MockServer(30002, handler);
        const cluster = new Cluster([{ port: 30001 }], {
          shardedSubscribers: true,
          redisOptions: { protocol },
        });

        try {
          expect(await cluster.ssubscribe(channel)).to.equal(1);
          expect(await cluster.ssubscribe("control{tag}")).to.equal(2);
          expect(await cluster.sunsubscribe(removed)).to.equal(1);

          ownerPort = 30002;
          await new Promise<void>((resolve, reject) => {
            cluster.refreshSlotsCache((err) => (err ? reject(err) : resolve()));
          });
          await replayed;
          expect(restored).to.eql(["control{tag}"]);
        } finally {
          cluster.disconnect();
        }
      });
    }
  }
});
