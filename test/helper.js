GLOBAL.expect = require('chai').expect;

var Redis = GLOBAL.Redis = require('..');

// beforeEach(function (done) {
//   this.redis = new Redis();
//   this.redis.once('connect', done);
// });

// afterEach(function (done) {
//   this.redis.once('close', done);
//   this.redis.disconnect();
// });
