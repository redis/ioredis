'use strict';

describe('ready_check', function () {
  it('should retry when redis is not ready', function (done) {
    var redis = new Redis({ lazyConnect: true });

    stub(redis, 'info', function (callback) {
      callback(null, 'loading:1\r\nloading_eta_seconds:7');
    });
    stub(global, 'setTimeout', function (body, ms) {
      if (ms === 7000) {
        redis.info.restore();
        global.setTimeout.restore();
        done();
      }
    });
    redis.connect();
  });
});
