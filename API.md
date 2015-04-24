#Index

**Classes**

* [class: Redis](#Redis)
  * [new Redis([port], [host], [options])](#new_Redis)
  * [~~redis.createClient~~](#Redis#createClient)
  * [redis.connect()](#Redis#connect)
  * [redis.disconnect()](#Redis#disconnect)
  * [redis.duplicate()](#Redis#duplicate)
  * [redis.monitor([callback])](#Redis#monitor)
* [class: RedisCluster](#RedisCluster)
  * [new RedisCluster(startupNodes, options)](#new_RedisCluster)
  * [redisCluster.disconnect()](#RedisCluster#disconnect)
 
<a name="Redis"></a>
#class: Redis
**Extends**: `[EventEmitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)`  
**Members**

* [class: Redis](#Redis)
  * [new Redis([port], [host], [options])](#new_Redis)
  * [~~redis.createClient~~](#Redis#createClient)
  * [redis.connect()](#Redis#connect)
  * [redis.disconnect()](#Redis#disconnect)
  * [redis.duplicate()](#Redis#duplicate)
  * [redis.monitor([callback])](#Redis#monitor)

<a name="new_Redis"></a>
##new Redis([port], [host], [options])
Creates a Redis instance

**Params**

- \[port=6379\] `number` | `string` | `Object` - Port of the Redis server,
or a URL string(see the examples below),
or the `options` object(see the third argument).  
- \[host=localhost\] `string` | `Object` - Host of the Redis server,
when the first argument is a URL string,
this argument is an object represents the options.  
- \[options\] `Object` - Other options.  
  - \[port=6379\] `number` - Port of the Redis server.  
  - \[host=localhost\] `string` - Host of the Redis server.  
  - \[family=4\] `string` - Version of IP stack. Defaults to 4.  
  - \[path=null\] `string` - Local domain socket path. If set the `port`, `host`
and `family` will be ignored.  
  - \[auth=null\] `string` - If set, client will send AUTH command
with the value of this option when connected.  
  - \[enableReadyCheck=true\] `boolean` - When a connection is established to
the Redis server, the server might still be loading the database from disk.
While loading, the server not respond to any commands.
To work around this, when this option is `true`,
ioredis will check the status of the Redis server,
and when the Redis server is able to process commands,
a `ready` event will be emitted.  
  - \[enableOfflineQueue=true\] `boolean` - By default,
if there is no active connection to the Redis server,
commands are added to a queue and are executed once the connection is "ready"
(when `enableReadyCheck` is `true`,
"ready" means the Redis server has loaded the database from disk, otherwise means the connection
to the Redis server has been established). If this option is false,
when execute the command when the connection isn't ready, an error will be returned.  
  - \[connectTimeout=10000\] `number` - The milliseconds before a timeout occurs during the initial connection to the Redis server.  
  - \[lazyConnect=false\] `boolean` - By default,
When a new `Redis` instance is created, it will connect to Redis server automatically.
If you want to keep disconnected util a command is called, you can pass the `lazyConnect` option to
the constructor:
```javascript
var redis = new Redis({ lazyConnect: true });
// No attempting to connect to the Redis server here.
// Now let's connect to the Redis server
redis.get('foo', function () {
});
```  
  - \[retryStrategy\] `function` - See "Quick Start" section  

**Extends**: `[EventEmitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)`  
**Example**  
```js
var Redis = require('ioredis');

var redis = new Redis();
// or: var redis = Redis();

var redisOnPort6380 = new Redis(6380);
var anotherRedis = new Redis(6380, '192.168.100.1');
var unixSocketRedis = new Redis({ path: '/tmp/echo.sock' });
var unixSocketRedis2 = new Redis('/tmp/echo.sock');
var urlRedis = new Redis('redis://user:password@redis-service.com:6379/');
var urlRedis2 = new Redis('//localhost:6379');
var authedRedis = new Redis(6380, '192.168.100.1', { auth: 'password' });
```

<a name="Redis#createClient"></a>
##~~redis.createClient~~
Create a Redis instance

***Deprecated***  
<a name="Redis#connect"></a>
##redis.connect()
Create a connection to Redis.
This method will be invoked automatically when creating a new Redis instance.

<a name="Redis#disconnect"></a>
##redis.disconnect()
Disconnect from Redis.

This method closes the connection immediately,
and may lose some pending replies that haven't written to clien.
If you want to wait for the pending replies, use Redis#quit instead.

<a name="Redis#duplicate"></a>
##redis.duplicate()
Create a new instance, using the same options.

**Example**  
```js
var redis = new Redis(6380);
var anotherRedis = redis.duplicate();
```

<a name="Redis#monitor"></a>
##redis.monitor([callback])
Listen for all requests received by the server in real time.

This command will create a new connection to Redis and send a
MONITOR command via the new connection in order to avoid disturbing
the current connection.

**Params**

- \[callback\] `function` - The callback function. If omit, a promise will be returned.  

**Example**  
```js
var redis = new Redis();
redis.monitor(function (err, monitor) {
  // Entering monitoring mode.
  monitor.on('monitor', function (time, args) {
    console.log(time + ": " + util.inspect(args));
  });
});

// supports promise as well as other commands
redis.monitor().then(function (monitor) {
  monitor.on('monitor', function (time, args) {
    console.log(time + ": " + util.inspect(args));
  });
});
```

<a name="RedisCluster"></a>
#class: RedisCluster
**Extends**: `[EventEmitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)`  
**Members**

* [class: RedisCluster](#RedisCluster)
  * [new RedisCluster(startupNodes, options)](#new_RedisCluster)
  * [redisCluster.disconnect()](#RedisCluster#disconnect)

<a name="new_RedisCluster"></a>
##new RedisCluster(startupNodes, options)
Creates a Redis instance

**Params**

- startupNodes `Array.<Object>` - An array of nodes in the cluster, [{ port: number, host: string }]  
- options `Object`  
  - \[enableOfflineQueue=true\] `boolean` - See Redis class  
  - \[lazyConnect=true\] `boolean` - See Redis class  
  - \[refreshAfterFails=10\] `number` - When a MOVED error is returned, it's considered
a failure. When the times of failures reach `refreshAfterFails`, client will call CLUSTER SLOTS
command to refresh the slots.  

**Extends**: `[EventEmitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)`  
<a name="RedisCluster#disconnect"></a>
##redisCluster.disconnect()
Disconnect from every node in the cluster.

