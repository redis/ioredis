#Index

**Classes**

* [class: Command](#Command)
  * [new Command(name, [args], [replyEncoding], [callback])](#new_Command)
  * [command.toWritable()](#Command#toWritable)
* [class: Redis](#Redis)
  * [new Redis([port], [host], [options])](#new_Redis)
  * [~~redis.createClient~~](#Redis#createClient)
  * [redis.connect()](#Redis#connect)
  * [redis.disconnect()](#Redis#disconnect)
  * [redis.duplicate()](#Redis#duplicate)
  * [redis.monitor([callback])](#Redis#monitor)
 
<a name="Command"></a>
#class: Command
**Members**

* [class: Command](#Command)
  * [new Command(name, [args], [replyEncoding], [callback])](#new_Command)
  * [command.toWritable()](#Command#toWritable)

<a name="new_Command"></a>
##new Command(name, [args], [replyEncoding], [callback])
Command instance

It's rare that you need to create a Command instance yourself.

**Params**

- name `string` - Command name  
- \[args=null\] `Array.<string>` - An array of command arguments  
- \[replyEncoding=null\] `string` - Set the encoding of the reply,
by default buffer will be returned.  
- \[callback=null\] `function` - The callback that handles the response.
If omit, the response will be handled via Promise.  

**Example**  
```js
var infoCommand = new Command('info', null, function (err, result) {
  console.log('result', result);
});

redis.sendCommand(infoCommand);

// When no callback provided, Command instance will have a `promise` property,
// which will resolve/reject with the result of the command.
var getCommand = new Command('get', ['foo']);
getCommand.promise.then(function (result) {
  console.log('result', result);
});
```

<a name="Command#toWritable"></a>
##command.toWritable()
Convert command to writable buffer or string

**Returns**: `string` | `Buffer`  
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

