'use strict';

var net = require('net');
var tls = require('tls');
var Connector = require('../../../lib/connectors/connector');

describe('Connector', function () {
  describe('connect()', function () {
    it('first tries path', function (done) {
      stub(net, 'createConnection');
      var connector = new Connector({ port: 6379, path: '/tmp' });
      connector.connect(function () {
        net.createConnection.calledWith({ path: '/tmp' });
        net.createConnection.restore();
        done();
      });
    });

    it('supports tls', function (done) {
      stub(tls, 'connect');
      var connector = new Connector({ port: 6379, tls: 'on' });
      connector.connect(function () {
        tls.connect.calledWith({ port: 6379, tls: 'on' });
        tls.connect.restore();
        done();
      });
    });
  });
});

