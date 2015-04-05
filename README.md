# ioredis

[![Build Status](https://travis-ci.org/luin/ioredis.png?branch=master)](https://travis-ci.org/luin/ioredis)
[![Dependency Status](https://david-dm.org/luin/ioredis.svg)](https://david-dm.org/luin/ioredis)
[![Join the chat at https://gitter.im/luin/ioredis](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/luin/ioredis?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

**[Work In Progress]** A delightful, performance-focused Redis client for Node and io.js

Support Redis >= 2.6.12 and (Node.js >= 0.11.6 or io.js).

# Feature
ioredis is a robust, full-featured Redis client
used in the biggest online commerce company [Alibaba](http://www.alibaba.com/).

0. Full-featured. It supports [Cluster](http://redis.io/topics/cluster-tutorial), [Sentinel](redis.io/topics/sentinel), [Pipelining](http://redis.io/topics/pipelining) and of course [Lua scripting](http://redis.io/commands/eval) & [Pub/Sub](http://redis.io/topics/pubsub)(with the support of binary messages).
0. High performance.
0. Delightful API both accept node-style callbacks and return promises.
0. Supports Redis commands transforming.
0. Abstraction for Lua scripting alowing you to define custom commands.
0. Supports binary data.
0. Support for both TCP/IP and UNIX domain sockets.
0. Flexible system for defining custom command and registering command plugins.
0. Supports offine queue and ready checking.
0. Supports ES6 types such as `Map` and `Set`.
0. Sophisticated error handling strategy.

<hr>

# Quick Start

## Install
```shell
$ npm install ioredis
```

## Basic Usage

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

## Connect to Redis
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

## Pub/Sub

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
// it returns buffers instead of strings.
redis.on('messageBuffer', function (channel, message) {
  // Both `channel` and `message` are buffers.
});
```
When a client issues a SUBSCRIBE or PSUBSCRIBE, that connection is put into a "subscriber" mode.
At that point, only commands that modify the subscription set are valid.
When the subscription set is empty, the connection is put back into regular mode.

If you need to send regular commands to Redis while in subscriber mode, just open another connection.

## Handle Binary Data
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

## Pipelining
If you want to send a batch of commands(e.g. > 100), you can use pipelining to queue
the commands in the memory and send them to Redis at once. By this way, performance will be improved by 50%~300%.

`redis.pipeline()` creates a `Pipeline` instance, and then you can call any Redis
commands on it just like the `Redis` instance. The commands will be queued in the memory,
and once you want to send them to Redis, call `exec` method.

```javascript
var pipeline = redis.pipeline();
pipeline.set('foo', 'bar');
pipeline.del('cc');
pipeline.exec(function (err, results) {
  // `err` is always null, and `results` is an array of responses corresponding the sequence the commands where queued.
  // Each response follows the format `[err, result]`.
});

// You can even chain the commands:
redis.pipeline().set('foo', 'bar').del('cc').exec(function (err, results) {
});

// `exec` will also return a Promise:
var promise = redis.pipeline().set('foo', 'bar').get('foo').exec();
promise.then(function (result) {
  // result === [[null, 'OK'], [null, 'bar']]
});

// each command can also have a callback:
redis.pipeline().set('foo', 'bar').get('foo', function (err, result) {
  // result === 'bar'
}).exec(function (err, result) {
  // result[1][1] === 'bar'
});

```

## Transaction
Most of the time transaction commands `multi`/`exec` are used together with pipeline.
Therefore by default when `multi` is called, a `Pipeline` instance is created automatically,
so that you can use `multi` just like `pipeline`:

```javascript
redis.multi().set('foo', 'bar').get('foo').exec(function (err, results) {
  // results === [[null, 'OK'], [null, 'bar']]
});
```
If there's a syntactically error in the transaction's command chain(wrong number of arguments, wrong command name, ...),
none of the commands will be executed and an error is returned:

```javascript
redis.multi().set('foo').set('foo', 'new value').exec(function (err, results) {
  // err === new Error('...Transaction discarded because of previous errors.');
});
```

In terms of the interface, `multi` differs from `pipeline` in that when specify a callback
to each chained command, the queueing state will be returned instead of the result of the command:

```javascript
redis.multi().set('foo', 'bar', function (err, result) {
  // result === 'QUEUED'
}).exec(/* ... */);
```

If you want to use transaction without pipeline, just pass { pipeline: false } to `multi`,
and every command will be sent to Redis immediately without waiting `exec` invoked:

```javascript
redis.multi({ pipeline: false });
redis.set('foo', 'bar');
redis.get('foo');
redis.exec(function (err, result) {
  // result === [[null, 'OK'], [null, 'bar']]
});
```

## Lua Scripting
ioredis supports all of the scripting commands such as `EVAL`, `EVALSHA` and `SCRIPT`.
However it's tedious to use in real world scenarios since developers have to take
care of script caching and to detect when to use `EVAL` and when to use `EVALSHA`.
ioredis expose a `defineCommand` method to make scripting much easier to use:

```javascript
var redis = new Redis();

// This will define a command echo:
redis.defineCommand('echo', {
  numberOfKeys: 2,
  lua: 'return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}'
});

// Now `echo` can be used just like any other ordinary commands,
// and ioredis will try to use `EVALSHA` internally when possible for better performance.
redis.echo('k1', 'k2', 'a1', 'a2', function (err, result) {
  // result === ['k1', 'k2', 'a1', 'a2']
});

// `echoBuffer` is also defined automatically to return buffers instead of strings:
redis.echoBuffer('k1', 'k2', 'a1', 'a2', function (err, result) {});

// And of course it can also be used with pipeline:
redis.pipeline().set('foo', 'bar').echo('k1', 'k2', 'a1', 'a2').exec();

// If the number of keys can't be determined when define a command, you can just
// omit the `numberOfKeys` property, and the first argument will represents the
// number of keys every time the custom command is invoked:
redis.defineCommand('echoDynamicKeyNumber', {
  lua: 'return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}'
});

// Now you have to pass the number of keys as the first argument every time
// you invoke the `echoDynamicKeyNumber` command:
redis.echoDynamicKeyNumber(2, 'k1', 'k2', 'a1', 'a2', function (err, result) {
  // result === ['k1', 'k2', 'a1', 'a2']
});
```

## Monitor
Redis supports the MONITOR command,
which lets you see all commands received by the Redis server across all client connections,
including from other client libraries and other computers.

The `monitor` method will return a monitor instance
After you send the MONITOR command, no other commands are valid on that connection. ioredis will emit a monitor event for every new monitor message that comes across.
The callback for the monitor event takes a timestamp from the Redis server and an array of command arguments.

Here is a simple example:

```javascript
redis.monitor(function (err, monitor) {
  monitor.on('monitor', function (time, args) {
  });
});
```

<hr>

# Motivation

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
