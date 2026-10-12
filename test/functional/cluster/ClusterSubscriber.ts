import ConnectionPool from "../../../lib/cluster/ConnectionPool";
import ClusterSubscriber from "../../../lib/cluster/ClusterSubscriber";
import { EventEmitter } from "events";
import MockServer from "../../helpers/mock_server";
import { expect } from "chai";
import * as sinon from "sinon";
import { AddressInfo, createServer, Socket } from "net";

describe("ClusterSubscriber", () => {
  it("uses the node's connectTimeout when the TLS handshake stalls", async () => {
    let socket: Socket;
    // Accept TCP connections without replying to the TLS handshake.
    const server = createServer((connection) => {
      socket = connection;
    });
    const pool = new ConnectionPool({
      connectTimeout: 50,
      tls: { rejectUnauthorized: false },
    });
    const subscriber = new ClusterSubscriber(pool, new EventEmitter());

    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const { port } = server.address() as AddressInfo;
      pool.findOrCreate({ host: "127.0.0.1", port });
      subscriber.start();

      const client = subscriber.getInstance();
      expect(client.options.connectTimeout).to.equal(50);

      const errors: Error[] = [];
      client.on("error", (error) => errors.push(error));
      const connectionError = await client.connect().then(
        () => undefined,
        (error) => error
      );

      expect(connectionError).to.be.instanceOf(Error);
      expect(errors).to.have.lengthOf(1);
      expect(errors[0]).to.have.property("code", "ETIMEDOUT");
    } finally {
      subscriber.stop();
      pool.reset([]);
      socket?.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("inherits the replacement node's connectTimeout, including zero", () => {
    const pool = new ConnectionPool({ connectTimeout: 50 });
    const subscriber = new ClusterSubscriber(pool, new EventEmitter());
    const node = { host: "127.0.0.1", port: 30000 };

    try {
      pool.findOrCreate(node);
      subscriber.start();
      const original = subscriber.getInstance();

      pool.recreate({ ...node, connectTimeout: 0 });
      const replacement = subscriber.getInstance();

      expect(replacement).not.to.equal(original);
      expect(replacement.options.connectTimeout).to.equal(0);
    } finally {
      subscriber.stop();
      pool.reset([]);
    }
  });

  it("selects from all node roles by default", () => {
    const pool = new ConnectionPool({});
    const getNodes = sinon.spy(pool, "getNodes");
    const subscriber = new ClusterSubscriber(pool, new EventEmitter());

    subscriber.start();
    expect(subscriber.getInstance()).to.eql(null);

    pool.findOrCreate({ host: "127.0.0.1", port: 30000, readOnly: true }, true);

    expect(getNodes.calledWith("all")).to.eql(true);
    expect(subscriber.getInstance().options.port).to.eql(30000);

    subscriber.stop();
    pool.reset([]);
    sinon.restore();
  });

  it("selects only master nodes when configured", () => {
    const pool = new ConnectionPool({});
    const subscriber = new ClusterSubscriber(
      pool,
      new EventEmitter(),
      "master"
    );

    pool.findOrCreate({ host: "127.0.0.1", port: 30000 });
    pool.findOrCreate({ host: "127.0.0.1", port: 30001 }, true);

    subscriber.start();

    expect(subscriber.getInstance().options.port).to.eql(30000);

    subscriber.stop();
    pool.reset([]);
  });

  it("selects only slave nodes when configured", () => {
    const pool = new ConnectionPool({});
    const subscriber = new ClusterSubscriber(pool, new EventEmitter(), "slave");

    pool.findOrCreate({ host: "127.0.0.1", port: 30000 });
    pool.findOrCreate({ host: "127.0.0.1", port: 30001 }, true);

    subscriber.start();

    expect(subscriber.getInstance().options.port).to.eql(30001);

    subscriber.stop();
    pool.reset([]);
  });

  it("waits for topology discovery to finish before selecting a role", () => {
    const pool = new ConnectionPool({});
    const subscriber = new ClusterSubscriber(pool, new EventEmitter(), "slave");

    pool.findOrCreate({ host: "127.0.0.1", port: 30000 });
    subscriber.start();

    expect(subscriber.getInstance()).to.eql(null);

    pool.findOrCreate({ host: "127.0.0.1", port: 30001 }, true);
    expect(subscriber.getInstance()).to.eql(null);

    subscriber.selectSubscriberIfNeeded();

    expect(subscriber.getInstance().options.port).to.eql(30001);

    subscriber.stop();
    pool.reset([]);
  });

  it("selects an existing node after it becomes eligible", () => {
    const pool = new ConnectionPool({});
    const subscriber = new ClusterSubscriber(pool, new EventEmitter(), "slave");

    const node = pool.findOrCreate({ host: "127.0.0.1", port: 30000 });
    sinon.stub(node, "readonly").resolves("OK");
    subscriber.start();

    expect(subscriber.getInstance()).to.eql(null);

    pool.findOrCreate({ host: "127.0.0.1", port: 30000 }, true);
    subscriber.selectSubscriberIfNeeded();

    expect(subscriber.getInstance().options.port).to.eql(30000);

    subscriber.stop();
    pool.reset([]);
    sinon.restore();
  });

  (
    [
      {
        subscriberNodeRole: "master",
        nextNodeRole: "slave",
      },
      {
        subscriberNodeRole: "slave",
        nextNodeRole: "master",
      },
    ] as const
  ).forEach(({ subscriberNodeRole, nextNodeRole }) => {
    it(`keeps the current ${subscriberNodeRole} subscriber when its node becomes a ${nextNodeRole}`, () => {
      const pool = new ConnectionPool({});
      const subscriber = new ClusterSubscriber(
        pool,
        new EventEmitter(),
        subscriberNodeRole
      );

      const node = pool.findOrCreate(
        { host: "127.0.0.1", port: 30000 },
        subscriberNodeRole === "slave"
      );
      sinon
        .stub(node, nextNodeRole === "slave" ? "readonly" : "readwrite")
        .resolves("OK");

      subscriber.start();
      const original = subscriber.getInstance();

      pool.findOrCreate(
        { host: "127.0.0.1", port: 30000 },
        nextNodeRole === "slave"
      );

      expect(subscriber.getInstance()).to.equal(original);

      subscriber.stop();
      pool.reset([]);
      sinon.restore();
    });
  });

  it("cleans up subscribers when selecting a new one", async () => {
    const pool = new ConnectionPool({});
    const subscriber = new ClusterSubscriber(pool, new EventEmitter());

    let rejectSubscribes = false;
    const server = new MockServer(30000, (argv) => {
      if (rejectSubscribes && argv[0] === "subscribe") {
        return new Error("Failed to subscribe");
      }
      return "OK";
    });

    pool.findOrCreate({ host: "127.0.0.1", port: 30000 });

    subscriber.start();
    await subscriber.getInstance().subscribe("foo");
    rejectSubscribes = true;

    subscriber.start();
    await subscriber.getInstance().echo("hello");

    subscriber.start();
    await subscriber.getInstance().echo("hello");

    expect(server.getAllClients()).to.have.lengthOf(1);
    subscriber.stop();
    pool.reset([]);
  });

  it("sets correct connection name when connectionName is set", async () => {
    const pool = new ConnectionPool({ connectionName: "test" });
    const subscriber = new ClusterSubscriber(pool, new EventEmitter());

    const clientNames = [];
    new MockServer(30000, (argv) => {
      if (argv[0] === "client" && argv[1] === "setname") {
        clientNames.push(argv[2]);
      }
    });

    pool.findOrCreate({ host: "127.0.0.1", port: 30000 });

    subscriber.start();
    await subscriber.getInstance().subscribe("foo");
    subscriber.stop();
    pool.reset([]);

    expect(clientNames).to.eql(["ioredis-cluster(subscriber):test"]);
  });

  it("sets correct connection name when connectionName is absent", async () => {
    const pool = new ConnectionPool({});
    const subscriber = new ClusterSubscriber(pool, new EventEmitter());

    const clientNames = [];
    new MockServer(30000, (argv) => {
      if (argv[0] === "client" && argv[1] === "setname") {
        clientNames.push(argv[2]);
      }
    });

    pool.findOrCreate({ host: "127.0.0.1", port: 30000 });

    subscriber.start();
    await subscriber.getInstance().subscribe("foo");
    subscriber.stop();
    pool.reset([]);

    expect(clientNames).to.eql(["ioredis-cluster(subscriber)"]);
  });
});
