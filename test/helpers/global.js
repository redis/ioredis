GLOBAL.expect = require('chai').expect;

var sinon = require('sinon');
GLOBAL.stub = sinon.stub.bind(sinon);

var Redis = GLOBAL.Redis = require('../..');
GLOBAL.MockServer = require('./mock_server');

// beforeEach(function (done) {
//   this.redis = new Redis();
//   this.redis.once('connect', done);
// });

afterEach(function (done) {
  var redis = new Redis();
  redis.flushall(function () {
    redis.script('flush', function () {
      redis.disconnect();
      done();
    });
  });
});
