"use strict";

const Redis = require("ioredis");
const MyService = require("path/to/my/service");

// Create a custom connector that fetches sentinels from an external call
class AsyncSentinelConnector extends Redis.SentinelConnector {
  constructor(options = {}) {
    // Placeholder
    options.sentinels = options.sentinels || [
      { host: "localhost", port: 6379 }
    ];

    // SentinelConnector saves options as its property
    super(options);
  }

  connect(eventEmitter) {
    return MyService.getSentinels().then(sentinels => {
      this.options.sentinels = sentinels;
      this.sentinelIterator = new Redis.SentinelIterator(sentinels);
      return Redis.SentinelConnector.prototype.connect.call(this, eventEmitter);
    });
  }
}

const redis = new Redis({
  connector: new AsyncSentinelConnector()
});

// ioredis supports all Redis commands:
redis.set("foo", "bar");
redis.get("foo", function(err, result) {
  if (err) {
    console.error(err);
  } else {
    console.log(result);
  }
});
redis.del("foo");

// Or using a promise if the last argument isn't a function
redis.get("foo").then(function(result) {
  console.log(result);
});

// Arguments to commands are flattened, so the following are the same:
redis.sadd("set", 1, 3, 5, 7);
redis.sadd("set", [1, 3, 5, 7]);

// All arguments are passed directly to the redis server:
redis.set("key", 100, "EX", 10);

// Change the server configuration
redis.config("set", "notify-keyspace-events", "KEA");
