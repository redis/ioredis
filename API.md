## Classes

<dl>
<dt><a href="#Redis">Redis</a> ⇐ <code>[EventEmitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)</code></dt>
<dd></dd>
<dt><a href="#Cluster">Cluster</a> ⇐ <code>[EventEmitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)</code></dt>
<dd></dd>
<dt><a href="#Commander">Commander</a></dt>
<dd></dd>
</dl>

## Members

<dl>
<dt><a href="#defaultOptions">defaultOptions</a></dt>
<dd><p>Default options</p>
</dd>
<dt><a href="#defaultOptions">defaultOptions</a></dt>
<dd><p>Default options</p>
</dd>
</dl>

<a name="Redis"></a>

## Redis ⇐ <code>[EventEmitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)</code>
**Kind**: global class  
**Extends:** <code>[EventEmitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)</code>, <code>[Commander](#Commander)</code>  

* [Redis](#Redis) ⇐ <code>[EventEmitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)</code>
    * [new Redis([port], [host], [options])](#new_Redis_new)
    * _instance_
        * [.connect(callback)](#Redis+connect) ⇒ <code>Promise</code>
        * [.disconnect()](#Redis+disconnect)
        * ~~[.end()](#Redis+end)~~
        * [.duplicate()](#Redis+duplicate)
        * [.monitor([callback])](#Redis+monitor)
        * [.getBuiltinCommands()](#Commander+getBuiltinCommands) ⇒ <code>Array.&lt;string&gt;</code>
        * [.createBuiltinCommand(commandName)](#Commander+createBuiltinCommand) ⇒ <code>object</code>
        * [.defineCommand(name, definition)](#Commander+defineCommand)
    * _static_
        * ~~[.createClient()](#Redis.createClient)~~

<a name="new_Redis_new"></a>

### new Redis([port], [host], [options])
Creates a Redis instance


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [port] | <code>number</code> &#124; <code>string</code> &#124; <code>Object</code> | <code>6379</code> | Port of the Redis server, or a URL string(see the examples below), or the `options` object(see the third argument). |
| [host] | <code>string</code> &#124; <code>Object</code> | <code>&quot;localhost&quot;</code> | Host of the Redis server, when the first argument is a URL string, this argument is an object represents the options. |
| [options] | <code>Object</code> |  | Other options. |
| [options.port] | <code>number</code> | <code>6379</code> | Port of the Redis server. |
| [options.host] | <code>string</code> | <code>&quot;localhost&quot;</code> | Host of the Redis server. |
| [options.family] | <code>string</code> | <code>4</code> | Version of IP stack. Defaults to 4. |
| [options.path] | <code>string</code> | <code>null</code> | Local domain socket path. If set the `port`, `host` and `family` will be ignored. |
| [options.keepAlive] | <code>number</code> | <code>0</code> | TCP KeepAlive on the socket with a X ms delay before start. Set to a non-number value to disable keepAlive. |
| [options.connectionName] | <code>string</code> | <code>null</code> | Connection name. |
| [options.db] | <code>number</code> | <code>0</code> | Database index to use. |
| [options.password] | <code>string</code> | <code>null</code> | If set, client will send AUTH command with the value of this option when connected. |
| [options.parser] | <code>string</code> | <code>null</code> | Either "hiredis" or "javascript". If not set, "hiredis" parser will be used if it's installed (`npm install hiredis`), otherwise "javascript" parser will be used. |
| [options.dropBufferSupport] | <code>boolean</code> | <code>false</code> | Drop the buffer support for better performance. This option is recommanded to be enabled when "hiredis" parser is used. Refer to https://github.com/luin/ioredis/wiki/Improve-Performance for more details. |
| [options.enableReadyCheck] | <code>boolean</code> | <code>true</code> | When a connection is established to the Redis server, the server might still be loading the database from disk. While loading, the server not respond to any commands. To work around this, when this option is `true`, ioredis will check the status of the Redis server, and when the Redis server is able to process commands, a `ready` event will be emitted. |
| [options.enableOfflineQueue] | <code>boolean</code> | <code>true</code> | By default, if there is no active connection to the Redis server, commands are added to a queue and are executed once the connection is "ready" (when `enableReadyCheck` is `true`, "ready" means the Redis server has loaded the database from disk, otherwise means the connection to the Redis server has been established). If this option is false, when execute the command when the connection isn't ready, an error will be returned. |
| [options.connectTimeout] | <code>number</code> | <code>10000</code> | The milliseconds before a timeout occurs during the initial connection to the Redis server. |
| [options.autoResubscribe] | <code>boolean</code> | <code>true</code> | After reconnected, if the previous connection was in the subscriber mode, client will auto re-subscribe these channels. |
| [options.autoResendUnfulfilledCommands] | <code>boolean</code> | <code>true</code> | If true, client will resend unfulfilled commands(e.g. block commands) in the previous connection when reconnected. |
| [options.lazyConnect] | <code>boolean</code> | <code>false</code> | By default, When a new `Redis` instance is created, it will connect to Redis server automatically. If you want to keep disconnected util a command is called, you can pass the `lazyConnect` option to the constructor: ```javascript var redis = new Redis({ lazyConnect: true }); // No attempting to connect to the Redis server here. // Now let's connect to the Redis server redis.get('foo', function () { }); ``` |
| [options.keyPrefix] | <code>string</code> | <code>&quot;&#x27;&#x27;&quot;</code> | The prefix to prepend to all keys in a command. |
| [options.retryStrategy] | <code>function</code> |  | See "Quick Start" section |
| [options.reconnectOnError] | <code>function</code> |  | See "Quick Start" section |
| [options.readOnly] | <code>boolean</code> | <code>false</code> | Enable READONLY mode for the connection. Only available for cluster mode. |
| [options.stringNumbers] | <code>boolean</code> | <code>false</code> | Force numbers to be always returned as JavaScript strings. This option is necessary when dealing with big numbers (exceed the [-2^53, +2^53] range). Notice that when this option is enabled, the JavaScript parser will be used even "hiredis" is specified because only JavaScript parser supports this feature for the time being. |

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
var authedRedis = new Redis(6380, '192.168.100.1', { password: 'password' });
```
<a name="Redis+connect"></a>

### redis.connect(callback) ⇒ <code>Promise</code>
Create a connection to Redis.
This method will be invoked automatically when creating a new Redis instance.

**Kind**: instance method of <code>[Redis](#Redis)</code>  
**Access:** public  

| Param | Type |
| --- | --- |
| callback | <code>function</code> | 

<a name="Redis+disconnect"></a>

### redis.disconnect()
Disconnect from Redis.

This method closes the connection immediately,
and may lose some pending replies that haven't written to client.
If you want to wait for the pending replies, use Redis#quit instead.

**Kind**: instance method of <code>[Redis](#Redis)</code>  
**Access:** public  
<a name="Redis+end"></a>

### ~~redis.end()~~
***Deprecated***

Disconnect from Redis.

**Kind**: instance method of <code>[Redis](#Redis)</code>  
<a name="Redis+duplicate"></a>

### redis.duplicate()
Create a new instance with the same options as the current one.

**Kind**: instance method of <code>[Redis](#Redis)</code>  
**Access:** public  
**Example**  
```js
var redis = new Redis(6380);
var anotherRedis = redis.duplicate();
```
<a name="Redis+monitor"></a>

### redis.monitor([callback])
Listen for all requests received by the server in real time.

This command will create a new connection to Redis and send a
MONITOR command via the new connection in order to avoid disturbing
the current connection.

**Kind**: instance method of <code>[Redis](#Redis)</code>  
**Access:** public  

| Param | Type | Description |
| --- | --- | --- |
| [callback] | <code>function</code> | The callback function. If omit, a promise will be returned. |

**Example**  
```js
var redis = new Redis();
redis.monitor(function (err, monitor) {
  // Entering monitoring mode.
  monitor.on('monitor', function (time, args, source, database) {
    console.log(time + ": " + util.inspect(args));
  });
});

// supports promise as well as other commands
redis.monitor().then(function (monitor) {
  monitor.on('monitor', function (time, args, source, database) {
    console.log(time + ": " + util.inspect(args));
  });
});
```
<a name="Commander+getBuiltinCommands"></a>

### redis.getBuiltinCommands() ⇒ <code>Array.&lt;string&gt;</code>
Return supported builtin commands

**Kind**: instance method of <code>[Redis](#Redis)</code>  
**Returns**: <code>Array.&lt;string&gt;</code> - command list  
**Access:** public  
<a name="Commander+createBuiltinCommand"></a>

### redis.createBuiltinCommand(commandName) ⇒ <code>object</code>
Create a builtin command

**Kind**: instance method of <code>[Redis](#Redis)</code>  
**Returns**: <code>object</code> - functions  
**Access:** public  

| Param | Type | Description |
| --- | --- | --- |
| commandName | <code>string</code> | command name |

<a name="Commander+defineCommand"></a>

### redis.defineCommand(name, definition)
Define a custom command using lua script

**Kind**: instance method of <code>[Redis](#Redis)</code>  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| name | <code>string</code> |  | the command name |
| definition | <code>object</code> |  |  |
| definition.lua | <code>string</code> |  | the lua code |
| [definition.numberOfKeys] | <code>number</code> | <code></code> | the number of keys. If omit, you have to pass the number of keys as the first argument every time you invoke the command |

<a name="Redis.createClient"></a>

### ~~Redis.createClient()~~
***Deprecated***

Create a Redis instance

**Kind**: static method of <code>[Redis](#Redis)</code>  
<a name="Cluster"></a>

## Cluster ⇐ <code>[EventEmitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)</code>
**Kind**: global class  
**Extends:** <code>[EventEmitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)</code>, <code>[Commander](#Commander)</code>  

* [Cluster](#Cluster) ⇐ <code>[EventEmitter](http://nodejs.org/api/events.html#events_class_events_eventemitter)</code>
    * [new Cluster(startupNodes, options)](#new_Cluster_new)
    * [.connect()](#Cluster+connect) ⇒ <code>Promise</code>
    * [.disconnect()](#Cluster+disconnect)
    * [.quit(callback)](#Cluster+quit) ⇒ <code>Promise</code>
    * [.nodes([role])](#Cluster+nodes) ⇒ <code>[Array.&lt;Redis&gt;](#Redis)</code>
    * [.getBuiltinCommands()](#Commander+getBuiltinCommands) ⇒ <code>Array.&lt;string&gt;</code>
    * [.createBuiltinCommand(commandName)](#Commander+createBuiltinCommand) ⇒ <code>object</code>
    * [.defineCommand(name, definition)](#Commander+defineCommand)
    * *[.sendCommand()](#Commander+sendCommand)*

<a name="new_Cluster_new"></a>

### new Cluster(startupNodes, options)
Creates a Redis Cluster instance


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| startupNodes | <code>Array.&lt;Object&gt;</code> |  | An array of nodes in the cluster, [{ port: number, host: string }] |
| options | <code>Object</code> |  |  |
| [options.clusterRetryStrategy] | <code>function</code> |  | See "Quick Start" section |
| [options.enableOfflineQueue] | <code>boolean</code> | <code>true</code> | See Redis class |
| [options.enableReadyCheck] | <code>boolean</code> | <code>true</code> | When enabled, ioredis only emits "ready" event when `CLUSTER INFO` command reporting the cluster is ready for handling commands. |
| [options.scaleReads] | <code>string</code> | <code>&quot;master&quot;</code> | Scale reads to the node with the specified role. Available values are "master", "slave" and "all". |
| [options.maxRedirections] | <code>number</code> | <code>16</code> | When a MOVED or ASK error is received, client will redirect the command to another node. This option limits the max redirections allowed to send a command. |
| [options.retryDelayOnFailover] | <code>number</code> | <code>100</code> | When an error is received when sending a command(e.g. "Connection is closed." when the target Redis node is down), |
| [options.retryDelayOnClusterDown] | <code>number</code> | <code>100</code> | When a CLUSTERDOWN error is received, client will retry if `retryDelayOnClusterDown` is valid delay time. |
| [options.retryDelayOnTryAgain] | <code>number</code> | <code>100</code> | When a TRYAGAIN error is received, client will retry if `retryDelayOnTryAgain` is valid delay time. |
| [options.redisOptions] | <code>Object</code> |  | Passed to the constructor of `Redis`. |

<a name="Cluster+connect"></a>

### cluster.connect() ⇒ <code>Promise</code>
Connect to a cluster

**Kind**: instance method of <code>[Cluster](#Cluster)</code>  
**Access:** public  
<a name="Cluster+disconnect"></a>

### cluster.disconnect()
Disconnect from every node in the cluster.

**Kind**: instance method of <code>[Cluster](#Cluster)</code>  
**Access:** public  
<a name="Cluster+quit"></a>

### cluster.quit(callback) ⇒ <code>Promise</code>
Quit the cluster gracefully.

**Kind**: instance method of <code>[Cluster](#Cluster)</code>  
**Returns**: <code>Promise</code> - return 'OK' if successfully  
**Access:** public  

| Param | Type |
| --- | --- |
| callback | <code>function</code> | 

<a name="Cluster+nodes"></a>

### cluster.nodes([role]) ⇒ <code>[Array.&lt;Redis&gt;](#Redis)</code>
Get nodes with the specified role

**Kind**: instance method of <code>[Cluster](#Cluster)</code>  
**Returns**: <code>[Array.&lt;Redis&gt;](#Redis)</code> - array of nodes  
**Access:** public  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [role] | <code>string</code> | <code>&quot;all&quot;</code> | role, "master", "slave" or "all" |

<a name="Commander+getBuiltinCommands"></a>

### cluster.getBuiltinCommands() ⇒ <code>Array.&lt;string&gt;</code>
Return supported builtin commands

**Kind**: instance method of <code>[Cluster](#Cluster)</code>  
**Returns**: <code>Array.&lt;string&gt;</code> - command list  
**Access:** public  
<a name="Commander+createBuiltinCommand"></a>

### cluster.createBuiltinCommand(commandName) ⇒ <code>object</code>
Create a builtin command

**Kind**: instance method of <code>[Cluster](#Cluster)</code>  
**Returns**: <code>object</code> - functions  
**Access:** public  

| Param | Type | Description |
| --- | --- | --- |
| commandName | <code>string</code> | command name |

<a name="Commander+defineCommand"></a>

### cluster.defineCommand(name, definition)
Define a custom command using lua script

**Kind**: instance method of <code>[Cluster](#Cluster)</code>  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| name | <code>string</code> |  | the command name |
| definition | <code>object</code> |  |  |
| definition.lua | <code>string</code> |  | the lua code |
| [definition.numberOfKeys] | <code>number</code> | <code></code> | the number of keys. If omit, you have to pass the number of keys as the first argument every time you invoke the command |

<a name="Commander+sendCommand"></a>

### *cluster.sendCommand()*
Send a command

**Kind**: instance abstract method of <code>[Cluster](#Cluster)</code>  
**Overrides:** <code>[sendCommand](#Commander+sendCommand)</code>  
**Access:** public  
<a name="Commander"></a>

## Commander
**Kind**: global class  

* [Commander](#Commander)
    * [new Commander()](#new_Commander_new)
    * [.getBuiltinCommands()](#Commander+getBuiltinCommands) ⇒ <code>Array.&lt;string&gt;</code>
    * [.createBuiltinCommand(commandName)](#Commander+createBuiltinCommand) ⇒ <code>object</code>
    * [.defineCommand(name, definition)](#Commander+defineCommand)
    * *[.sendCommand()](#Commander+sendCommand)*

<a name="new_Commander_new"></a>

### new Commander()
Commander

This is the base class of Redis, Redis.Cluster and Pipeline


| Param | Type | Default | Description |
| --- | --- | --- | --- |
| [options.showFriendlyErrorStack] | <code>boolean</code> | <code>false</code> | Whether to show a friendly error stack. Will decrease the performance significantly. |

<a name="Commander+getBuiltinCommands"></a>

### commander.getBuiltinCommands() ⇒ <code>Array.&lt;string&gt;</code>
Return supported builtin commands

**Kind**: instance method of <code>[Commander](#Commander)</code>  
**Returns**: <code>Array.&lt;string&gt;</code> - command list  
**Access:** public  
<a name="Commander+createBuiltinCommand"></a>

### commander.createBuiltinCommand(commandName) ⇒ <code>object</code>
Create a builtin command

**Kind**: instance method of <code>[Commander](#Commander)</code>  
**Returns**: <code>object</code> - functions  
**Access:** public  

| Param | Type | Description |
| --- | --- | --- |
| commandName | <code>string</code> | command name |

<a name="Commander+defineCommand"></a>

### commander.defineCommand(name, definition)
Define a custom command using lua script

**Kind**: instance method of <code>[Commander](#Commander)</code>  

| Param | Type | Default | Description |
| --- | --- | --- | --- |
| name | <code>string</code> |  | the command name |
| definition | <code>object</code> |  |  |
| definition.lua | <code>string</code> |  | the lua code |
| [definition.numberOfKeys] | <code>number</code> | <code></code> | the number of keys. If omit, you have to pass the number of keys as the first argument every time you invoke the command |

<a name="Commander+sendCommand"></a>

### *commander.sendCommand()*
Send a command

**Kind**: instance abstract method of <code>[Commander](#Commander)</code>  
**Access:** public  
<a name="defaultOptions"></a>

## defaultOptions
Default options

**Kind**: global variable  
**Access:** protected  
<a name="defaultOptions"></a>

## defaultOptions
Default options

**Kind**: global variable  
**Access:** protected  
