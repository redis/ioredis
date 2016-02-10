[![ioredis](https://cdn.rawgit.com/luin/ioredis/57b5b89e3e9111ff25d8c62c0bc58ed42e5b8d1e/logo.svg)](https://github.com/luin/ioredis)

[![Build Status](https://travis-ci.org/luin/ioredis.svg?branch=master)](https://travis-ci.org/luin/ioredis)
[![Test Coverage](https://codeclimate.com/github/luin/ioredis/badges/coverage.svg)](https://codeclimate.com/github/luin/ioredis)
[![Code Climate](https://codeclimate.com/github/luin/ioredis/badges/gpa.svg)](https://codeclimate.com/github/luin/ioredis)
[![Dependency Status](https://david-dm.org/luin/ioredis.svg)](https://david-dm.org/luin/ioredis)
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
[![Join the chat at https://gitter.im/luin/ioredis](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/luin/ioredis?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)

A robust, performance-focused and full-featured [Redis](http://redis.io) client for [Node](https://nodejs.org) and [io.js](https://iojs.org).

Supports Redis >= 2.6.12 and (Node.js >= 0.10.16 or io.js).

# Features
ioredis is a robust, full-featured Redis client that is
used in the world's biggest online commerce company [Alibaba](http://www.alibaba.com/) and many other awesome companies.

0. Full-featured. It supports [Cluster](http://redis.io/topics/cluster-tutorial), [Sentinel](http://redis.io/topics/sentinel), [Pipelining](http://redis.io/topics/pipelining) and of course [Lua scripting](http://redis.io/commands/eval) & [Pub/Sub](http://redis.io/topics/pubsub) (with the support of binary messages).
0. High performance.
0. Delightful API. It works with Node callbacks and [Bluebird promises](https://github.com/petkaantonov/bluebird).
0. Transformation of command arguments and replies.
0. Transparent key prefixing.
0. Abstraction for Lua scripting, allowing you to define custom commands.
0. Support for binary data.
0. Support for TLS.
0. Support for offline queue and ready checking.
0. Support for ES6 types, such as `Map` and `Set`.
0. Support for GEO commands (Redis 3.2 Unstable).
0. Sophisticated error handling strategy.

# Links
* [API Documentation](API.md)
* [Changelog](Changelog.md)
* [Migrating from node_redis](https://github.com/luin/ioredis/wiki/Migrating-from-node_redis)
* [Error Handling](#error-handling)

# v2.0
v2.0 is under active development. Checkout the [2.x branch](https://github.com/luin/ioredis/pull/246) to see whether it contains the feature you need.
Use `npm install ioredis@next` to install v2.0 unstable branch.

<hr>
<a href="https://itunes.apple.com/app/medis-gui-for-redis/id1063631769"><img align="right" src="medis.png" alt="Download on the App Store"></a>

### Advertisement

Looking for a Redis GUI manager for OS X, Windows and Linux? Here's [Medis](https://github.com/luin/medis)!

Medis is an open-sourced, beautiful, easy-to-use Redis GUI management application.

Medis starts with all the basic features you need:

* Keys viewing/editing
* SSH Tunnel for connecting with remote servers
* Terminal for executing custom commands
* JSON/MessagePack format viewing/editing and built-in highlighting/validator
* And other awesome features...

[Medis is open sourced on GitHub](https://github.com/luin/medis)

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

// Or using a promise if the last argument isn't a function
redis.get('foo').then(function (result) {
  console.log(result);
});

// Arguments to commands are flattened, so the following are the same:
redis.sadd('set', 1, 3, 5, 7);
redis.sadd('set', [1, 3, 5, 7]);

// All arguments are passed directly to the redis server:
redis.set('key', 100, 'EX', 10);
```

## Connect to Redis
When a new `Redis` instance is created,
a connection to Redis will be created at the same time.
You can specify which Redis to connect to by:

```javascript
new Redis()       // Connect to 127.0.0.1:6379
new Redis(6380)   // 127.0.0.1:6380
new Redis(6379, '192.168.1.1')        // 192.168.1.1:6379
new Redis('/tmp/redis.sock')
new Redis({
  port: 6379,          // Redis port
  host: '127.0.0.1',   // Redis host
  family: 4,           // 4 (IPv4) or 6 (IPv6)
  password: 'auth',
  db: 0
})
```

You can also specify connection options as a [`redis://` URL](http://www.iana.org/assignments/uri-schemes/prov/redis):

```javascript
// Connect to 127.0.0.1:6380, db 4, using password "authpassword":
new Redis('redis://:authpassword@127.0.0.1:6380/4')
```

See [API Documentation](API.md#new_Redis) for all available options.

## Pub/Sub

Here is a simple example of the API for publish/subscribe.
The following program opens two client connections.
It subscribes to a channel with one connection
and publishes to that channel with the other:

```javascript
var Redis = require('ioredis');
var redis = new Redis();
var pub = new Redis();
redis.subscribe('news', 'music', function (err, count) {
  // Now we are subscribed to both the 'news' and 'music' channels.
  // `count` represents the number of channels we are currently subscribed to.

  pub.publish('news', 'Hello world!');
  pub.publish('music', 'Hello again!');
});

redis.on('message', function (channel, message) {
  // Receive message Hello world! from channel news
  // Receive message Hello again! from channel music
  console.log('Receive message %s from channel %s', message, channel);
});

// There's also an event called 'messageBuffer', which is the same as 'message' except
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
If you want to send a batch of commands (e.g. > 5), you can use pipelining to queue
the commands in memory and then send them to Redis all at once. This way the performance improves by 50%~300% (See [benchmark section](#benchmark)).

`redis.pipeline()` creates a `Pipeline` instance. You can call any Redis
commands on it just like the `Redis` instance. The commands are queued in memory
and flushed to Redis by calling the `exec` method:

```javascript
var pipeline = redis.pipeline();
pipeline.set('foo', 'bar');
pipeline.del('cc');
pipeline.exec(function (err, results) {
  // `err` is always null, and `results` is an array of responses
  // corresponding to the sequence of queued commands.
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
gets a reply:

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
Most of the time, the transaction commands `multi` & `exec` are used together with pipeline.
Therefore, when `multi` is called, a `Pipeline` instance is created automatically by default,
so you can use `multi` just like `pipeline`:

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

If you want to use transaction without pipeline, pass `{ pipeline: false }` to `multi`,
and every command will be sent to Redis immediately without waiting for an `exec` invocation:

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

Inline transactions are supported by pipeline, which means you can group a subset of commands
in the pipeline into a transaction:

```javascript
redis.pipeline().get('foo').multi().set('foo', 'bar').get('foo').exec().get('foo').exec();
```

## Lua Scripting
ioredis supports all of the scripting commands such as `EVAL`, `EVALSHA` and `SCRIPT`.
However, it's tedious to use in real world scenarios since developers have to take
care of script caching and to detect when to use `EVAL` and when to use `EVALSHA`.
ioredis expose a `defineCommand` method to make scripting much easier to use:

```javascript
var redis = new Redis();

// This will define a command echo:
redis.defineCommand('echo', {
  numberOfKeys: 2,
  lua: 'return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}'
});

// Now `echo` can be used just like any other ordinary command,
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
omit the `numberOfKeys` property and pass the number of keys as the first argument
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

## Transparent Key Prefixing
This feature allows you to specify a string that will automatically be prepended
to all the keys in a command, which makes it easier to manage your key
namespaces.

```javascript
var fooRedis = new Redis({ keyPrefix: 'foo:' });
fooRedis.set('bar', 'baz');  // Actually sends SET foo:bar baz

fooRedis.defineCommand('echo', {
  numberOfKeys: 2,
  lua: 'return {KEYS[1],KEYS[2],ARGV[1],ARGV[2]}'
});

// Works well with pipelining/transaction
fooRedis.pipeline()
  // Sends SORT foo:list BY foo:weight_*->fieldname
  .sort('list', 'BY', 'weight_*->fieldname')
  // Supports custom commands
  // Sends EVALSHA xxx foo:k1 foo:k2 a1 a2
  .echo('k1', 'k2', 'a1', 'a2')
  .exec()
```

## Transforming Arguments & Replies
Most Redis commands take one or more Strings as arguments,
and replies are sent back as a single String or an Array of Strings. However, sometimes
you may want something different. For instance, it would be more convenient if the `HGETALL`
command returns a hash (e.g. `{ key: val1, key2: v2 }`) rather than an array of key values (e.g. `[key1, val1, key2, val2]`).

ioredis has a flexible system for transforming arguments and replies. There are two types
of transformers, argument transformer and reply transformer:

```javascript
var Redis = require('ioredis');

// Here's the built-in argument transformer converting
// hmset('key', { k1: 'v1', k2: 'v2' })
// or
// hmset('key', new Map([['k1', 'v1'], ['k2', 'v2']]))
// into
// hmset('key', 'k1', 'v1', 'k2', 'v2')
Redis.Command.setArgumentTransformer('hmset', function (args) {
  if (args.length === 2) {
    if (typeof Map !== 'undefined' && args[1] instanceof Map) {
      // utils is a internal module of ioredis
      return [args[0]].concat(utils.convertMapToArray(args[1]));
    }
    if ( typeof args[1] === 'object' && args[1] !== null) {
      return [args[0]].concat(utils.convertObjectToArray(args[1]));
    }
  }
  return args;
});

// Here's the built-in reply transformer converting the HGETALL reply
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
a reply transformer for `hgetall`. Transformers for `hmset` and `hgetall` were mentioned
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

## Monitor
Redis supports the MONITOR command,
which lets you see all commands received by the Redis server across all client connections,
including from other client libraries and other computers.

The `monitor` method returns a monitor instance.
After you send the MONITOR command, no other commands are valid on that connection. ioredis will emit a monitor event for every new monitor message that comes across.
The callback for the monitor event takes a timestamp from the Redis server and an array of command arguments.

Here is a simple example:

```javascript
redis.monitor(function (err, monitor) {
  monitor.on('monitor', function (time, args) {
  });
});
```

## Streamify Scanning
Redis 2.8 added the `SCAN` command to incrementally iterate through the keys in the database. It's different from `KEYS` in that
`SCAN` only returns a small number of elements each call, so it can be used in production without the downside
of blocking the server for a long time. However, it requires recording the cursor on the client side each time
the `SCAN` command is called in order to iterate through all the keys correctly. Since it's a relatively common use case, ioredis
provides a streaming interface for the `SCAN` command to make things much easier. A readable stream can be created by calling `scanStream`:

```javascript
var redis = new Redis();
// Create a readable stream (object mode)
var stream = redis.scanStream();
var keys = [];
stream.on('data', function (resultKeys) {
  // `resultKeys` is an array of strings representing key names
  for (var i = 0; i < resultKeys.length; i++) {
    keys.push(resultKeys[i]);
  }
});
stream.on('end', function () {
  console.log('done with the keys: ', keys);
});
```

`scanStream` accepts an option, with which you can specify the `MATCH` pattern and the `COUNT` argument:

```javascript
var stream = redis.scanStream({
  // only returns keys following the pattern of `user:*`
  match: 'user:*',
  // returns approximately 100 elements per call
  count: 100
});
```

Just like other commands, `scanStream` has a binary version `scanBufferStream`, which returns an array of buffers. It's useful when
the key names are not utf8 strings.

There are also `hscanStream`, `zscanStream` and `sscanStream` to iterate through elements in a hash, zset and set. The interface of each is
similar to `scanStream` except the first argument is the key name:

```javascript
var stream = redis.hscanStream('myhash', {
  match: 'age:??'
});
```

You can learn more from the [Redis documentation](http://redis.io/commands/scan).

## Auto-reconnect
By default, ioredis will try to reconnect when the connection to Redis is lost
except when the connection is closed manually by `redis.disconnect()` or `redis.quit()`.

It's very flexible to control how long to wait to reconnect after disconnection
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
The argument `times` means this is the nth reconnection being made and
the return value represents how long (in ms) to wait to reconnect. When the
return value isn't a number, ioredis will stop trying to reconnect, and the connection
will be lost forever if the user doesn't call `redis.connect()` manually.

When reconnected, the client will auto subscribe to channels that the previous connection subscribed to.
This behavior can be disabled by setting the `autoResubscribe` option to `false`.

And if the previous connection has some unfulfilled commands (most likely blocking commands such as `brpop` and `blpop`),
the client will resend them when reconnected. This behavior can be disabled by setting the `autoResendUnfulfilledCommands` option to `false`.

### Reconnect on error

Besides auto-reconnect when the connection is closed, ioredis supports reconnecting on the specified errors by the `reconnectOnError` option. Here's an example that will reconnect when receiving `READONLY` error:

```javascript
var redis = new Redis({
  reconnectOnError: function (err) {
    var targetError = 'READONLY';
    if (err.message.slice(0, targetError.length) === targetError) {
      // Only reconnect when the error starts with "READONLY"
      return true; // or `return 1;`
    }
  }
});
```

This feature is useful when using Amazon ElastiCache. Once failover happens, Amazon ElastiCache will switch the master we currently connected with to a slave, leading to the following writes fails with the error `READONLY`. Using `reconnectOnError`, we can force the connection to reconnect on this error in order to connect to the new master.

Furthermore, if the `reconnectOnError` returns `2`, ioredis will resend the failed command after reconnecting.

## Connection Events
The Redis instance will emit some events about the state of the connection to the Redis server.

Event    | Description
:------------- | :-------------
connect  | emits when a connection is established to the Redis server.
ready    | If `enableReadyCheck` is `true`, client will emit `ready` when the server reports that it is ready to receive commands (e.g. finish loading data from disk).<br>Otherwise, `ready` will be emitted immediately right after the `connect` event.
error    | emits when an error occurs while connecting.<br>However, ioredis emits all `error` events silently (only emits when there's at least one listener) so that your application won't crash if you're not listening to the `error` event.
close    | emits when an established Redis server connection has closed.
reconnecting | emits after `close` when a reconnection will be made. The argument of the event is the time (in ms) before reconnecting.
end     | emits after `close` when no more reconnections will be made.

You can also check out the `Redis#status` property to get the current connection status.

Besides the above connection events, there are several other custom events:

Event    | Description
:------------- | :-------------
authError | emits when the password specified in the options is wrong or the server doesn't require a password.
select   | emits when the database changed. The argument is the new db number.

## Offline Queue
When a command can't be processed by Redis (being sent before the `ready` event), by default, it's added to the offline queue and will be
executed when it can be processed. You can disable this feature by setting the `enableOfflineQueue`
option to `false`:

```javascript
var redis = new Redis({ enableOfflineQueue: false });
```

## TLS Options
Redis doesn't support TLS natively, however if the redis server you want to connect to is hosted behind a TLS proxy (e.g. [stunnel](https://www.stunnel.org/)) or is offered by a PaaS service that supports TLS connection (e.g. [Redis Labs](https://redislabs.com/)), you can set the `tls` option:

```javascript
var redis = new Redis({
  host: 'localhost',
  tls: {
    // Refer to `tls.connect()` section in
    // https://nodejs.org/api/tls.html
    // for all supported options
    ca: fs.readFileSync('cert.pem')
  }
});
```

<hr>

## Sentinel
ioredis supports Sentinel out of the box. It works transparently as all features that work when
you connect to a single node also work when you connect to a sentinel group. Make sure to run Redis >= 2.8.12 if you want to use this feature.

To connect using Sentinel, use:

```javascript
var redis = new Redis({
  sentinels: [{ host: 'localhost', port: 26379 }, { host: 'localhost', port: 26380 }],
  name: 'mymaster'
});

redis.set('foo', 'bar');
```

The arguments passed to the constructor are different from the ones you use to connect to a single node, where:

* `name` identifies a group of Redis instances composed of a master and one or more slaves (`mymaster` in the example);
* `sentinels` are a list of sentinels to connect to. The list does not need to enumerate all your sentinel instances, but a few so that if one is down the client will try the next one.

ioredis **guarantees** that the node you connected to is always a master even after a failover. When a failover happens, instead of trying to reconnect to the failed node (which will be demoted to slave when it's available again), ioredis will ask sentinels for the new master node and connect to it. All commands sent during the failover are queued and will be executed when the new connection is established so that none of the commands will be lost.

It's possible to connect to a slave instead of a master by specifying the option `role` with the value of `slave`, and ioredis will try to connect to a random slave of the specified master, with the guarantee that the connected node is always a slave. If the current node is promoted to master due to a failover, ioredis will disconnect from it and ask the sentinels for another slave node to connect to.

Besides the `retryStrategy` option, there's also a `sentinelRetryStrategy` in Sentinel mode which will be invoked when all the sentinel nodes are unreachable during connecting. If `sentinelRetryStrategy` returns a valid delay time, ioredis will try to reconnect from scratch. The default value of `sentinelRetryStrategy` is:

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
    ioredis will try to reconnect to the startup nodes from scratch after the specified delay (in ms). Otherwise, an error of "None of startup nodes is available" will be returned.
    The default value of this option is:

        ```javascript
        function (times) {
          var delay = Math.min(100 + times * 2, 2000);
          return delay;
        }
        ```

    * `maxRedirections`: When a cluster related error (e.g. `MOVED`, `ASK` and `CLUSTERDOWN` etc.) is received, the client will redirect the
    command to another node. This option limits the max redirections allowed when sending a command. The default value is `16`.
    * `retryDelayOnFailover`: If the error of "Connection is closed." is received when sending a command,
    ioredis will retry after the specified delay. The default value is `2000`. You should make sure `retryDelayOnFailover * maxRedirections > cluster-node-timeout`
    to insure that no command will fail during a failover.
    * `retryDelayOnClusterDown`: When a cluster is down, all commands will be rejected with the error of `CLUSTERDOWN`. If this option is a number (by default, it is 1000), the client
    will resend the commands after the specified time (in ms).

### Running same operation on multiple nodes

Sometimes you may want to send a command to all the nodes (masters or slaves) of the cluster. Here's a helper function
for this case:

```javascript
// Send `flushdb` command to every master,
// other available groups are 'slaves' and 'all'.
cluster.to('masters').call('flushdb').then(function (results) {
});

// Get all keys of the cluster:
cluster.to('masters').call('keys').then(function (keys) {
  return [].concat.apply([], keys);
});

// in case of buffer
cluster.to('slaves').callBuffer('get', 'key').catch(function (err) {
  // likely rejected, because operations would only succeed partially due to slot | moved error
});
```

**Note 1** At the time of calling `to` method, ioredis may have not connected all nodes of the Cluster, so that it's possible that only a part of the nodes will receive the command.

**Note 2** If the `readOnly` option is `false`, ioredis won't try to connect to the slave nodes, so `cluster.to('slaves').call()` won't send the command to any nodes. In this case, `cluster.to('all')` are same to the `cluster.to('masters')`.

### Transaction and pipeline in Cluster mode
Almost all features that are supported by `Redis` are also supported by `Redis.Cluster`, e.g. custom commands, transaction and pipeline.
However there are some differences when using transaction and pipeline in Cluster mode:

0. All keys in a pipeline should belong to the same slot since ioredis sends all commands in a pipeline to the same node.
0. You can't use `multi` without pipeline (aka `cluster.multi({ pipeline: false })`). This is because when you call `cluster.multi({ pipeline: false })`, ioredis doesn't know which node the `multi` command should be sent to.
0. Chaining custom commands in the pipeline is not supported in Cluster mode.

When any commands in a pipeline receives a `MOVED` or `ASK` error, ioredis will resend the whole pipeline to the specified node automatically if all of the following conditions are satisfied:

0. All errors received in the pipeline are the same. For example, we won't resend the pipeline if we got two `MOVED` errors pointing to different nodes.
0. All commands executed successfully are readonly commands. This makes sure that resending the pipeline won't have side effects.

### Pub/Sub
Pub/Sub in cluster mode works exactly as the same as in standalone mode. Internally, when a node of the cluster receives a message, it will broadcast the message to the other nodes. ioredis makes sure that each message will only be received once by strictly subscribing one node at the same time.

```javascript
var nodes = [/* nodes */];
var pub = new Redis.Cluster(nodes);
var sub = new Redis.Cluster(nodes);
sub.on('message', function (channel, message) {
  console.log(channel, message);
});

sub.subscribe('news', function () {
  pub.publish('news', 'highlights');
});
```

### Events
If an error occurs when connecting to the node, the `node error` event will be emitted. Furthermore, if all nodes aren't reachable,
the `error` event will be emitted silently (only emitting if there's at least one listener) with a property of `lastNodeError` representing
the last node error received.

### Scaling reads using slave nodes
Normally, commands are only sent to the masters since slaves can't process write queries.
However, you can use the `readOnly` option to use slaves in order to scale reads:

```javascript
var Redis = require('ioredis');
var cluster = new Redis.Cluster(nodes, { readOnly: true });
```

### Password
Setting the `password` option to access password-proctected clusters:

```javascript
var Redis = require('ioredis');
var cluster = new Redis.Cluster(nodes, { password: 'your-cluster-password' });
```

If some of nodes in the cluster using a different password, you should specify them in the first parameter:

```javascript
var Redis = require('ioredis');
var cluster = new Redis.Cluster([
  // Use password "password-for-30001" for 30001
  { port: 30001, password: 'password-for-30001'},
  // Don't use password when accessing 30002
  { port: 30002 }
  // Other nodes will use "fallback-password"
], { password: 'fallback-password' });
```

## Native Parser
If [hiredis](https://github.com/redis/hiredis-node) is installed (by `npm install hiredis`),
ioredis will use it by default. Otherwise, a pure JavaScript parser will be used.
Typically, there's not much difference between them in terms of performance.

<hr>

# Error Handling
All the errors returned by the Redis server are instances of `ReplyError`, which can be accessed via `Redis`:

```javascript
var Redis = require('ioredis');
var redis = new Redis();
// This command causes a reply error since the SET command requires two arguments.
redis.set('foo', function (err) {
  err instanceof Redis.ReplyError
});
```

When a reply error is not handled (no callback is specified, and no `catch` method is chained),
the error will be logged to stderr. For instance:

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

But the error stack doesn't make any sense because the whole stack happens in the ioredis
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

This time the stack tells you that the error happens on the third line in your code. Pretty sweet!
However, it would decrease the performance significantly to optimize the error stack. So by
default, this option is disabled and can only be used for debugging purposes. You **shouldn't** use this feature in a production environment.

If you want to catch all unhandled errors without decreased performance, there's another way:

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

# Consolidation: It's time for celebration

Right now there are two great redis clients around and both have some advantages above each other. We speak about [node_redis](https://github.com/NodeRedis/node_redis) and ioredis. So after talking to each other about how we could improve in working together we (that is [@BridgeAR](https://github.com/BridgeAR) and [@luin](https://github.com/luin)) decided to work towards a single library on the long run. But step by step.

First of all, we want to split small parts of our libraries into others so that we're both able to use the same code. Those libraries are going to be maintained under the NodeRedis organization. This is going to reduce the maintance overhead, allows others to use the very same code, if they need it and it's way easier for others to contribute to both libraries.

We're very happy about this step towards working together as we both want to give you the best redis experience possible.

If you want to join our cause by help maintaining something, please don't hesitate to contact either one of us.

# Join in!

I'm happy to receive bug reports, fixes, documentation enhancements, and any other improvements.

And since I'm not a native English speaker, if you find any grammar mistakes in the documentation, please also let me know. :)

# Contributors
<table><tr><td width="20%"><a href="https://github.com/luin"><img src="https://avatars.githubusercontent.com/u/635902?v=3" /></a><p align="center">luin</p></td><td width="20%"><a href="https://github.com/dguo"><img src="https://avatars.githubusercontent.com/u/2763135?v=3" /></a><p align="center">dguo</p></td><td width="20%"><a href="https://github.com/nakulgan"><img src="https://avatars.githubusercontent.com/u/189836?v=3" /></a><p align="center">nakulgan</p></td><td width="20%"><a href="https://github.com/AVVS"><img src="https://avatars.githubusercontent.com/u/1713617?v=3" /></a><p align="center">AVVS</p></td><td width="20%"><a href="https://github.com/shaharmor"><img src="https://avatars.githubusercontent.com/u/10861920?v=3" /></a><p align="center">shaharmor</p></td></tr><tr><td width="20%"><a href="https://github.com/hayeah"><img src="https://avatars.githubusercontent.com/u/50120?v=3" /></a><p align="center">hayeah</p></td><td width="20%"><a href="https://github.com/albin3"><img src="https://avatars.githubusercontent.com/u/6190670?v=3" /></a><p align="center">albin3</p></td><td width="20%"><a href="https://github.com/phlip9"><img src="https://avatars.githubusercontent.com/u/918989?v=3" /></a><p align="center">phlip9</p></td><td width="20%"><a href="https://github.com/fracmak"><img src="https://avatars.githubusercontent.com/u/378178?v=3" /></a><p align="center">fracmak</p></td><td width="20%"><a href="https://github.com/suprememoocow"><img src="https://avatars.githubusercontent.com/u/594566?v=3" /></a><p align="center">suprememoocow</p></td></tr><tr><td width="20%"><a href="https://github.com/lpinca"><img src="https://avatars.githubusercontent.com/u/1443911?v=3" /></a><p align="center">lpinca</p></td><td width="20%"><a href="https://github.com/jeffjen"><img src="https://avatars.githubusercontent.com/u/5814507?v=3" /></a><p align="center">jeffjen</p></td><td width="20%"><a href="https://github.com/devaos"><img src="https://avatars.githubusercontent.com/u/5412167?v=3" /></a><p align="center">devaos</p></td><td width="20%"><a href="https://github.com/horx"><img src="https://avatars.githubusercontent.com/u/1332618?v=3" /></a><p align="center">horx</p></td><td width="20%"><a href="https://github.com/ColmHally"><img src="https://avatars.githubusercontent.com/u/20333?v=3" /></a><p align="center">ColmHally</p></td></tr><tr><td width="20%"><a href="https://github.com/klinquist"><img src="https://avatars.githubusercontent.com/u/1343376?v=3" /></a><p align="center">klinquist</p></td><td width="20%"><a href="https://github.com/alsotang"><img src="https://avatars.githubusercontent.com/u/1147375?v=3" /></a><p align="center">alsotang</p></td><td width="20%"><a href="https://github.com/zhuangya"><img src="https://avatars.githubusercontent.com/u/499038?v=3" /></a><p align="center">zhuangya</p></td><td width="20%"><a href="https://github.com/pensierinmusica"><img src="https://avatars.githubusercontent.com/u/3594037?v=3" /></a><p align="center">pensierinmusica</p></td><td width="20%"><a href="https://github.com/ArtskydJ"><img src="https://avatars.githubusercontent.com/u/1833684?v=3" /></a><p align="center">ArtskydJ</p></td></tr><tr><td width="20%"><a href="https://github.com/tkalfigo"><img src="https://avatars.githubusercontent.com/u/3481553?v=3" /></a><p align="center">tkalfigo</p></td><td width="20%"><a href="https://github.com/pra85"><img src="https://avatars.githubusercontent.com/u/829526?v=3" /></a><p align="center">pra85</p></td><td width="20%"><a href="https://github.com/devoto13"><img src="https://avatars.githubusercontent.com/u/823594?v=3" /></a><p align="center">devoto13</p></td><td width="20%"><a href="https://github.com/henstock"><img src="https://avatars.githubusercontent.com/u/13809467?v=3" /></a><p align="center">henstock</p></td><td width="20%"><a href="https://github.com/pyros2097"><img src="https://avatars.githubusercontent.com/u/1687946?v=3" /></a><p align="center">pyros2097</p></td></tr><tr><td width="20%"><a href="https://github.com/VikramTiwari"><img src="https://avatars.githubusercontent.com/u/1330677?v=3" /></a><p align="center">VikramTiwari</p></td><td width="20%"><a href="https://github.com/i5ting"><img src="https://avatars.githubusercontent.com/u/3118295?v=3" /></a><p align="center">i5ting</p></td><td width="20%"><a href="https://github.com/nswbmw"><img src="https://avatars.githubusercontent.com/u/4279697?v=3" /></a><p align="center">nswbmw</p></td><td width="20%"><a href="https://github.com/joeledwards"><img src="https://avatars.githubusercontent.com/u/412853?v=3" /></a><p align="center">joeledwards</p></td><td width="20%"><a href="https://github.com/mtlima"><img src="https://avatars.githubusercontent.com/u/9111440?v=3" /></a><p align="center">mtlima</p></td></tr><tr><td width="20%"><a href="https://github.com/igrcic"><img src="https://avatars.githubusercontent.com/u/394398?v=3" /></a><p align="center">igrcic</p></td></table>

# Roadmap

- [ ] Connection Pool & Read Write Splitting

# Acknowledgements

The JavaScript and hiredis parsers are modified from [node_redis](https://github.com/mranney/node_redis) (MIT License, Copyright (c) 2010 Matthew Ranney, http://ranney.com/).

# License

MIT
