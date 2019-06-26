import { execSync } from "child_process";
import Redis from "../lib/redis";

console.log("==========================");
console.log("redis: " + require("../package.json").version);
var os = require("os");
console.log("CPU: " + os.cpus().length);
console.log("OS: " + os.platform() + " " + os.arch());
console.log("node version: " + process.version);
console.log("current commit: " + execSync("git rev-parse --short HEAD"));
console.log("==========================");

var redisJD, redisJ;
var waitReady = function(next) {
  var pending = 2;
  function check() {
    if (!--pending) {
      next();
    }
  }
  redisJD = new Redis({ dropBufferSupport: true });
  redisJ = new Redis({ dropBufferSupport: false });
  redisJD.on("ready", check);
  redisJ.on("ready", check);
};

var quit = function() {
  redisJD.quit();
  redisJ.quit();
};

suite("SET foo bar", function() {
  // @ts-ignore
  set("mintime", 5000);
  // @ts-ignore
  set("concurrency", 300);
  before(function(start) {
    waitReady(start);
  });

  // @ts-ignore
  bench("javascript parser + dropBufferSupport: true", function(next) {
    redisJD.set("foo", "bar", next);
  });

  // @ts-ignore
  bench("javascript parser", function(next) {
    redisJ.set("foo", "bar", next);
  });

  after(quit);
});

suite("LRANGE foo 0 99", function() {
  // @ts-ignore
  set("mintime", 5000);
  // @ts-ignore
  set("concurrency", 300);
  before(function(start) {
    var redis = new Redis();
    var item = [];
    for (var i = 0; i < 100; ++i) {
      item.push(((Math.random() * 100000) | 0) + "str");
    }
    redis.del("foo");
    redis.lpush("foo", item, function() {
      waitReady(start);
    });
  });

  // @ts-ignore
  bench("javascript parser + dropBufferSupport: true", function(next) {
    redisJD.lrange("foo", 0, 99, next);
  });

  // @ts-ignore
  bench("javascript parser", function(next) {
    redisJ.lrange("foo", 0, 99, next);
  });

  after(quit);
});
