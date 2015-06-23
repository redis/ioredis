## Changelog

### Master Branch

### v1.5.3 - June 24, 2015

* Fix sometimes monitor leads command queue error.

### v1.5.2 - June 24, 2015

* Fix `enableReadyCheck` is always `false` in monitor mode([#77](https://github.com/luin/ioredis/issues/77)).

### v1.5.1 - June 16, 2015

* Fix getting NaN db index([#74](https://github.com/luin/ioredis/issues/74)).

### v1.5.0 - June 13, 2015

* Uses double ended queue instead of Array for better performance.
* Resolves a bug with cluster where a subscribe is sent to a disconnected node([#63](https://github.com/luin/ioredis/pull/63)). Thanks to [Ari Aosved](https://github.com/devaos).
* Adds ReadOnly mode for Cluster mode([#69](https://github.com/luin/ioredis/pull/69)). Thanks to [Nakul Ganesh](https://github.com/luin/ioredis/pull/69).
* Adds `Redis.print`([#71](https://github.com/luin/ioredis/pull/71)). Thanks to [Frank Murphy](https://github.com/frankvm04).

### v1.4.0 - June 3, 2015

* Continue monitoring after reconnection([#52](https://github.com/luin/ioredis/issues/52)).
* Support pub/sub in Cluster mode([#54](https://github.com/luin/ioredis/issues/54)).
* Auto-reconnect when none of startup nodes is ready([#56](https://github.com/luin/ioredis/issues/56)).

### v1.3.6 - May 22, 2015

* Support Node.js 0.10.16
* Fix unfulfilled commands being sent to the wrong db([#42](https://github.com/luin/ioredis/issues/42)).

### v1.3.5 - May 21, 2015

* Fix possible memory leak warning of Cluster.
* Stop reconnecting when disconnected manually.

### v1.3.4 - May 21, 2015

* Add missing Promise definition in node 0.10.x.

### v1.3.3 - May 19, 2015

* Fix possible memory leak warning.

### v1.3.2 - May 18, 2015

* The constructor of `pipeline`/`multi` accepts a batch of commands.

### v1.3.1 - May 16, 2015

* Improve the performance of sending commands([#35](https://github.com/luin/ioredis/issues/35)). Thanks to [@AVVS](https://github.com/AVVS).

### v1.3.0 - May 15, 2015

* Support pipeline redirection in Cluster mode.

### v1.2.7 - May 15, 2015

* `Redis#connect` returns a promise.

### v1.2.6 - May 13, 2015

* Fix showFriendlyErrorStack not working in pipeline.

### v1.2.5 - May 12, 2015

* Fix errors when sending commands after connection being closed.

### v1.2.4 - May 9, 2015

* Try a random node when the target slot isn't served by the cluster.
* Remove `refreshAfterFails` option.
* Try random node when refresh slots.

### v1.2.3 - May 9, 2015

* Fix errors when `numberOfKeys` is `0`.

### v1.2.2 - May 8, 2015

* Add `retryDelayOnClusterDown` option to handle CLUSTERDOWN error.
* Fix `multi` commands sometimes doesn't return a promise.

### v1.2.1 - May 7, 2015

* Fix `sendCommand` sometimes doesn't return a promise.

### v1.2.0 - May 4, 2015

* Add `autoResendUnfulfilledCommands` option.

### v1.1.4 - May 3, 2015

* Support get built-in commands.

### v1.1.3 - May 2, 2015

* Fix buffer supporting in pipeline. Thanks to [@AVVS](https://github.com/AVVS).

### v1.1.2 - May 2, 2015

* Fix error of sending command to wrong node when slot is 0.

### v1.1.1 - May 2, 2015

* Support Transaction and pipelining in cluster mode.

### v1.1.0 - May 1, 2015

* Support cluster auto reconnection.
* Add `maxRedirections` option to Cluster.
* Remove `roleRetryDelay` option in favor of `sentinelRetryStrategy`.
* Improve compatibility with node_redis.
* More stable sentinel connection.

### v1.0.13 - April 27, 2015

* Support SORT, ZUNIONSTORE and ZINTERSTORE in Cluster.

### v1.0.12 - April 27, 2015

* Support for defining custom commands in Cluster.
* Use native array instead of fastqueue for better performance.

### v1.0.11 - April 26, 2015

* Add `showFriendlyErrorStack` option for outputing friendly error stack.

### v1.0.10 - April 25, 2015

* Improve performance for calculating slots.

### v1.0.9 - April 25, 2015

* Support single node commands in cluster mode.

### v1.0.8 - April 25, 2015

* Add promise supports in Cluster.

### v1.0.7 - April 25, 2015

* Add `autoResubscribe` option to prevent auto re-subscribe.
* Add `Redis#end` for compatibility.
* Add `Redis.createClient`(was `Redis#createClient`).

### v1.0.6 - April 24, 2015

* Support setting connect timeout.
