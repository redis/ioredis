<a name="2.2.0"></a>
# [2.2.0](https://github.com/luin/ioredis/compare/v2.1.0...v2.2.0) (2016-06-28)


### Bug Fixes

* **cluster:** ensure node exists before being redirected via an ASK (#341) ([5d9d0d3](https://github.com/luin/ioredis/commit/5d9d0d3))

### Features

* **cluster:** add Cluster#quit() to quit cluster gracefully. (#339) ([68c4ccc](https://github.com/luin/ioredis/commit/68c4ccc)), closes [#315](https://github.com/luin/ioredis/issues/315)



<a name="2.1.0"></a>
# [2.1.0](https://github.com/luin/ioredis/compare/v2.0.1...v2.1.0) (2016-06-22)


### Bug Fixes

* remove unnecessary unhandled error warnings ([#322](https://github.com/luin/ioredis/issues/322)) ([a1ff2f6](https://github.com/luin/ioredis/commit/a1ff2f6))


### Features

* **sentinel:** update sentinels after getting master ([e3f14b2](https://github.com/luin/ioredis/commit/e3f14b2))


### Performance Improvements

* **cluster:** improve the performance of calculating slots ([#323](https://github.com/luin/ioredis/issues/323)) ([3ab4e8a](https://github.com/luin/ioredis/commit/3ab4e8a))



<a name="2.0.1"></a>
# [2.0.1](https://github.com/luin/ioredis/compare/v2.0.0...v2.0.1) (2016-06-01)

### Bug Fixes

* fix transaction with dropBufferSupport:true([47a2d9a](https://github.com/luin/ioredis/commit/47a2d9a))

<a name="2.0.0"></a>
# [2.0.0](https://github.com/luin/ioredis/compare/v2.0.0-rc4...v2.0.0) (2016-05-29)

Refer to [Breaking Changes between V1 and V2](https://github.com/luin/ioredis/wiki/Breaking-changes-between-v1-and-v2) for all breaking changes.

Changes since 2.0.0-rc4:

### Features

* include source and database in monitor events ([#308](https://github.com/luin/ioredis/issues/308)) ([a0d5b25](https://github.com/luin/ioredis/commit/a0d5b25))


### Performance Improvements

* improve the performance of checking flags ([#312](https://github.com/luin/ioredis/issues/312)) ([236da27](https://github.com/luin/ioredis/commit/236da27))


<a name="2.0.0-rc4"></a>
# [2.0.0-rc4](https://github.com/luin/ioredis/compare/v2.0.0-rc3...v2.0.0-rc4) (2016-05-08)


### Bug Fixes

* reconnect when ready check failed([3561fab](https://github.com/luin/ioredis/commit/3561fab))
* remove data handler when flushing command queue([b1c761c](https://github.com/luin/ioredis/commit/b1c761c))
* won't emit error again when password is wrong([dfdebfe](https://github.com/luin/ioredis/commit/dfdebfe))


### Features

* add dropBufferSupport option to improve the performance ([#293](https://github.com/luin/ioredis/issues/293))([1a8700c](https://github.com/luin/ioredis/commit/1a8700c))
* add support for Node.js v6 ([#295](https://github.com/luin/ioredis/issues/295))([a87f405](https://github.com/luin/ioredis/commit/a87f405))
* emit authentication related errors with "error" event([9dc25b4](https://github.com/luin/ioredis/commit/9dc25b4))
* print logs for unhandled error event([097fdbc](https://github.com/luin/ioredis/commit/097fdbc))


### BREAKING CHANGES

* Authentication related errors are emited with "error" event,
instead of "authError" event



<a name="2.0.0-rc3"></a>
# [2.0.0-rc3](https://github.com/luin/ioredis/compare/v2.0.0-rc2...v2.0.0-rc3) (2016-05-02)


### Bug Fixes

* fix wrong host not causing error ([25c300e](https://github.com/luin/ioredis/commit/25c300e)), closes [#287](https://github.com/luin/ioredis/issues/287)
* reconnect when getting fatal error (#292) ([1cf2ac1](https://github.com/luin/ioredis/commit/1cf2ac1))

### Features

* **deps:** upgrade redis-commands package ([df08250](https://github.com/luin/ioredis/commit/df08250))



<a name="2.0.0-rc2"></a>
# [2.0.0-rc2](https://github.com/luin/ioredis/compare/v2.0.0-rc1...v2.0.0-rc2) (2016-04-10)


### Bug Fixes

* **CLUSTER:** fix cluster not disconnected when called disconnect method (#281) ([91998e3](https://github.com/luin/ioredis/commit/91998e3)), closes [(#281](https://github.com/(/issues/281)
* **sentinel:** improve the error message when connection to sentinel is rejected ([3ca30d8](https://github.com/luin/ioredis/commit/3ca30d8)), closes [#280](https://github.com/luin/ioredis/issues/280)

### Features

* add stringNumbers option to return numbers as JavaScript strings (#282) ([2a33fc7](https://github.com/luin/ioredis/commit/2a33fc7)), closes [#273](https://github.com/luin/ioredis/issues/273)

<a name="2.0.0-rc1"></a>
# [2.0.0-rc1](https://github.com/luin/ioredis/compare/v2.0.0-alpha3...v2.0.0-rc1) (2016-03-18)

### Features

* **dependencies**: upgrade all dependencies to the newest version ([3fdafc8](https://github.com/luin/ioredis/commit/3fdafc8)).


<a name="2.0.0-alpha3"></a>
# [2.0.0-alpha3](https://github.com/luin/ioredis/compare/v2.0.0-alpha2...v2.0.0-alpha3) (2016-03-13)

### Bug Fixes

* **auth:** emit authError when the server requiring a password ([c5ca754](https://github.com/luin/ioredis/commit/c5ca754))

### Features

* **cluster:** add enableReadyCheck option for cluster ([b63cdc7](https://github.com/luin/ioredis/commit/b63cdc7))
* **cluster:** redirect on TRYAGAIN error ([b1a4b62](https://github.com/luin/ioredis/commit/b1a4b62))
* **cluster:** support update startupNodes in clusterRetryStrategy ([4a46766](https://github.com/luin/ioredis/commit/4a46766))
* **transaction:** transform replies of transactions ([e0b1883](https://github.com/luin/ioredis/commit/e0b1883)), closes [#158](https://github.com/luin/ioredis/issues/158)


### BREAKING CHANGES

  1. Reply transformers is supported inside transactions.
  2. `Pipeline#execBuffer()` is deprecated. Use `Pipeline#exec()` instead.

<a name="2.0.0-alpha2"></a>
# [2.0.0-alpha2](https://github.com/luin/ioredis/compare/v2.0.0-alpha1...v2.0.0-alpha2) (2016-02-29)


### Bug Fixes

* **cluster:** fix memory leaking in sendCommand method ([410af51](https://github.com/luin/ioredis/commit/410af51))

### Features

* **cluster:** add the option for a custom node selector in scaleReads ([6795b1e](https://github.com/luin/ioredis/commit/6795b1e))



<a name="2.0.0-alpha1"></a>
# [2.0.0-alpha1](https://github.com/luin/ioredis/compare/v1.15.0...v2.0.0-alpha1) (2016-02-10)


### Bug Fixes

* **cluster:** avoid command.reject being overwritten twice ([d0a0017](https://github.com/luin/ioredis/commit/d0a0017))
* **cluster:** fix not connecting to the unknown nodes ([0dcb768](https://github.com/luin/ioredis/commit/0dcb768))
* **cluster:** set retryDelayOnFailover from 2000ms to 200ms ([72fd804](https://github.com/luin/ioredis/commit/72fd804))

### Features

* **cluster:** support scaling reads to slaves ([98bdec2](https://github.com/luin/ioredis/commit/98bdec2)), closes [#170](https://github.com/luin/ioredis/issues/170)
* **redis:** support readonly mode for cluster ([0a4186e](https://github.com/luin/ioredis/commit/0a4186e))


### BREAKING CHANGES

* **cluster:** `Cluster#masterNodes` and `Cluster#nodes` is removed. Use `Cluster#nodes('masters')` and `Cluster#nodes('all')` instead.
* **cluster:** `Cluster#to()` is removed. Use `Promise.all(Cluster#nodes().map(function (node) {}))` instead.
* **cluster:** Option `readOnly` is removed. Check out `scaleReads` option.

<a name="1.15.1"></a>
# [1.15.1](https://github.com/luin/ioredis/compare/v1.15.0...v1.15.1) (2016-02-19)
* select db on connect event to prevent subscribe errors ([829bf26](https://github.com/luin/ioredis/commit/829bf26)), closes [#255](https://github.com/luin/ioredis/issues/255)

<a name="1.15.0"></a>
# [1.15.0](https://github.com/luin/ioredis/compare/v1.14.0...v1.15.0) (2016-01-31)


### Bug Fixes

* "MOVED" err not crashing process when slot was not assigned ([6974d4d](https://github.com/luin/ioredis/commit/6974d4d))
* remove extra typeof in .to cluster helper ([a7b0bfe](https://github.com/luin/ioredis/commit/a7b0bfe))

### Features

* revisit of .to(nodeGroup) command ([ba12e47](https://github.com/luin/ioredis/commit/ba12e47))



## v1.14.0 - January 4, 2016

* Support returning buffers for transactions ([#223](https://github.com/luin/ioredis/issues/223)).

## v1.13.2 - December 30, 2015

* Add argument transformer for msetnx to support Map ([#218](https://github.com/luin/ioredis/issues/218)).

## v1.13.1 - December 20, 2015

* Fix `mset` transformer not supporting keyPrefix ([#217](https://github.com/luin/ioredis/issues/217)).

## v1.13.0 - December 13, 2015

* [Cluster] Select a random node when the target node is closed.
* [Cluster] `maxRedirections` also works for `CLUSTERDOWN`.

## v1.12.2 - December 6, 2015

* [Cluster] Fix failover queue not being processed. [Shahar Mor](https://github.com/shaharmor).

## v1.12.1 - December 5, 2015

* [Cluster] Add queue support for failover and CLUSTERDOWN handling. [Shahar Mor](https://github.com/shaharmor).
* Emits "error" when connection is down for `scanStream` ([#199](https://github.com/luin/ioredis/issues/199)).

## v1.11.1 - November 26, 2015

* [Sentinel] Emits "error" when all sentinels are unreachable ([#200](https://github.com/luin/ioredis/issues/200)).

## v1.11.0 - November 19, 2015

* Emits "select" event when the database changed.
* [Cluster] Supports scanStream ([#175](https://github.com/luin/ioredis/issues/175)).
* Update debug module to 2.2.0
* Update bluebird module to 2.9.34

## v1.10.0 - October 24, 2015

* [Cluster] Support redis schema url.
* [Cluster] Support specifying password for each node.
* Add an option for setting connection name. [cgiovanacci](https://github.com/cgiovanacci).
* Switch to the previous db before re-subscribing channels.
* Listen to the "secureConnect" event when connect via TLS. [Jeffrey Jen](https://github.com/jeffjen).
* Improve parser performance.

## v1.9.1 - October 2, 2015

* Emits "authError" event when the password is wrong([#164](https://github.com/luin/ioredis/issues/164)).
* Fixed wrong debug output when using sentinels. [Colm Hally](https://github.com/ColmHally)
* Discard slave if flagged with s_down or o_down. [mtlima](https://github.com/mtlima)

## v1.9.0 - September 18, 2015

* Support TLS.
* Support reconnecting on the specified error.

## v1.8.0 - September 9, 2015

* Add keepAlive option(defaults to `true`).
* Fix compatible issues of Buffer with Node.js 4.0.

## v1.7.6 - September 1, 2015

* Fix errors when sending command to a failed cluster([#56](https://github.com/luin/ioredis/issues/56)).

## v1.7.5 - August 16, 2015

* Fix for allNodes array containing nodes not serving the specified slot. [henstock](https://github.com/henstock)

## v1.7.4 - August 13, 2015

* Restore the previous state before resending the unfulfilled commands. [Jay Merrifield](https://github.com/fracmak)
* Fix empty pipeline not resolving as empty array. [Philip Kannegaard Hayes](https://github.com/phlip9)

## v1.7.3 - August 3, 2015

* Handle watch-exec rollback correctly([#199](https://github.com/luin/ioredis/pull/119)). [Andrew Newdigate](https://github.com/suprememoocow)

## v1.7.2 - July 30, 2015

* Fix not running callback in pipeline custom command([#117](https://github.com/luin/ioredis/pull/117)). [Philip Kannegaard Hayes](https://github.com/phlip9)
* Fixes status debug message in case of Unix socket path([#114](https://github.com/luin/ioredis/pull/114)). [Thalis Kalfigkopoulos](https://github.com/tkalfigo)

## v1.7.1 - July 26, 2015

* Re-subscribe previous channels after reconnection([#110](https://github.com/luin/ioredis/pull/110)).

## v1.7.0 - July 23, 2015

* Support transparent key prefixing([#105](https://github.com/luin/ioredis/pull/105)). [Danny Guo](https://github.com/dguo)

## v1.6.1 - July 12, 2015

* Fix `Redis.Command` not being exported correctly([#100](https://github.com/luin/ioredis/issues/100)).

## v1.6.0 - July 11, 2015

* Add a streaming interface to `SCAN` commands.
* Support GEO commands.

## v1.5.12 - July 7, 2015

* Fix the order of received commands([#91](https://github.com/luin/ioredis/issues/91)).

## v1.5.11 - July 7, 2015

* Allow omitting callback in `exec`.

## v1.5.10 - July 6, 2015

* Add `send_command` method for compatibility([#90](https://github.com/luin/ioredis/issues/90)).

## v1.5.9 - July 4, 2015

* Fix connection error emitting before listening to `error` event([#80](https://github.com/luin/ioredis/issues/80)).

## v1.5.8 - July 3, 2015

* Fix `pmessage` gets `undefined` in cluster mode([#88](https://github.com/luin/ioredis/issues/88)). [Kris Linquist](https://github.com/klinquist)

## v1.5.7 - July 1, 2015

* Fix subscriptions lost after reconnection([#85](https://github.com/luin/ioredis/issues/85)).

## v1.5.6 - June 28, 2015

* Silent error when redis server has cluster support disabled([#82](https://github.com/luin/ioredis/issues/82)).

## v1.5.5 - June 25, 2015

* Fix storing wrong redis host internally.

## v1.5.4 - June 25, 2015

* Fix masterNodes not being removed correctly.

## v1.5.3 - June 24, 2015

* Fix sometimes monitor leads command queue error.

## v1.5.2 - June 24, 2015

* Fix `enableReadyCheck` is always `false` in monitor mode([#77](https://github.com/luin/ioredis/issues/77)).

## v1.5.1 - June 16, 2015

* Fix getting NaN db index([#74](https://github.com/luin/ioredis/issues/74)).

## v1.5.0 - June 13, 2015

* Uses double ended queue instead of Array for better performance.
* Resolves a bug with cluster where a subscribe is sent to a disconnected node([#63](https://github.com/luin/ioredis/pull/63)). [Ari Aosved](https://github.com/devaos).
* Adds ReadOnly mode for Cluster mode([#69](https://github.com/luin/ioredis/pull/69)). [Nakul Ganesh](https://github.com/luin/ioredis/pull/69).
* Adds `Redis.print`([#71](https://github.com/luin/ioredis/pull/71)). [Frank Murphy](https://github.com/frankvm04).

## v1.4.0 - June 3, 2015

* Continue monitoring after reconnection([#52](https://github.com/luin/ioredis/issues/52)).
* Support pub/sub in Cluster mode([#54](https://github.com/luin/ioredis/issues/54)).
* Auto-reconnect when none of startup nodes is ready([#56](https://github.com/luin/ioredis/issues/56)).

## v1.3.6 - May 22, 2015

* Support Node.js 0.10.16
* Fix unfulfilled commands being sent to the wrong db([#42](https://github.com/luin/ioredis/issues/42)).

## v1.3.5 - May 21, 2015

* Fix possible memory leak warning of Cluster.
* Stop reconnecting when disconnected manually.

## v1.3.4 - May 21, 2015

* Add missing Promise definition in node 0.10.x.

## v1.3.3 - May 19, 2015

* Fix possible memory leak warning.

## v1.3.2 - May 18, 2015

* The constructor of `pipeline`/`multi` accepts a batch of commands.

## v1.3.1 - May 16, 2015

* Improve the performance of sending commands([#35](https://github.com/luin/ioredis/issues/35)). [@AVVS](https://github.com/AVVS).

## v1.3.0 - May 15, 2015

* Support pipeline redirection in Cluster mode.

## v1.2.7 - May 15, 2015

* `Redis#connect` returns a promise.

## v1.2.6 - May 13, 2015

* Fix showFriendlyErrorStack not working in pipeline.

## v1.2.5 - May 12, 2015

* Fix errors when sending commands after connection being closed.

## v1.2.4 - May 9, 2015

* Try a random node when the target slot isn't served by the cluster.
* Remove `refreshAfterFails` option.
* Try random node when refresh slots.

## v1.2.3 - May 9, 2015

* Fix errors when `numberOfKeys` is `0`.

## v1.2.2 - May 8, 2015

* Add `retryDelayOnClusterDown` option to handle CLUSTERDOWN error.
* Fix `multi` commands sometimes doesn't return a promise.

## v1.2.1 - May 7, 2015

* Fix `sendCommand` sometimes doesn't return a promise.

## v1.2.0 - May 4, 2015

* Add `autoResendUnfulfilledCommands` option.

## v1.1.4 - May 3, 2015

* Support get built-in commands.

## v1.1.3 - May 2, 2015

* Fix buffer supporting in pipeline. [@AVVS](https://github.com/AVVS).

## v1.1.2 - May 2, 2015

* Fix error of sending command to wrong node when slot is 0.

## v1.1.1 - May 2, 2015

* Support Transaction and pipelining in cluster mode.

## v1.1.0 - May 1, 2015

* Support cluster auto reconnection.
* Add `maxRedirections` option to Cluster.
* Remove `roleRetryDelay` option in favor of `sentinelRetryStrategy`.
* Improve compatibility with node_redis.
* More stable sentinel connection.

## v1.0.13 - April 27, 2015

* Support SORT, ZUNIONSTORE and ZINTERSTORE in Cluster.

## v1.0.12 - April 27, 2015

* Support for defining custom commands in Cluster.
* Use native array instead of fastqueue for better performance.

## v1.0.11 - April 26, 2015

* Add `showFriendlyErrorStack` option for outputing friendly error stack.

## v1.0.10 - April 25, 2015

* Improve performance for calculating slots.

## v1.0.9 - April 25, 2015

* Support single node commands in cluster mode.

## v1.0.8 - April 25, 2015

* Add promise supports in Cluster.

## v1.0.7 - April 25, 2015

* Add `autoResubscribe` option to prevent auto re-subscribe.
* Add `Redis#end` for compatibility.
* Add `Redis.createClient`(was `Redis#createClient`).

## v1.0.6 - April 24, 2015

* Support setting connect timeout.
