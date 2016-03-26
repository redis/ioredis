'use strict';

global.expect = require('chai').expect;

var sinon = require('sinon');
global.spy = sinon.spy.bind(sinon);
global.stub = sinon.stub.bind(sinon);
global.mock = sinon.mock.bind(sinon);

global.Redis = require('../..');
global.MockServer = require('./mock_server');

afterEach(function (done) {
  var redis = new Redis();
  redis.flushall(function () {
    redis.script('flush', function () {
      redis.disconnect();
      done();
    });
  });
});
