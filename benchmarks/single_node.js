'use strict';

var childProcess = require('child_process');
var nodeRedis = require('redis');
var IORedis = require('../');
var ndredis, ioredis;

console.log('==========================');
console.log('ioredis: ' + require('../package.json').version);
console.log('node_redis: ' + require('redis/package.json').version);
var os = require('os');
console.log('CPU: ' + os.cpus().length);
console.log('OS: ' + os.platform() + ' ' + os.arch());
console.log('node version: ' + process.version);
console.log('current commit: ' + childProcess.execSync('git rev-parse --short HEAD'));
console.log('==========================');

var waitReady = function (next) {
  var pending = 2;
  ndredis.on('ready', function () {
    if (!--pending) {
      next();
    }
  });

  ioredis.on('ready', function () {
    if (!--pending) {
      next();
    }
  });
};

suite('simple set', function () {
  set('mintime', 5000);
  set('concurrency', 300);
  before(function (start) {
    ndredis = nodeRedis.createClient();
    ioredis = new IORedis();
    waitReady(start);
  });

  bench('ioredis', function (next) {
    ioredis.set('foo', 'bar', next);
  });

  bench('node_redis', function (next) {
    ndredis.set('foo', 'bar', next);
  });

  after(function () {
    ndredis.quit();
    ioredis.quit();
  });
});

suite('simple get', function () {
  set('mintime', 5000);
  set('concurrency', 300);
  before(function (start) {
    ndredis = nodeRedis.createClient();
    ioredis = new IORedis();
    waitReady(function () {
      ndredis.set('foo', 'bar', start);
    });
  });

  bench('ioredis', function (next) {
    ioredis.get('foo', next);
  });

  bench('node_redis', function (next) {
    ndredis.get('foo', next);
  });

  after(function () {
    ndredis.quit();
    ioredis.quit();
  });
});

suite('simple get with pipeline', function () {
  set('mintime', 5000);
  set('concurrency', 300);
  before(function (start) {
    ndredis = nodeRedis.createClient();
    ioredis = new IORedis();
    waitReady(function () {
      ndredis.set('foo', 'bar', start);
    });
  });

  bench('ioredis', function (next) {
    var pipeline = ioredis.pipeline();
    for (var i = 0; i < 10; ++i) {
      pipeline.get('foo');
    }
    pipeline.exec(next);
  });

  bench('node_redis', function (next) {
    var pending = 0;
    for (var i = 0; i < 10; ++i) {
      pending += 1;
      ndredis.get('foo', check);
    }
    function check() {
      if (!--pending) {
        next();
      }
    }
  });

  after(function () {
    ndredis.quit();
    ioredis.quit();
  });
});

suite('lrange 100', function () {
  set('mintime', 5000);
  set('concurrency', 300);
  before(function (start) {
    ndredis = nodeRedis.createClient();
    ioredis = new IORedis();
    waitReady(function () {
      var item = [];
      for (var i = 0; i < 100; ++i) {
        item.push((Math.random() * 100000 | 0) + 'str');
      }
      ndredis.del('foo');
      ndredis.lpush('foo', item, start);
    });
  });

  bench('ioredis', function (next) {
    ioredis.lrange('foo', 0, 99, next);
  });

  bench('node_redis', function (next) {
    ndredis.lrange('foo', 0, 99, next);
  });

  after(function () {
    ndredis.quit();
    ioredis.quit();
  });
});

suite('publish', function () {
  set('mintime', 5000);
  set('concurrency', 300);

  before(function (start) {
    ndredis = nodeRedis.createClient();
    ioredis = new IORedis();
    waitReady(function () {
      start();
    });
  });

  bench('ioredis', function (next) {
    ioredis.publish('foo', 'bar', next);
  });

  bench('node_redis', function (next) {
    ndredis.publish('foo', 'bar', next);
  });

  after(function () {
    ndredis.quit();
    ioredis.quit();
  });
});

suite('subscribe', function () {
  set('mintime', 5000);
  set('concurrency', 300);

  var ndpublisher = null;
  var iopublisher = null;
  var ndsubscriber = null;
  var iosubscriber = null;

  before(function (start) {
    ndredis = nodeRedis.createClient();
    ioredis = new IORedis();
    waitReady(function () {
      ndsubscriber = ndredis;
      ndsubscriber.subscribe('foo');
      iosubscriber = ioredis;
      iosubscriber.subscribe('foo');

      ndredis = nodeRedis.createClient();
      ioredis = new IORedis();
      waitReady(function () {
        ndpublisher = ndredis;
        iopublisher = ioredis;
        start();
      });
    });
  });

  bench('ioredis', function (next) {
    iosubscriber.removeAllListeners('message');
    ndsubscriber.removeAllListeners('message');
    iosubscriber.on('message', next);
    iopublisher.publish('foo', 'bar');
  });

  bench('node_redis', function (next) {
    iosubscriber.removeAllListeners('message');
    ndsubscriber.removeAllListeners('message');
    ndsubscriber.on('message', next);
    ndpublisher.publish('foo', 'bar');
  });

  after(function () {
    ndredis.quit();
    ioredis.quit();
  });
});
