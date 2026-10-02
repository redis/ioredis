import * as calculateSlot from "../../../lib/utils/calculateSlot";
import MockServer from "../../helpers/mock_server";
import { expect } from "chai";
import { Cluster } from "../../../lib";
import * as sinon from "sinon";

describe("cluster:pipeline", () => {
  it("should throw when not all keys in a pipeline command belong to the same slot", (done) => {
    const slotTable = [
      [0, 12181, ["127.0.0.1", 30001]],
      [12182, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
    cluster
      .pipeline()
      .set("foo", "bar")
      .mget("foo1", "foo2")
      .exec()
      .catch(function (err) {
        expect(err.message).to.match(
          /All the keys in a pipeline command should belong to the same slot/
        );
        cluster.disconnect();
        done();
      });
  });

  it("should throw when not all keys in different pipeline commands belong to the same allocation group", (done) => {
    const slotTable = [
      [0, 12181, ["127.0.0.1", 30001]],
      [12182, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
    cluster
      .pipeline()
      .set("foo1", "bar")
      .get("foo2")
      .exec()
      .catch(function (err) {
        expect(err.message).to.match(
          /All keys in the pipeline should belong to the same slots allocation group/
        );
        cluster.disconnect();
        done();
      });
  });

  it("should auto redirect commands on MOVED", (done) => {
    let moved = false;
    const slotTable = [
      [0, 12181, ["127.0.0.1", 30001]],
      [12182, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        return "bar";
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[1] === "foo") {
        if (argv[0] === "set") {
          expect(moved).to.eql(false);
          moved = true;
        }
        return new Error("MOVED " + calculateSlot("foo") + " 127.0.0.1:30001");
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
    cluster
      .pipeline()
      .get("foo")
      .set("foo", "bar")
      .exec(function (err, result) {
        expect(err).to.eql(null);
        expect(result[0]).to.eql([null, "bar"]);
        expect(result[1]).to.eql([null, "OK"]);
        cluster.disconnect();
        done();
      });
  });

  it("should time out when a MOVED pipeline retry stops responding", async () => {
    const slotTable = [
      [0, 12181, ["127.0.0.1", 30001]],
      [12182, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv, _socket, flags) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        flags.hang = true;
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        return new Error("MOVED " + calculateSlot("foo") + " 127.0.0.1:30001");
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      redisOptions: {
        commandTimeout: 50,
      },
    });

    try {
      const result = await Promise.race([
        cluster.pipeline().get("foo").exec(),
        new Promise<never>((_resolve, reject) => {
          setTimeout(
            () => reject(new Error("Pipeline retry did not time out")),
            500
          );
        }),
      ]);

      expect(result[0][0]?.message).to.equal("Command timed out");
    } finally {
      cluster.disconnect();
    }
  });

  it("should auto redirect commands on ASK", (done) => {
    let asked = false;
    const slotTable = [
      [0, 12181, ["127.0.0.1", 30001]],
      [12182, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "asking") {
        asked = true;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        expect(asked).to.eql(true);
        return "bar";
      }
      if (argv[0] !== "asking") {
        asked = false;
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[1] === "foo") {
        return new Error("ASK " + calculateSlot("foo") + " 127.0.0.1:30001");
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
    cluster
      .pipeline()
      .get("foo")
      .set("foo", "bar")
      .exec(function (err, result) {
        expect(err).to.eql(null);
        expect(result[0]).to.eql([null, "bar"]);
        expect(result[1]).to.eql([null, "OK"]);
        cluster.disconnect();
        done();
      });
  });

  it("should retry the command on TRYAGAIN", (done) => {
    let times = 0;
    const slotTable = [[0, 16383, ["127.0.0.1", 30001]]];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[1] === "foo") {
        if (times++ < 2) {
          return new Error(
            "TRYAGAIN Multiple keys request during rehashing of slot"
          );
        }
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      retryDelayOnTryAgain: 1,
    });
    cluster
      .pipeline()
      .get("foo")
      .set("foo", "bar")
      .exec(function (err, result) {
        expect(result[0][1]).to.eql("OK");
        expect(result[1][1]).to.eql("OK");
        cluster.disconnect();
        done();
      });
  });

  it("should redirect only the moved command when a non-readonly command is successful", (done) => {
    const slotTable = [
      [0, 12181, ["127.0.0.1", 30001]],
      [12182, 16383, ["127.0.0.1", 30002]],
    ];
    let setsOnNewOwner = 0;
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        return "bar";
      }
      if (argv[0] === "set") {
        setsOnNewOwner++;
      }
    });
    let setsOnOldOwner = 0;
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        return new Error("MOVED " + calculateSlot("foo") + " 127.0.0.1:30001");
      }
      if (argv[0] === "set") {
        setsOnOldOwner++;
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
    cluster
      .pipeline()
      .get("foo")
      .set("foo", "bar")
      .exec(function (err, result) {
        expect(err).to.eql(null);
        expect(result[0]).to.eql([null, "bar"]);
        expect(result[1]).to.eql([null, "OK"]);
        expect(setsOnOldOwner).to.eql(1);
        expect(setsOnNewOwner).to.eql(0);
        cluster.disconnect();
        done();
      });
  });

  it("should retry when redis is down", (done) => {
    const slotTable = [
      [0, 12181, ["127.0.0.1", 30001]],
      [12182, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
    });
    const node2 = new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "foo") {
        return "bar";
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      retryDelayOnFailover: 1,
    });
    const stub = sinon
      .stub(cluster, "refreshSlotsCache")
      .callsFake((...args) => {
        node2.connect();
        stub.restore();
        cluster.refreshSlotsCache(...args);
      });
    node2.disconnect();
    cluster
      .pipeline()
      .get("foo")
      .set("foo", "bar")
      .exec(function (err, result) {
        expect(err).to.eql(null);
        expect(result[0]).to.eql([null, "bar"]);
        expect(result[1]).to.eql([null, "OK"]);
        cluster.disconnect();
        done();
      });
  });

  it("should not throw 'All keys in the pipeline should belong to the same slots allocation group' when replica returned MOVED error", (done) => {
    let moved = false;
    const slotTable = [
      [0, 12181, ["127.0.0.1", 30001], ["127.0.0.1", 30003]],
      [12182, 16383, ["127.0.0.1", 30002]],
    ];
    new MockServer(30001, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "bar") {
        return "bar2";
      }
    });
    new MockServer(30002, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
    });
    new MockServer(30003, (argv) => {
      if (argv[0] === "cluster" && argv[1] === "SLOTS") {
        return slotTable;
      }
      if (argv[0] === "get" && argv[1] === "bar") {
        if (!moved) {
          moved = true;
          return new Error(
            "MOVED " + calculateSlot("bar") + " 127.0.0.1:30001"
          );
        }
        return "bar2";
      }
      if (argv[0] === "get" && argv[1] === "baz") {
        return "baz2";
      }
      if (argv[0] === "get" && argv[1] === "bag") {
        return "bag2";
      }
    });

    const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
      scaleReads: "slave",
    });
    cluster.on("ready", () => {
      /** moved for bar is thrown, slots map updated, command is retried */
      cluster
        .pipeline()
        .get("bar") // slot 5061
        .get("bag") // slot 4433
        .get("baz") // slot 4813
        .exec((err, res) => {
          expect(err).to.eql(null);
          expect(res).to.have.lengthOf(3);
          cluster.disconnect();
          done();
        });
    });
  });

  describe("recovering individual redirected commands", () => {
    const slotTable = [
      [0, 12181, ["127.0.0.1", 30001]],
      [12182, 16383, ["127.0.0.1", 30002]],
    ];
    const fooSlot = calculateSlot("foo");

    function serve(port: number, handler: (argv: string[]) => any) {
      return new MockServer(port, (argv) => {
        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return slotTable;
        }
        return handler(argv);
      });
    }

    it("keeps each result at its original index and sends nothing else again", async () => {
      const received: string[] = [];
      serve(30001, (argv) => {
        received.push(`30001 ${argv.join(" ")}`);
        if (argv[0] === "get" && argv[1] === "foo") {
          return "bar";
        }
      });
      serve(30002, (argv) => {
        received.push(`30002 ${argv.join(" ")}`);
        if (argv[0] === "get" && argv[1] === "foo") {
          return new Error(`MOVED ${fooSlot} 127.0.0.1:30001`);
        }
        if (argv[0] === "get" && argv[1] === "y") {
          return "other";
        }
      });

      const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
      try {
        const result = await cluster
          .pipeline()
          .set("a", "1")
          .get("foo")
          .incr("x")
          .get("y")
          .exec();
        expect(result).to.eql([
          [null, "OK"],
          [null, "bar"],
          [null, "OK"],
          [null, "other"],
        ]);
        const commands = received.filter((line) =>
          /(^| )(asking|get|set|incr)( |$)/.test(line)
        );
        expect(commands).to.have.members([
          "30002 set a 1",
          "30002 get foo",
          "30002 incr x",
          "30002 get y",
          "30001 get foo",
        ]);
        expect(commands).to.have.lengthOf(5);
      } finally {
        cluster.disconnect();
      }
    });

    it("calls a redirected command's own callback once, with the final reply", async () => {
      serve(30001, (argv) => {
        if (argv[0] === "get" && argv[1] === "foo") {
          return "bar";
        }
      });
      serve(30002, (argv) => {
        if (argv[0] === "get" && argv[1] === "foo") {
          return new Error(`MOVED ${fooSlot} 127.0.0.1:30001`);
        }
      });

      const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
      const calls: unknown[][] = [];
      try {
        await cluster
          .pipeline()
          .get("foo", (...args) => {
            calls.push(args);
          })
          .set("a", "bar")
          .exec();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(calls).to.eql([[null, "bar"]]);
      } finally {
        cluster.disconnect();
      }
    });

    it("sends ASKING only before the command that was asked to move", async () => {
      const received: string[] = [];
      serve(30001, (argv) => {
        received.push(argv.join(" "));
        if (argv[0] === "get" && argv[1] === "foo") {
          return "bar";
        }
      });
      serve(30002, (argv) => {
        if (argv[0] === "get" && argv[1] === "foo") {
          return new Error(`ASK ${fooSlot} 127.0.0.1:30001`);
        }
      });

      const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
      try {
        const result = await cluster
          .pipeline()
          .get("foo")
          .set("foo", "bar")
          .exec();
        expect(result).to.eql([
          [null, "bar"],
          [null, "OK"],
        ]);
        const commands = received.filter((line) =>
          /(^| )(asking|get|set|incr)( |$)/.test(line)
        );
        expect(commands).to.eql(["asking", "get foo"]);
        // ASK does not change slot ownership
        expect(cluster.slots[fooSlot][0]).to.eql("127.0.0.1:30002");
      } finally {
        cluster.disconnect();
      }
    });

    it("retries only the command that got TRYAGAIN", async () => {
      let mgets = 0;
      let sets = 0;
      new MockServer(30001, (argv) => {
        if (argv[0] === "cluster" && argv[1] === "SLOTS") {
          return [[0, 16383, ["127.0.0.1", 30001]]];
        }
        if (argv[0] === "mget") {
          if (mgets++ === 0) {
            return new Error(
              "TRYAGAIN Multiple keys request during rehashing of slot"
            );
          }
          return ["1", "2"];
        }
        if (argv[0] === "set") {
          sets++;
        }
      });

      const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
        retryDelayOnTryAgain: 1,
      });
      try {
        const result = await cluster
          .pipeline()
          .mget("{t}a", "{t}b")
          .set("{t}a", "2")
          .exec();
        expect(result).to.eql([
          [null, ["1", "2"]],
          [null, "OK"],
        ]);
        expect(mgets).to.eql(2);
        expect(sets).to.eql(1);
      } finally {
        cluster.disconnect();
      }
    });

    it("waits for retryDelayOnMoved before resending a redirected command", async () => {
      let movedAt = 0;
      let retriedAt = 0;
      serve(30001, (argv) => {
        if (argv[0] === "get" && argv[1] === "foo") {
          retriedAt = Date.now();
          return "bar";
        }
      });
      serve(30002, (argv) => {
        if (argv[0] === "get" && argv[1] === "foo") {
          movedAt = Date.now();
          return new Error(`MOVED ${fooSlot} 127.0.0.1:30001`);
        }
      });

      const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
        retryDelayOnMoved: 60,
      });
      try {
        const result = await cluster
          .pipeline()
          .get("foo")
          .set("foo", "bar")
          .exec();
        expect(result[0]).to.eql([null, "bar"]);
        expect(retriedAt - movedAt).to.be.at.least(50);
      } finally {
        cluster.disconnect();
      }
    });

    it("spends one unit of maxRedirections per resend, per command", async () => {
      let resends = 0;
      serve(30001, (argv) => {
        if (argv[0] === "get" && argv[1] === "foo") {
          resends++;
          return new Error(`MOVED ${fooSlot} 127.0.0.1:30002`);
        }
      });
      serve(30002, (argv) => {
        if (argv[0] === "get" && argv[1] === "foo") {
          return new Error(`MOVED ${fooSlot} 127.0.0.1:30001`);
        }
      });

      const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
        maxRedirections: 2,
      });
      try {
        const result = await cluster
          .pipeline()
          .get("foo")
          .set("foo", "bar")
          .exec();
        expect(result[0][0].message).to.match(
          /^Too many Cluster redirections\. Last error: .*MOVED/
        );
        expect(result[1]).to.eql([null, "OK"]);
        // first reply from the batch, then two resends: 30001, 30002, 30001
        expect(resends).to.eql(1);
      } finally {
        cluster.disconnect();
      }
    });

    it("leaves errors other than redirections to the pipeline", async () => {
      let gets = 0;
      serve(30001, () => undefined);
      serve(30002, (argv) => {
        if (argv[0] === "get" && argv[1] === "foo") {
          gets++;
          return new Error("CLUSTERDOWN The cluster is down");
        }
      });

      const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
        retryDelayOnClusterDown: 1,
      });
      try {
        const result = await cluster
          .pipeline()
          .get("foo")
          .set("foo", "bar")
          .exec();
        // A successful write makes the batch non-retriable, as before.
        expect(result[0][0].message).to.eql("CLUSTERDOWN The cluster is down");
        expect(result[1]).to.eql([null, "OK"]);
        expect(gets).to.eql(1);
      } finally {
        cluster.disconnect();
      }
    });

    it("recovers a redirection that follows a whole-pipeline retry", async () => {
      let round = 0;
      serve(30001, (argv) => {
        if (argv[0] === "get" && argv[1] === "foo") {
          return "bar";
        }
      });
      serve(30002, (argv) => {
        if (argv[0] === "get" && argv[1] === "foo") {
          round++;
          if (round === 1) {
            return new Error("CLUSTERDOWN The cluster is down");
          }
          return new Error(`MOVED ${fooSlot} 127.0.0.1:30001`);
        }
        if (argv[0] === "set" && round === 1) {
          return new Error("CLUSTERDOWN The cluster is down");
        }
      });

      const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
        retryDelayOnClusterDown: 1,
      });
      try {
        const result = await cluster
          .pipeline()
          .get("foo")
          .set("a", "bar")
          .exec();
        expect(result).to.eql([
          [null, "bar"],
          [null, "OK"],
        ]);
        expect(round).to.eql(2);
      } finally {
        cluster.disconnect();
      }
    });

    it("keeps one redirection budget when the resend waits in the offline queue", async () => {
      let resends = 0;
      let parked = false;
      let cluster: Cluster;
      serve(30001, (argv) => {
        if (argv[0] === "get" && argv[1] === "foo") {
          resends++;
          return new Error(`MOVED ${fooSlot} 127.0.0.1:30002`);
        }
      });
      serve(30002, (argv) => {
        if (argv[0] === "get" && argv[1] === "foo") {
          if (!parked) {
            parked = true;
            // The cluster is not ready when the MOVED reply is handled, so
            // the resend is parked in the cluster's offline queue.
            (cluster as any).status = "connecting";
          } else {
            resends++;
          }
          return new Error(`MOVED ${fooSlot} 127.0.0.1:30001`);
        }
      });

      cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
        maxRedirections: 3,
      });
      try {
        await cluster.get("a");
        const pending = cluster.pipeline().get("foo").set("a", "1").exec();
        while ((cluster as any).status !== "connecting") {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
        (cluster as any).status = "ready";
        (cluster as any).executeOfflineCommands();

        const result = await pending;
        expect(result[0][0].message).to.match(/^Too many Cluster redirections/);
        expect(result[1]).to.eql([null, "OK"]);
        expect(resends).to.eql(3);
      } finally {
        cluster.disconnect();
      }
    });

    it("keeps today's result when maxRedirections is 0", async () => {
      let resends = 0;
      serve(30001, (argv) => {
        if (argv[0] === "get" && argv[1] === "foo") {
          resends++;
          return "bar";
        }
      });
      serve(30002, (argv) => {
        if (argv[0] === "get" && argv[1] === "foo") {
          return new Error(`MOVED ${fooSlot} 127.0.0.1:30001`);
        }
      });

      const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }], {
        maxRedirections: 0,
      });
      try {
        const result = await cluster
          .pipeline()
          .get("foo")
          .set("foo", "bar")
          .exec();
        expect(result[0][0].message).to.eql(`MOVED ${fooSlot} 127.0.0.1:30001`);
        expect(result[1]).to.eql([null, "OK"]);
        expect(resends).to.eql(0);
      } finally {
        cluster.disconnect();
      }
    });

    it("leaves a MOVED inside MULTI/EXEC to the whole-transaction retry", async () => {
      const received: string[] = [];
      serve(30001, (argv) => {
        received.push(`30001 ${argv[0]}`);
        if (argv[0] === "exec") {
          return ["OK"];
        }
        if (argv[0] !== "multi") {
          return "QUEUED";
        }
      });
      serve(30002, (argv) => {
        received.push(`30002 ${argv[0]}`);
        if (argv[0] === "set") {
          return new Error(`MOVED ${fooSlot} 127.0.0.1:30001`);
        }
        if (argv[0] === "exec") {
          return new Error(
            "EXECABORT Transaction discarded because of previous errors."
          );
        }
      });

      const cluster = new Cluster([{ host: "127.0.0.1", port: "30001" }]);
      try {
        const result = await cluster.multi().set("foo", "bar").exec();
        expect(result).to.eql([[null, "OK"]]);
        const commands = received.filter((line) =>
          / (multi|set|exec)$/.test(line)
        );
        expect(commands).to.eql([
          "30002 multi",
          "30002 set",
          "30002 exec",
          "30001 multi",
          "30001 set",
          "30001 exec",
        ]);
      } finally {
        cluster.disconnect();
      }
    });
  });
});
