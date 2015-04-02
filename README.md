ioredis
========

[![Build Status](https://travis-ci.org/luin/ioredis.png?branch=master)](https://travis-ci.org/luin/ioredis)

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
