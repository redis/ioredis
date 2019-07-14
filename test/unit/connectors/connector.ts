"use strict";

import * as net from "net";
import * as tls from "tls";
import { StandaloneConnector } from "../../../lib/connectors";
import * as sinon from "sinon";
import { expect } from "chai";

describe("StandaloneConnector", () => {
  describe("connect()", () => {
    it("first tries path", async () => {
      const stub = sinon.stub(net, "createConnection");
      const connector = new StandaloneConnector({ port: 6379, path: "/tmp" });
      await connector.connect(() => {});
      expect(stub.calledOnce).to.eql(true);
    });

    it("ignore path when port is set and path is null", async () => {
      const stub = sinon.stub(net, "createConnection");
      const connector = new StandaloneConnector({ port: 6379, path: null });
      await connector.connect(() => {});
      expect(stub.calledOnce).to.eql(true);
      expect(stub.firstCall.args[0]).to.eql({ port: 6379 });
    });

    it("supports tls", async () => {
      const stub = sinon.stub(tls, "connect");
      const connector = new StandaloneConnector({
        port: 6379,
        tls: { ca: "on" }
      });
      connector.connect(() => {});
      expect(stub.calledOnce).to.eql(true);
      expect(stub.firstCall.args[0]).to.eql({ port: 6379, ca: "on" });
    });
  });
});
