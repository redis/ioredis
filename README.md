# ioredis

[![Build Status](https://travis-ci.org/luin/ioredis.svg?branch=master)](https://travis-ci.org/luin/ioredis)
[![Test Coverage](https://codeclimate.com/github/luin/ioredis/badges/coverage.svg)](https://codeclimate.com/github/luin/ioredis)
[![Code Climate](https://codeclimate.com/github/luin/ioredis/badges/gpa.svg)](https://codeclimate.com/github/luin/ioredis)
[![Dependency Status](https://david-dm.org/luin/ioredis.svg)](https://david-dm.org/luin/ioredis)
[![Join the chat at https://gitter.im/luin/ioredis](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/luin/ioredis?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

A delightful, performance-focused Redis client for Node and io.js

Support Redis >= 2.6.12 and (Node.js >= 0.10.16 or io.js).

# Feature
ioredis is a robust, full-featured Redis client
used in the world's biggest online commerce company [Alibaba](http://www.alibaba.com/).

0. Full-featured. It supports [Cluster](http://redis.io/topics/cluster-tutorial), [Sentinel](redis.io/topics/sentinel), [Pipelining](http://redis.io/topics/pipelining) and of course [Lua scripting](http://redis.io/commands/eval) & [Pub/Sub](http://redis.io/topics/pubsub)(with the support of binary messages).
0. High performance.
0. Delightful API. Supports both Node-style callbacks and [promises](https://github.com/petkaantonov/bluebird).
0. Supports command arguments and replies transform.
0. Abstraction for Lua scripting, allowing you to define custom commands.
0. Support for binary data.
0. Support for both TCP/IP and UNIX domain sockets.
0. Supports offline queue and ready checking.
0. Supports ES6 types such as `Map` and `Set`.
0. Sophisticated error handling strategy.

<hr>

# Links
* [API Documentation](API.md)
* [Changelog](Changelog.md)
* [Migrating from node_redis](https://github.com/luin/ioredis/wiki/Migrating-from-node_redis)
* [Error Handling](#error-handling)
* [Benchmark](#benchmark)

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

See [API Documentation](API.md#new_Redis) for all available options.

## Pub/Sub

Here is a simple example of the API for publish / subscribe.
The following program opens two client connections.
It subscribes to a channel with one connection,
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

`PSUBSCRIBE` is also supported in a similar way:

```javascript
redis.psubscribe('pat?ern', function (err, count) {});
redis.on('pmessage', function (pattern, channel, message) {});
redis.on('pmessageBuffer', function (pattern, channel, message) {});
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
If you want to send a batch of commands(e.g. > 5), you can use pipelining to queue
the commands in the memory, then send them to Redis all at once. This way the performance improves by 50%~300%(See [benchmark section](#benchmark)).

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

In addition to adding commands to the `pipeline` queue individually, you can also pass an array of commands and arguments to the constructor:

```javascript
redis.pipeline([
  ['set', 'foo', 'bar'],
  ['get', 'foo']
]).exec(function () { /* ... */ });
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
  // err:
  //  { [ReplyError: EXECABORT Transaction discarded because of previous errors.]
  //    name: 'ReplyError',
  //    message: 'EXECABORT Transaction discarded because of previous errors.',
  //    command: { name: 'exec', args: [] },
  //    previousErrors:
  //     [ { [ReplyError: ERR wrong number of arguments for 'set' command]
  //         name: 'ReplyError',
  //         message: 'ERR wrong number of arguments for \'set\' command',
  //         command: [Object] } ] }
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

The constructor of `multi` also accepts a batch of commands:

```javascript
redis.multi([
  ['set', 'foo', 'bar'],
  ['get', 'foo']
]).exec(function () { /* ... */ });
```

Inline transaction is supported by pipeline, that means you can group a subset commands
in the pipeline into a transaction:

```javascript
redis.pipeline().get('foo').multi().set('foo', 'bar').get('foo').exec().get('foo').exec();
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

When reconnected, client will auto subscribe channels that the previous connection has subscribed.
This behavious can be disabled by setting `autoResubscribe` option to `false`.

And if the previous connection has some unfulfilled commands(most likely are block commands such as `brpop` and `blpop`),
client will resend them when reconnected. This behavious can be disabled by setting `autoResendUnfulfilledCommands` option to `false`.

## Connection Events
Redis instance will emit some events about the state of the connection to the Redis server.

### "connect"
client will emit `connect` once a connection is established to the Redis server.

### "ready"
If `enableReadyCheck` is `true`, client will emit `ready` when the server reports that it is ready to receive commands(e.g. finish loading data from disk).
Otherwise `ready` will be emitted immediately right after the `connect` event.

### "close"
client will emit `close` when an established Redis server connection has closed.

### "reconnecting"
client will emit `reconnecting` after `close` when a reconnection would be made. The argument of the event is the time(ms) before reconnecting.

### "end"
client will emit `end` after `close` when no more reconnections would be made.

## Offline Queue
When a command can't be processed by Redis(being sent before `ready` event), by default it's added to the offline queue and will be
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

Besides `retryStrategy` option, there's also a `sentinelRetryStrategy` in Sentinel mode which will be invoked when all the sentinel nodes are unreachable during connecting. If `sentinelRetryStrategy` returns a valid delay time, ioredis will try to reconnect from scratch. The default value of `sentinelRetryStrategy` is:

```javascript
function (times) {
  var delay = Math.min(times * 10, 1000);
  return delay;
}
```

## Cluster
Redis Cluster provides a way to run a Redis installation where data is automatically sharded across multiple Redis nodes.
You can connect to a Redis Cluster like this:

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

`Cluster` constructor accepts two arguments, where:

0. The first argument is a list of nodes of the cluster you want to connect to.
Just like Sentinel, the list does not need to enumerate all your cluster nodes,
but a few so that if one is unreachable the client will try the next one, and the client will discover other nodes automatically when at least one node is connnected.
0. The second argument is the option that will be passed to the `Redis` constructor when creating connections to Redis nodes internally. There are some additional options for the Cluster:

    * `clusterRetryStrategy`: When none of the startup nodes are reachable, `clusterRetryStrategy` will be invoked. When a number is returned,
    ioredis will try to reconnect the startup nodes from scratch after the specified delay(ms). Otherwise an error of "None of startup nodes is available" will returned.
    The default value of this option is:

        ```javascript
        function (times) {
          var delay = Math.min(100 + times * 2, 2000);
          return delay;
        }
        ```

    * `maxRedirections`: When a `MOVED` or `ASK` error is received, client will redirect the
    command to another node. This option limits the max redirections allowed when sending a command. The default value is `16`.
    * `retryDelayOnFailover`: If the error of "Connection is closed." is received when sending a command,
    ioredis will retry after the specified delay. The default value is `2000`. You should make sure to let `retryDelayOnFailover * maxRedirections > cluster-node-timeout`
    in order to insure that no command will fails during a failover.
    * `retryDelayOnClusterDown`: When a cluster is down, all commands will be rejected with the error of `CLUSTERDOWN`. If this option is a number(by default is 1000), client
    will resend the commands after the specified time(ms).

### Transaction and pipeline in Cluster mode
Almost all features that are supported by `Redis` also supported by `Redis.Cluster`, e.g. custom commands, transaction and pipeline.
However there are some differences when using transaction and pipeline in Cluster mode:

0. All keys in a pipeline should belong to the same slot since ioredis sends all commands in a pipeline to the same node.
0. You can't use `multi` without pipeline(aka `cluster.multi({ pipeline: false })`). This is because when you call `cluster.multi({ pipeline: false })`, ioredis doesn't know which node should the `multi` command be sent to.
0. Chaining custom commands in the pipeline is not supported in Cluster mode.

When any commands in a pipeline receives a `MOVED` or `ASK` error, ioredis will resend the whole pipeline to the specified node automatically if all of the following conditions are satisfied:

0. All errors received in the pipeline are same. For example, we won't resend the pipeline if we got two `MOVED` error pointing to different nodes.
0. All commands executed successfully are readonly commands. This makes sure that resending the pipeline won't have side effect.

## hiredis
If [hiredis](https://github.com/redis/hiredis-node) is installed(by `npm install hiredis`),
ioredis will use it by default. Otherwise, a pure JavaScript parser will be used.
Typically there's not much differences between them in terms of performance.

<hr>

# Error Handling
All the errors returned by the Redis server are instances of `ReplyError`, which can be accessed via `Redis`:

```javascript
var Redis = require('ioredis');
var redis = new Redis();
// This command causes an reply error since SET command requires two arguments.
redis.set('foo', function (err) {
  err instanceof Redis.ReplyError
});
```

When a reply error is not handled(no callback is specified and no `catch` method is chained),
the error will be logged to the stderr. For instance:

```javascript
var Redis = require('ioredis');
var redis = new Redis();
redis.set('foo');
```

The following error will be printed:

```
Unhandled rejection ReplyError: ERR wrong number of arguments for 'set' command
    at ReplyParser._parseResult (/app/node_modules/ioredis/lib/parsers/javascript.js:60:14)
    at ReplyParser.execute (/app/node_modules/ioredis/lib/parsers/javascript.js:178:20)
    at Socket.<anonymous> (/app/node_modules/ioredis/lib/redis/event_handler.js:99:22)
    at Socket.emit (events.js:97:17)
    at readableAddChunk (_stream_readable.js:143:16)
    at Socket.Readable.push (_stream_readable.js:106:10)
    at TCP.onread (net.js:509:20)
```

But the error stack doesn't make any sense because the whole stack happens in the ioreids
module itself, not in your code. So it's not easy to find out where the error happens in your code.
ioredis provides an option `showFriendlyErrorStack` to solve the problem. When you enable
`showFriendlyErrorStack`, ioredis will optimize the error stack for you:

```javascript
var Redis = require('ioredis');
var redis = new Redis({ showFriendlyErrorStack: true });
redis.set('foo');
```

And the output will be:

```
Unhandled rejection ReplyError: ERR wrong number of arguments for 'set' command
    at Object.<anonymous> (/app/index.js:3:7)
    at Module._compile (module.js:446:26)
    at Object.Module._extensions..js (module.js:464:10)
    at Module.load (module.js:341:32)
    at Function.Module._load (module.js:296:12)
    at Function.Module.runMain (module.js:487:10)
    at startup (node.js:111:16)
    at node.js:799:3
```

This time the stack tells you that the error happens on the third line in your code, pretty sweet!
However, it would decrease the performance significantly to optimize the error stack. So by
default this option is disabled and can be only used for debug purpose. You **shouldn't** use this feature in production environment.

If you want to catch all unhandled errors without decrease performance, there's another way:

```javascript
var Redis = require('ioredis');
Redis.Promise.onPossiblyUnhandledRejection(function (error) {
  // you can log the error here.
  // error.command.name is the command name, here is 'set'
  // error.command.args is the command arguments, here is ['foo']
});
var redis = new Redis();
redis.set('foo');
```

# Benchmark

Compares with [node_redis](https://github.com/mranney/node_redis) on my laptop(MacBook Pro, Retina, 15-inch, Late 2013):

```shell
> npm run bench
==========================
ioredis: 1.3.1
node_redis: 0.12.1
CPU: 8
OS: darwin x64
==========================

                    simple set
        89,288 op/s » ioredis
        42,899 op/s » node_redis

                    simple get
        90,002 op/s » ioredis
        42,505 op/s » node_redis

                    simple get with pipeline
        12,899 op/s » ioredis
         4,332 op/s » node_redis

                    lrange 100
        65,452 op/s » ioredis
        48,121 op/s » node_redis


  Suites:  4
  Benches: 8
  Elapsed: 61,807.57 ms
```

However since there are many factors that can impact the benchmark, results may be different in your server([#25](https://github.com/luin/ioredis/issues/25)).
You can find the code at `benchmarks/*.js` and run it yourself using `npm run bench`.

# Running tests

Start a Redis server on 127.0.0.1:6379, and then:

```shell
$ npm test
```

`FLUSH ALL` will be invoked after each test, so make sure there's no valuable data in it before running tests.

# Debug

You can set the `DEBUG` env to `ioredis:*` to print debug info:

```shell
$ DEBUG=ioredis:* node app.js
```

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

# Join in!

I'm happy to receive bug reports, fixes, documentation enhancements, and any other improvements.

And since I'm not an English native speaker so if you find any grammar mistake in the documentation, please also let me know. :)

# Roadmap

* Transparent Key Prefixing
* [Distributed Lock](http://redis.io/topics/distlock)
* Connection Pooling & Read-Write Splitting

# Acknowledge

The JavaScript and hiredis parsers are modified from [node_redis](https://github.com/mranney/node_redis) (MIT License, Copyright (c) 2010 Matthew Ranney, http://ranney.com/).

# License

MIT
