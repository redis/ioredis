import Redis from '../../lib/redis'
import * as sinon from 'sinon'

describe('ready_check', function () {
  it('should retry when redis is not ready', function (done) {
    var redis = new Redis({ lazyConnect: true });

    sinon.stub(redis, 'info').callsFake(callback => {
      callback(null, 'loading:1\r\nloading_eta_seconds:7');
    });
    // @ts-ignore
    const stub = sinon.stub(global, 'setTimeout').callsFake((body, ms) => {
      if (ms === 7000) {
        redis.info.restore();
        stub.restore();
        done();
      }
    });
    redis.connect();
  });

  it('should reconnect when info return a error', function (done) {
    var redis = new Redis({
      lazyConnect: true,
      retryStrategy: function () {
        done();
        return;
      }
    });

    sinon.stub(redis, 'info').callsFake(callback => {
      callback(new Error('info error'));
    });

    redis.connect();
  });
});
