'use strict';

var childProcess = require('child_process');
var Redis = require('../');

console.log('==========================');
console.log('redis: ' + require('../package.json').version);
var os = require('os');
console.log('CPU: ' + os.cpus().length);
console.log('OS: ' + os.platform() + ' ' + os.arch());
console.log('node version: ' + process.version);
console.log('current commit: ' + childProcess.execSync('git rev-parse --short HEAD'));
console.log('==========================');

var redisJD, redisJ, redisBD, redisB;
var waitReady = function (next) {
  var pending = 4;
  function check() {
    if (!--pending) {
      next();
    }
  }
  redisJD = new Redis({ parser: 'javascript', dropBufferSupport: true });
  redisJ = new Redis({ parser: 'javascript', dropBufferSupport: false });
  redisBD = new Redis({ parser: 'hiredis', dropBufferSupport: true });
  redisB = new Redis({ parser: 'hiredis', dropBufferSupport: false });
  redisJD.on('ready', check);
  redisJ.on('ready', check);
  redisBD.on('ready', check);
  redisB.on('ready', check);
};

var quit = function () {
  redisJD.quit();
  redisJ.quit();
  redisBD.quit();
  redisB.quit();
};

suite('SET foo bar', function () {
  set('mintime', 5000);
  set('concurrency', 300);
  before(function (start) {
    waitReady(start);
  });

  bench('javascript parser + dropBufferSupport: true', function (next) {
    redisJD.set('foo', 'bar', next);
  });

  bench('javascript parser', function (next) {
    redisJ.setBuffer('foo', 'bar', next);
  });

  bench('hiredis parser + dropBufferSupport: true', function (next) {
    redisBD.set('foo', 'bar', next);
  });

  bench('hiredis parser', function (next) {
    redisB.setBuffer('foo', 'bar', next);
  });

  after(quit);
});

suite('LRANGE foo 0 99', function () {
  set('mintime', 5000);
  set('concurrency', 300);
  before(function (start) {
    var redis = new Redis();
    var item = [];
    for (var i = 0; i < 100; ++i) {
      item.push((Math.random() * 100000 | 0) + 'str');
    }
    redis.del('foo');
    redis.lpush('foo', item, function () {
      waitReady(start);
    });
  });

  bench('javascript parser + dropBufferSupport: true', function (next) {
    redisJD.lrange('foo', 0, 99, next);
  });

  bench('javascript parser', function (next) {
    redisJ.lrangeBuffer('foo', 0, 99, next);
  });

  bench('hiredis parser + dropBufferSupport: true', function (next) {
    redisBD.lrange('foo', 0, 99, next);
  });

  bench('hiredis parser', function (next) {
    redisB.lrangeBuffer('foo', 0, 99, next);
  });

  after(quit);
});
