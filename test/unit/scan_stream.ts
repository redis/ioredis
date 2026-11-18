import { expect } from "chai";
import * as sinon from "sinon";
import Redis from "../../lib/Redis";
import Cluster from "../../lib/cluster";

describe("ScanStream", () => {
  afterEach(() => sinon.restore());

  for (const command of ["hscan", "sscan", "zscan"]) {
    for (const suffix of ["", "Buffer"]) {
      it(`preserves an empty key in ${command}${suffix}Stream`, async () => {
        const redis = new Redis({ lazyConnect: true });
        const scan = sinon.stub(redis, `${command}${suffix}` as any);
        scan.callsFake((_args, callback) => callback(null, ["0", []]));

        for await (const _ of redis[`${command}${suffix}Stream`]("")) {
          // Consume the stream to send the scan command.
        }

        expect(scan.calledOnce).to.eql(true);
        expect(scan.firstCall.args[0]).to.eql(["", "0"]);
      });
    }
  }

  for (const command of ["hscan", "sscan", "zscan"]) {
    for (const suffix of ["", "Buffer"]) {
      for (const mode of ["standalone", "cluster"]) {
        it(`preserves binary keys across ${command}${suffix}Stream pages in ${mode}`, async () => {
          const client =
            mode === "standalone"
              ? new Redis({ lazyConnect: true })
              : new Cluster([], { lazyConnect: true });
          const key = Buffer.from([0xff, 0x00, 0x80]);
          const scan = sinon.stub(client, `${command}${suffix}` as any);
          scan
            .onFirstCall()
            .callsFake((_args, callback) => callback(null, ["42", []]));
          scan
            .onSecondCall()
            .callsFake((_args, callback) =>
              callback(null, [Buffer.from("0"), []])
            );

          try {
            for await (const _ of client[`${command}${suffix}Stream`](key)) {
              // Consume both pages, including the empty intermediate one.
            }
            expect(scan.calledTwice).to.eql(true);
            expect(scan.firstCall.args[0]).to.eql([key, "0"]);
            expect(scan.secondCall.args[0]).to.eql([key, "42"]);
            expect(scan.firstCall.args[0][0]).to.equal(key);
            expect(scan.secondCall.args[0][0]).to.equal(key);
          } finally {
            client.disconnect();
          }
        });
      }
    }
  }

  for (const suffix of ["", "Buffer"]) {
    it(`preserves an empty MATCH pattern in scan${suffix}Stream`, async () => {
      const redis = new Redis({ lazyConnect: true });
      const scan = sinon.stub(redis, `scan${suffix}` as any);
      scan.callsFake((_args, callback) => callback(null, ["0", []]));

      for await (const _ of redis[`scan${suffix}Stream`]({ match: "" })) {
        // Consume the stream to send the scan command.
      }

      expect(scan.calledOnce).to.eql(true);
      expect(scan.firstCall.args[0]).to.eql(["0", "MATCH", ""]);
    });
  }
});
