/**
 * Default options
 *
 * @var _defaultOptions
 * @memberOf Redis
 * @private
 */
exports._defaultOptions = {
  port: 6379,
  host: 'localhost',
  family: 4,
  enableOfflineQueue: true,
  enableReadyCheck: true,
  retryStrategy: function (times) {
    var delay = Math.min(times * 2, 10000);
    return delay;
  },
  password: null,
  db: 0
};
