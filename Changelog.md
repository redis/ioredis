## Changelog

### Master Branch

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
