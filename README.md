ioredis
========

[![Build Status](https://travis-ci.org/luin/ioredis.png?branch=master)](https://travis-ci.org/luin/ioredis)
[![Dependency Status](https://david-dm.org/luin/ioredis.svg)](https://david-dm.org/luin/ioredis)
[![Join the chat at https://gitter.im/luin/ioredis](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/luin/ioredis?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

**[Work In Progress]** A delightful, performance-focused Redis client for Node and io.js

Support Redis >= 2.6.12 and (Node.js >= 0.11.6 or io.js).

Feature
------
ioredis is a robust, full-featured Redis client
used in the biggest online commerce company [Alibaba](http://www.alibaba.com/).

0. Full-featured. It supports [Cluster](http://redis.io/topics/cluster-tutorial), [Sentinel](redis.io/topics/sentinel), [Pipelining](http://redis.io/topics/pipelining) and of course [Lua scripting](http://redis.io/commands/eval) & [Pub/Sub](http://redis.io/topics/pubsub)
0. High performance.
0. Delightful API supports both Node-style callback and Promise.
0. Supports Redis commands transforming.
0. Abstraction for Transaction, Lua scripting and `SCAN`, `SSCAN`, `ZSCAN`, `HSCAN`.
0. Supports binary data.
0. Support for both TCP/IP and UNIX domain sockets.
0. Flexible system for defining custom command and registering command plugins.
0. Supports offine queue and ready checking.
0. Supports ES6 types such as `Map` and `Set`.

Instal
------

```shell
$ npm install ioredis
```

Basic Usage
------

```javascript
var Redis = require('ioredis');
var redis = new Redis();

redis.set('foo', 'bar');
redis.get('foo', function (err, result) {
  console.log(result);
});

// or using promise if the last argument isn't a function
redis.get('foo').then(function (result) {
  console.log(result);
});

// Arguments will be flatten, so both the following two line are same:
redis.sadd('set', 1, 3, 5, 7);
redis.sadd('set', [1, 3, 5, 7]);
```

Connect to Redis
----------------
When a new `Redis` instance is created,
a connection to Redis will be created at the same time.

You can specify which Redis to connect by:

```javascript
new Redis()       // Will connect to 127.0.0.1:6379
new Redis(6380)   // 127.0.0.1:6380
new Redis(6379, '192.168.1.1')        // 192.168.1.1:6379
new Redis('redis://127.0.0.1:6380')   // 127.0.0.1:6380
new Redis('/tmp/redis.sock')
new Redis({
  port: 6379          // Redis port
  host: '127.0.0.1'   // Redis host
  family: 4           // 4(IPv4) or 6(IPv6)
})
```

Pub/Sub
-------

Here is a simple example of the API for publish / subscribe.
This program opens two client connections, subscribes to a channel on one of them,
and publishes to that channel on the other:

```javascript
var Redis = require('ioredis');
var redis = new Redis();
var pub = new Redis();
redis.subscribe('news', 'music', function (err, count) {
  // Now both channel 'news' and 'music' are subscribed successfully.
  // `count` arg represents the number of channels we are currently subscribed to.

  pub.publish('news', 'Hello world!');
  pub.publish('music', 'Hello again!');
});

redis.on('message', function (channel, message) {
  // Receive message Hello world! from channel news
  // Receive message Hello again! from channel music
  console.log('Receive message %s from channel %s', message, channel);
});

// There's also a event called 'messageBuffer', which is same to 'message' except
// return buffers instead of strings.
redis.on('messageBuffer', function (channel, message) {
  // Both `channel` and `message` are buffers.
});
```
When a client issues a SUBSCRIBE or PSUBSCRIBE, that connection is put into a "subscriber" mode.
At that point, only commands that modify the subscription set are valid.
When the subscription set is empty, the connection is put back into regular mode.

If you need to send regular commands to Redis while in subscriber mode, just open another connection.

Handle Binary Data
------------
Arguments can be buffers:
```javascript
redis.set('foo', new Buffer('bar'));
```

And every command has a buffer method(by adding a suffix of "Buffer" to the command name)
to reply a buffer instead of a utf8 string:

```javascript
redis.getBuffer('foo', function (err, result) {
  // result is a buffer.
});
```

Motivation
----------------------

Firstly we used the Redis client [node_redis](https://github.com/mranney/node_redis),
however over a period of time we found out it's not robust enough for us to use
in the production environment. The library has some not trivial bugs and many unresolved
issues in the GitHub(165 so far), for instance:

```javascript
var redis = require('redis');
var client = redis.createClient();

client.set('foo', 'message');
client.set('bar', 'Hello world');
client.mget('foo', 'bar');

client.subscribe('channel');
client.on('message', function (msg) {
  // Will print "Hello world", although no `publish` in invoked.
  console.log('received ', msg);
});
```

I submited some pull requests but sadly none of them has been merged, so here ioredis is.
