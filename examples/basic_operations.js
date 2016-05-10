'use strict';

var Redis = require('ioredis');
var redis = new Redis();

// ioredis supports all Redis commands:
redis.set('foo', 'bar');
redis.get('foo', function (err, result) {
  if (err) {
    console.error(err);
  } else {
    console.log(result);
  }
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

// Change the server configuration
redis.config('set', 'notify-keyspace-events', 'KEA')
