import { expect } from "chai";
import Redis, { Cluster } from "../../lib";

// Pipelined commands that get their own MOVED / ASK / TRYAGAIN reply while
// other commands in the same batch succeed (#2075). Each test moves real
// slots with CLUSTER SETSLOT + MIGRATE and puts them back afterwards.

const masters = [3000, 3001, 3002];
const allNodes = [3000, 3001, 3002, 3003, 3004, 3005];

describe("cluster:pipeline redirection", function () {
  this.timeout(30000);

  let admin: Record<number, Redis>;
  let ids: Record<number, string>;
  let borrowed: Array<{ slot: number; home: number }>;

  before(async () => {
    admin = {};
    ids = {};
    for (const port of allNodes) {
      admin[port] = new Redis(port, "127.0.0.1");
    }
    for (const port of masters) {
      ids[port] = (await admin[port].cluster("MYID")) as string;
    }
  });

  after(() => {
    for (const port of allNodes) admin[port].disconnect();
  });

  beforeEach(() => {
    borrowed = [];
  });

  afterEach(async () => {
    for (const { slot, home } of borrowed.reverse()) {
      await restoreSlot(slot, home);
    }
  });

  async function ownerOf(slot: number, port = masters[0]): Promise<number> {
    const ranges = (await admin[port].cluster("SLOTS")) as any[];
    for (const range of ranges) {
      if (slot >= range[0] && slot <= range[1]) return Number(range[2][1]);
    }
    throw new Error(`slot ${slot} has no owner`);
  }

  async function keysOf(port: number, slot: number): Promise<string[]> {
    return (await admin[port].cluster("GETKEYSINSLOT", slot, 100)) as string[];
  }

  /** Marks the slot as migrating and moves only the given keys. */
  async function startMigration(
    slot: number,
    from: number,
    to: number,
    keys: string[]
  ) {
    borrowed.push({ slot, home: from });
    await admin[to].cluster("SETSLOT", slot, "IMPORTING", ids[from]);
    await admin[from].cluster("SETSLOT", slot, "MIGRATING", ids[to]);
    for (const key of keys) {
      await admin[from].migrate("127.0.0.1", to, key, 0, 5000);
    }
  }

  async function finishMigration(slot: number, from: number, to: number) {
    for (let keys: string[]; (keys = await keysOf(from, slot)).length; ) {
      for (const key of keys) {
        await admin[from].migrate("127.0.0.1", to, key, 0, 5000);
      }
    }
    // SETSLOT NODE on the importing node bumps its config epoch. If that
    // node has not yet heard of another node's newer epoch (CLUSTER
    // BUMPEPOCH in an earlier test, or the previous move), both end up with
    // the same epoch, and resolving that collision can hand the slot back
    // to the old owner. Wait until every node knows the current epoch.
    await untilEpochsAgree();
    // The new owner first, as the CLUSTER SETSLOT documentation advises.
    for (const port of [to, ...masters.filter((port) => port !== to)]) {
      await admin[port].cluster("SETSLOT", slot, "NODE", ids[to]);
    }
    await untilAllNodesSee(slot, to);
  }

  async function untilEpochsAgree() {
    const deadline = Date.now() + 10000;
    for (;;) {
      const epochs = await Promise.all(
        allNodes.map(async (port) => {
          const info = (await admin[port].cluster("INFO")) as string;
          return /cluster_current_epoch:(\d+)/.exec(info)![1];
        })
      );
      if (epochs.every((epoch) => epoch === epochs[0])) return;
      if (Date.now() > deadline) {
        throw new Error(`nodes never agreed on the epoch: ${epochs}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /** Replicas learn a new owner by gossip; wait so no node serves a stale map. */
  async function untilAllNodesSee(slot: number, owner: number) {
    const deadline = Date.now() + 10000;
    for (const port of allNodes) {
      while ((await ownerOf(slot, port)) !== owner) {
        if (Date.now() > deadline) {
          throw new Error(`node ${port} never saw ${owner} own slot ${slot}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }

  async function moveSlot(slot: number, from: number, to: number) {
    await startMigration(slot, from, to, []);
    await finishMigration(slot, from, to);
  }

  async function transfer(slot: number, from: number, to: number) {
    await admin[to].cluster("SETSLOT", slot, "IMPORTING", ids[from]);
    await admin[from].cluster("SETSLOT", slot, "MIGRATING", ids[to]);
    await finishMigration(slot, from, to);
  }

  /** Works from any state a test can leave behind, including half migrated. */
  async function restoreSlot(slot: number, home: number) {
    for (const port of masters) {
      await admin[port].cluster("SETSLOT", slot, "STABLE");
    }
    let owner = await ownerOf(slot, home);
    // A half migration leaves keys on a node that does not own the slot.
    // That node refuses to MIGRATE them, so hand it the slot first.
    for (const port of masters) {
      if (port !== owner && (await keysOf(port, slot)).length) {
        await transfer(slot, owner, port);
        owner = port;
      }
    }
    if (owner !== home) {
      await transfer(slot, owner, home);
    }
  }

  /** Distinct hash tags in distinct slots, all owned by `port`. */
  async function tagsOn(port: number, count: number, prefix: string) {
    const found: Array<{ tag: string; slot: number }> = [];
    for (let i = 0; found.length < count; i++) {
      if (i > 2000) throw new Error(`could not find ${count} tags on ${port}`);
      const tag = `${prefix}-${Date.now()}-${i}`;
      const slot = Number(await admin[port].cluster("KEYSLOT", tag));
      if (
        !found.some((f) => f.slot === slot) &&
        (await ownerOf(slot)) === port
      ) {
        found.push({ tag, slot });
      }
    }
    return found;
  }

  function slotOwnerSeenBy(cluster: Cluster, slot: number) {
    return (cluster as any).slots[slot]?.[0];
  }

  const [source, target] = masters;

  [
    { name: "autopipelined", enableAutoPipelining: true },
    { name: "explicit pipeline", enableAutoPipelining: false },
  ].forEach(({ name, enableAutoPipelining }) => {
    it(`${name}: applies a moved write once on the new owner and learns the route`, async () => {
      const [stay, move] = await tagsOn(source, 2, "redir-write");
      const cluster = new Cluster([{ host: "127.0.0.1", port: source }], {
        enableAutoPipelining,
      });
      try {
        await cluster.get(`{${stay.tag}}`);
        await moveSlot(move.slot, source, target);

        const send = () =>
          enableAutoPipelining
            ? Promise.all([
                cluster.incr(`{${stay.tag}}n`),
                cluster.incr(`{${move.tag}}n`),
              ])
            : cluster
                .pipeline()
                .incr(`{${stay.tag}}n`)
                .incr(`{${move.tag}}n`)
                .exec()
                .then((result) => result.map(([err, value]) => err || value));

        expect(await send()).to.eql([1, 1]);
        expect(await admin[source].get(`{${stay.tag}}n`)).to.eql("1");
        expect(await admin[target].get(`{${move.tag}}n`)).to.eql("1");
        expect(slotOwnerSeenBy(cluster, move.slot)).to.eql(
          `127.0.0.1:${target}`
        );
      } finally {
        cluster.disconnect();
      }
    });
  });

  it("does not fail a read whose slot did not move", async () => {
    const [stay, move] = await tagsOn(source, 2, "redir-read");
    await admin[source].set(`{${stay.tag}}`, "stays");
    await admin[source].set(`{${move.tag}}`, "moves");
    const cluster = new Cluster([{ host: "127.0.0.1", port: source }], {
      enableAutoPipelining: true,
    });
    try {
      await cluster.get(`{${stay.tag}}`);
      await moveSlot(move.slot, source, target);

      const results = await Promise.allSettled([
        cluster.get(`{${stay.tag}}`),
        cluster.get(`{${move.tag}}`),
      ]);
      expect(results).to.eql([
        { status: "fulfilled", value: "stays" },
        { status: "fulfilled", value: "moves" },
      ]);
    } finally {
      cluster.disconnect();
    }
  });

  it("follows ASK for one command during a migration without changing the route", async () => {
    const [stay, migrating] = await tagsOn(source, 2, "redir-ask");
    await admin[source].set(`{${migrating.tag}}moved`, "here");
    await admin[source].set(`{${migrating.tag}}kept`, "0");
    const cluster = new Cluster([{ host: "127.0.0.1", port: source }], {
      enableAutoPipelining: true,
    });
    try {
      await cluster.get(`{${stay.tag}}`);
      await startMigration(migrating.slot, source, target, [
        `{${migrating.tag}}moved`,
      ]);

      expect(
        await Promise.all([
          cluster.incr(`{${stay.tag}}n`),
          cluster.get(`{${migrating.tag}}moved`),
          cluster.incr(`{${migrating.tag}}kept`),
        ])
      ).to.eql([1, "here", 1]);
      expect(await admin[source].get(`{${stay.tag}}n`)).to.eql("1");
      expect(slotOwnerSeenBy(cluster, migrating.slot)).to.eql(
        `127.0.0.1:${source}`
      );
    } finally {
      cluster.disconnect();
    }
  });

  it("still retries a MULTI/EXEC on a moved slot as one transaction", async () => {
    const [stay, move] = await tagsOn(source, 2, "redir-multi");
    const cluster = new Cluster([{ host: "127.0.0.1", port: source }]);
    try {
      await cluster.get(`{${stay.tag}}`);
      await moveSlot(move.slot, source, target);

      const result = await cluster
        .multi()
        .incr(`{${move.tag}}a`)
        .incr(`{${move.tag}}b`)
        .exec();
      expect(result).to.eql([
        [null, 1],
        [null, 1],
      ]);
      expect(
        await admin[target].mget(`{${move.tag}}a`, `{${move.tag}}b`)
      ).to.eql(["1", "1"]);
    } finally {
      cluster.disconnect();
    }
  });
});
