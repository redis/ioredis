# ioredis

[![Build Status](https://travis-ci.org/luin/ioredis.png?branch=master)](https://travis-ci.org/luin/ioredis)
[![Test Coverage](https://codeclimate.com/github/luin/ioredis/badges/coverage.svg)](https://codeclimate.com/github/luin/ioredis)
[![Dependency Status](https://david-dm.org/luin/ioredis.svg)](https://david-dm.org/luin/ioredis)
[![Join the chat at https://gitter.im/luin/ioredis](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/luin/ioredis?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

A delightful, performance-focused Redis client for Node and io.js

Support Redis >= 2.6.12 and (Node.js >= 0.11.13 or io.js).

# Feature
ioredis is a robust, full-featured Redis client
used in the world's biggest online commerce company [Alibaba](http://www.alibaba.com/).

0. Full-featured. It supports [Cluster](http://redis.io/topics/cluster-tutorial), [Sentinel](redis.io/topics/sentinel), [Pipelining](http://redis.io/topics/pipelining) and of course [Lua scripting](http://redis.io/commands/eval) & [Pub/Sub](http://redis.io/topics/pubsub)(with the support of binary messages).
0. High performance.
0. Delightful API. Supports both Node-style callbacks and promises.
0. Supports command arguments and replies transform.
0. Abstraction for Lua scripting, allowing you to define custom commands.
0. Support for binary data.
0. Support for both TCP/IP and UNIX domain sockets.
0. Supports offline queue and ready checking.
0. Supports ES6 types such as `Map` and `Set`.
0. Sophisticated error handling strategy.

<hr>

# Links
[API Documentation](API.md)

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

// Arguments to commands are flatten, so the following are same:
redis.sadd('set', 1, 3, 5, 7);
redis.sadd('set', [1, 3, 5, 7]);
```

## Connect to Redis
When a new `Redis` instance is created,
a connection to Redis will be created at the same time.
You can specify which Redis to connect to by:

```javascript
new Redis()       // Connect to 127.0.0.1:6379
new Redis(6380)   // 127.0.0.1:6380
new Redis(6379, '192.168.1.1')        // 192.168.1.1:6379
new Redis('redis://:authpassword@127.0.0.1:6380/4')   // 127.0.0.1:6380, db 4
new Redis('/tmp/redis.sock')
new Redis({
  port: 6379,          // Redis port
  host: '127.0.0.1',   // Redis host
  family: 4,           // 4(IPv4) or 6(IPv6)
  password: 'auth'
  db: 0
})
```

## Pub/Sub

Here is a simple example of the API for publish / subscribe.
This program opens two client connections. It subscribes to a channel with one connection,
and publishes to that channel with the other:

```javascript
var Redis = require('ioredis');
var redis = new Redis();
var pub = new Redis();
redis.subscribe('news', 'music', function (err, count) {
  // Now both channel 'news' and 'music' are subscribed successfully.
  // `count` represents the number of channels we are currently subscribed to.

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

And every command has a method that returns a Buffer (by adding a suffix of "Buffer" to the command name).
To get a buffer instead of a utf8 string:

```javascript
redis.getBuffer('foo', function (err, result) {
  // result is a buffer.
});
```

## Pipelining
If you want to send a batch of commands(e.g. > 100), you can use pipelining to queue
the commands in the memory, then send them to Redis all at once. This way the performance improves by 50%~300%.

`redis.pipeline()` creates a `Pipeline` instance. You can call any Redis
commands on it just like the `Redis` instance. The commands are queued in the memory
and flushed to Redis by calling `exec` method:

```javascript
var pipeline = redis.pipeline();
pipeline.set('foo', 'bar');
pipeline.del('cc');
pipeline.exec(function (err, results) {
  // `err` is always null, and `results` is an array of responses
  // corresponding the sequence the commands where queued.
  // Each response follows the format `[err, result]`.
});

// You can even chain the commands:
redis.pipeline().set('foo', 'bar').del('cc').exec(function (err, results) {
});

// `exec` also returns a Promise:
var promise = redis.pipeline().set('foo', 'bar').get('foo').exec();
promise.then(function (result) {
  // result === [[null, 'OK'], [null, 'bar']]
});
```

Each chained command can also have a callback, which will be invoked when the command
get a reply:

```javascript
redis.pipeline().set('foo', 'bar').get('foo', function (err, result) {
  // result === 'bar'
}).exec(function (err, result) {
  // result[1][1] === 'bar'
});
```

## Transaction
Most of the time the transaction commands `multi` & `exec` are used together with pipeline.
Therefore by default when `multi` is called, a `Pipeline` instance is created automatically,
so that you can use `multi` just like `pipeline`:

```javascript
redis.multi().set('foo', 'bar').get('foo').exec(function (err, results) {
  // results === [[null, 'OK'], [null, 'bar']]
});
```
If there's a syntax error in the transaction's command chain (e.g. wrong number of arguments, wrong command name, etc),
then none of the commands would be executed, and an error is returned:

```javascript
redis.multi().set('foo').set('foo', 'new value').exec(function (err, results) {
  // err === new Error('...Transaction discarded because of previous errors.');
});
```

In terms of the interface, `multi` differs from `pipeline` in that when specifying a callback
to each chained command, the queueing state is passed to the callback instead of the result of the command:

```javascript
redis.multi().set('foo', 'bar', function (err, result) {
  // result === 'QUEUED'
}).exec(/* ... */);
```

If you want to use transaction without pipeline, pass { pipeline: false } to `multi`,
and every command would be sent to Redis immediately without waiting for an `exec` invokation:

```javascript
redis.multi({ pipeline: false });
redis.set('foo', 'bar');
redis.get('foo');
redis.exec(function (err, result) {
  // result === [[null, 'OK'], [null, 'bar']]
});
```

Inline transaction is supported by pipeline, that means you can group a subset commands
in the pipeline into a transaction:

```javascript
redis.pipeline().get('foo').mulit().set('foo', 'bar').get('foo').exec().get('foo').exec();
```

## Arguments & Replies Transform
Most Redis commands take one or more Strings as arguments,
and replies are sent back as a single String or an Array of Strings. However sometimes
you may want something different: For instance it would be more convenient if HGETALL
command returns a hash (e.g. `{key: val1, key2: v2}`) rather than an array of key values (e.g. `[key1,val1,key2,val2]`).

ioredis has a flexible system for transforming arguments and replies. There are two types
of transformers, argument transform and reply transformer:

```javascript
var Redis = require('ioredis');

// define a argument transformer that convert
// hmset('key', { k1: 'v1', k2: 'v2' })
// or
// hmset('key', new Map([['k1', 'v1'], ['k2', 'v2']]))
// into
// hmset('key', 'k1', 'v1', 'k2', 'v2')
Redis.Command.setArgumentTransformer('hmset', function (args) {
  if (args.length === 2) {
    if (typeof Map !== 'undefined' && args[1] instanceof Map) {
      return [args[0]].concat(utils.convertMapToArray(args[1]));
    }
    if ( typeof args[1] === 'object' && args[1] !== null) {
      return [args[0]].concat(utils.convertObjectToArray(args[1]));
    }
  }
  return args;
});

// define a reply transformer that convert the reply
// ['k1', 'v1', 'k2', 'v2']
// into
// { k1: 'v1', 'k2': 'v2' }
Redis.Command.setReplyTransformer('hgetall', function (result) {
  if (Array.isArray(result)) {
    var obj = {};
    for (var i = 0; i < result.length; i += 2) {
      obj[result[i]] = result[i + 1];
    }
    return obj;
  }
  return result;
});
```

There are three built-in transformers, two argument transformers for `hmset` & `mset` and
a reply transformer for `hgetall`. Transformers for `hmset` and `hgetall` has been mentioned
above, and the transformer for `mset` is similar to the one for `hmset`:

```javascript
redis.mset({ k1: 'v1', k2: 'v2' });
redis.get('k1', function (err, result) {
  // result === 'v1';
});

redis.mset(new Map([['k3', 'v3'], ['k4', 'v4']]));
redis.get('k3', function (err, result) {
  // result === 'v3';
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
redis.echoBuffer('k1', 'k2', 'a1', 'a2', function (err, result) {
  // result[0] === new Buffer('k1');
});

// And of course it works with pipeline:
redis.pipeline().set('foo', 'bar').echo('k1', 'k2', 'a1', 'a2').exec();
```

If the number of keys can't be determined when defining a command, you can
omit the `numberOfKeys` property, and pass the number of keys as the first argument
when you call the command:

```javascript
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

The `monitor` method returns a monitor instance.
After you send the MONITOR command, no other commands are valid on that connection. ioredis would emit a monitor event for every new monitor message that comes across.
The callback for the monitor event takes a timestamp from the Redis server and an array of command arguments.

Here is a simple example:

```javascript
redis.monitor(function (err, monitor) {
  monitor.on('monitor', function (time, args) {
  });
});
```

## Auto-reconnect
By default, ioredis will try to reconnect when the connection to Redis is lost
except when the connection is closed manually by `redis.disconnect()` or `redis.quit()`.

It's very flexible to control how long to wait to reconnect after disconnected
using the `retryStrategy` option:

```javascript
var redis = new Redis({
  // This is the default value of `retryStrategy`
  retryStrategy: function (times) {
    var delay = Math.min(times * 2, 2000);
    return delay;
  }
});
```

`retryStrategy` is a function that will be called when the connection is lost.
The argument `times` represents this is the nth reconnection being made and
the return value represents how long(ms) to wait to reconnect. When the
return value isn't a number, ioredis will stop trying reconnecting and the connection
will be lost forever if user don't call `redis.connect()` manually.

## Offline Queue
When a command can't be processed by Redis(e.g. the connection hasn't been established or
Redis is loading data from disk), by default it's added to the offline queue and will be
executed when it can be processed. You can disable this feature by set `enableOfflineQueue`
option to `false`:

```javascript
var redis = new Redis({ enableOfflineQueue: false });
```

## Sentinel
ioredis supports Sentinel out of the box. It works transparently as all features that work when
you connect to a single node also work when you connect to a sentinel group. Make sure to run Redis 2.8+ if you want to use this feature.

To connect using Sentinel, use:

```javascript
var redis = new Redis({
  sentinels: [{ host: 'localhost', port: 26379 }, { host: 'localhost', port: 26380 }],
  name: 'mymaster'
});

redis.set('foo', 'bar');
```

The arguments passed to the constructor are different from ones you used to connect to a single node, where:

* `name` identifies a group of Redis instances composed of a master and one or more slaves (`mymaster` in the example);
* `sentinels` are a list of sentinels to connect to. The list does not need to enumerate all your sentinel instances, but a few so that if one is down the client will try the next one.

ioredis **guarantees** that the node you connected with is always a master even after a failover. When a failover happens, instead of trying to reconnect with the failed node(which will be demoted to slave when it's available again), ioredis will ask sentinels for the new master node and connect to it. All commands sent during the failover are queued and will be executed when the new connection is established so that none of the commands will be lost.

It's possible to connect to a slave instead of a master by specifying the option `role` with the value of `slave`, and ioredis will try to connect to a random slave of the specified master, with the guarantee that the connected node is always a slave. If the current node is promoted to master owing to a failover, ioredis will disconnect with it and ask sentinels for another slave node to connect to.

## Cluster
Support for Cluster is currently experimental. It's not recommended to use it in production.
If you encounter any problems, welcome to submit an issue :-).

You can connect to a cluster like this:

```javascript
var Redis = require('ioredis');

var cluster = new Redis.Cluster([{
  port: 6380,
  host: '127.0.0.1'
}, {
  port: 6381,
  host: '127.0.0.1'
}]);

cluster.set('foo', 'bar');
cluster.get('foo', function (err, res) {
  // res === 'bar'
});
```
When using `Redis.Cluster` to connect to a cluster, there are some differences from using `Redis`:

0. The argument is a list of nodes of the cluster you want to connect.
Just like Sentinel, the list does not need to enumerate all your cluster nodes,
but a few so that if one is down the client will try the next one, and the client will discover other nodes automatically when at least one node is connnected.
0. Some comands can't be used in the cluster mode, e.g. `info` and `pipeline`, custom commands also don't work(currently).

## hiredis
If [hiredis](https://github.com/redis/hiredis-node) is installed(by `npm install hiredis`),
ioredis will use it by default. Otherwise, a pure JavaScript parser will be used.
Typically there's not much differences between them in terms of performance.

<hr>

# Benchmark

Compares with [node_redis](https://github.com/mranney/node_redis):

```shell
> npm run bench
                   simple set
       65,438 op/s » ioredis
       36,954 op/s » node_redis

                   simple get
       71,109 op/s » ioredis
       36,825 op/s » node_redis

                   simple get with pipeline
       11,123 op/s » ioredis
        3,820 op/s » node_redis

                   lrange 100
       58,812 op/s » ioredis
       46,703 op/s » node_redis


  Suites:  4
  Benches: 8
  Elapsed: 61,715.11 ms
```

You can find the code at `benchmark.js`.

# Motivation

Originally we used the Redis client [node_redis](https://github.com/mranney/node_redis),
but over a period of time we found that it's not robust enough for us to use
in our production environment. The library has some non-trivial bugs and many unresolved
issues on the GitHub(165 so far). For instance:

```javascript
var redis = require('redis');
var client = redis.createClient();

client.set('foo', 'message');
client.set('bar', 'Hello world');
client.mget('foo', 'bar');

client.subscribe('channel');
client.on('message', function (msg) {
  // Will print "Hello world", although no `publish` is invoked.
  console.log('received ', msg);
});
```

I submitted some pull requests but sadly none of them has been merged, so here's ioredis.

# Acknowledge

The JavaScript and hiredis parsers are modified from [node_redis](https://github.com/mranney/node_redis) (MIT License, Copyright (c) 2010 Matthew Ranney, http://ranney.com/).

# License

MIT
