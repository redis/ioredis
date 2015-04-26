'use strict';

GLOBAL.expect = require('chai').expect;

var sinon = require('sinon');
GLOBAL.stub = sinon.stub.bind(sinon);

GLOBAL.Redis = require('../..');
GLOBAL.MockServer = require('./mock_server');

afterEach(function (done) {
  var redis = new Redis();
  redis.flushall(function () {
    redis.script('flush', function () {
      redis.disconnect();
      done();
    });
  });
});
