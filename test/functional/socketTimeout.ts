import { expect } from 'chai';
import { Done } from 'mocha';
import Redis from '../../lib/Redis';

describe('Redis Connection Socket Timeout', () => {
  const SOCKET_TIMEOUT_MS = 500;

  it('maintains stable connection with password authentication | https://github.com/redis/ioredis/issues/1919 ', (done) => {
    const redis = createRedis({ password: 'password' });
    assertNoTimeoutAfterConnection(redis, done);
  });

  it('maintains stable connection without initial authentication | https://github.com/redis/ioredis/issues/1919', (done) => {
    const redis = createRedis();
    assertNoTimeoutAfterConnection(redis, done);
  });

  it('should throw when socket timeout threshold is exceeded', (done) => {
    const redis = createRedis()

    redis.on('error', (err) => {
      expect(err.message).to.eql(`Socket timeout. Expecting data, but didn't receive any in ${SOCKET_TIMEOUT_MS}ms.`);
      done();
    });

    redis.connect(() => {
      redis.stream.removeAllListeners('data');
      redis.ping();
    });
  });

  function createRedis(options = {}) {
    return new Redis({
      socketTimeout: SOCKET_TIMEOUT_MS,
      lazyConnect: true,
      ...options
    });
  }

  function assertNoTimeoutAfterConnection(redisInstance: Redis, done: Done) {
    let timeoutObj: NodeJS.Timeout;

    redisInstance.on('error', (err) => {
      clearTimeout(timeoutObj);
      done(err.toString());
    });

    redisInstance.connect(() => {
      timeoutObj = setTimeout(() => {
        done();
      }, SOCKET_TIMEOUT_MS * 2);
    });
  }
});
