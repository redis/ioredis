import { expect } from "chai";
import * as sinon from "sinon";
import Redis from "../../lib/Redis";

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
