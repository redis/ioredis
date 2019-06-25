"use strict";

import * as net from "net";
import * as tls from "tls";
import { StandaloneConnector } from "../../../lib/connectors";
import * as sinon from "sinon";
import { expect } from "chai";

describe("StandaloneConnector", function() {
  describe("connect()", function() {
    it("first tries path", function(done) {
      const stub = sinon.stub(net, "createConnection");
      var connector = new StandaloneConnector({ port: 6379, path: "/tmp" });
      connector.connect(
        function() {
          expect(stub.calledOnce).to.eql(true);
          expect(stub.firstCall.args[0]).to.eql({ path: "/tmp" });
          done();
        },
        () => {}
      );
    });

    it("ignore path when port is set and path is null", function(done) {
      const stub = sinon.stub(net, "createConnection");
      var connector = new StandaloneConnector({ port: 6379, path: null });
      connector.connect(
        function() {
          expect(stub.calledOnce).to.eql(true);
          expect(stub.firstCall.args[0]).to.eql({ port: 6379 });
          done();
        },
        () => {}
      );
    });

    it("supports tls", function(done) {
      const stub = sinon.stub(tls, "connect");
      var connector = new StandaloneConnector({
        port: 6379,
        tls: { ca: "on" }
      });
      connector.connect(
        function() {
          expect(stub.calledOnce).to.eql(true);
          expect(stub.firstCall.args[0]).to.eql({ port: 6379, ca: "on" });
          done();
        },
        () => {}
      );
    });
  });
});
