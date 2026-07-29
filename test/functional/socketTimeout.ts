import { expect } from 'chai';
import { Done } from 'mocha';
import { Socket } from 'net';
import Redis from '../../lib/Redis';
import MockServer from '../helpers/mock_server';

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

  it('does not apply a closed connection timeout to its replacement', async () => {
    let connectionCount = 0;
    let closeCount = 0;
    let firstSocket: Socket | undefined;
    const errors: string[] = [];

    const server = new MockServer(30001, (argv, socket, flags) => {
      if (argv[0] !== 'ping') {
        return;
      }
      if (socket === firstSocket) {
        flags.hang = true;
        setTimeout(() => socket.destroy(), 20);
        return;
      }
      return 'PONG';
    });
    server.on('connect', (socket) => {
      connectionCount += 1;
      firstSocket ??= socket;
    });

    const redis = createRedis({
      port: 30001,
      protocol: 2,
      disableClientInfo: true,
      enableReadyCheck: false,
      socketTimeout: 250
    });
    redis.on('error', (error) => errors.push(error.message));
    redis.on('close', () => closeCount++);

    try {
      await redis.connect();
      expect(await redis.ping()).to.equal('PONG');

      await new Promise((resolve) => setTimeout(resolve, 350));

      expect(errors).to.deep.equal([]);
      expect(closeCount).to.equal(1);
      expect(connectionCount).to.equal(2);
      expect(redis.status).to.equal('ready');
    } finally {
      redis.disconnect();
      await server.disconnectPromise();
    }
  }).timeout(5000);

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
