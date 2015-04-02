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
  family: 'IPv4',
  enableOfflineQueue: true,
  enableReadyCheck: true,
  retryStrategy: function (times) {
    var delay = Math.min(times * 2, 10000);
    return delay;
  },
  auth: null,
  select: null
};
