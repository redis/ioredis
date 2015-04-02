ioredis
========

[![Join the chat at https://gitter.im/luin/ioredis](https://badges.gitter.im/Join%20Chat.svg)](https://gitter.im/luin/ioredis?utm_source=badge&utm_medium=badge&utm_campaign=pr-badge&utm_content=badge)
A delightful, performance-focused Redis client for Node and io.js

Instal
------

```shell
$ npm install ioredis
```

Usage
------

```javascript
var Redis = require('ioredis');
var redis = new Redis();

redis.set('foo', 'bar');
redis.get('foo', function (err, result) {
  console.log(result);
});

// or using promise
redis.get('foo').then(function (result) {
  console.log(result);
});
```
