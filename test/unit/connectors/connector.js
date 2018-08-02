'use strict';

var net = require('net');
var tls = require('tls');
var {StandaloneConnector} = require('../../../lib/connectors');

describe('StandaloneConnector', function () {
  describe('connect()', function () {
    it('first tries path', function (done) {
      stub(net, 'createConnection');
      var connector = new StandaloneConnector({ port: 6379, path: '/tmp' });
      connector.connect(function () {
        expect(net.createConnection.calledOnce).to.eql(true);
        expect(net.createConnection.firstCall.args[0]).to.eql({path: '/tmp'});
        net.createConnection.restore();
        done();
      });
    });

    it('ignore path when port is set and path is null', function (done) {
      stub(net, 'createConnection');
      var connector = new StandaloneConnector({ port: 6379, path: null });
      connector.connect(function () {
        expect(net.createConnection.calledOnce).to.eql(true);
        expect(net.createConnection.firstCall.args[0]).to.eql({port: 6379});
        net.createConnection.restore();
        done();
      });
    });

    it('supports tls', function (done) {
      stub(tls, 'connect');
      var connector = new StandaloneConnector({ port: 6379, tls: {ca: 'on'} });
      connector.connect(function () {
        expect(tls.connect.calledOnce).to.eql(true);
        expect(tls.connect.firstCall.args[0]).to.eql({ port: 6379, ca: 'on' });
        tls.connect.restore();
        done();
      });
    });
  });
});

