module.exports = require('./lib/redis');


// var Redis = module.exports;
// var redis = Redis(6381, 'localhost', {
//   auth: 'luin'
// });

// // // var Redis = require('redis');
// // // var redis = Redis.createClient();
// // // var util = require('util');

// var start;

// var pending = 0;
// var buffer = new Buffer('foo');
// function callback() {
//   if (!start) {
//     start = new Date();
//   }
//   pending += 1;
//   // redis.get(buffer, function () {
//   //   pending -= 1;
//   //   if (pending === 0) {
//   //     console.log(Date.now() - start);
//   //     redis.quit();
//   //   }
//   // });

//   // console.log('b');
//   // for (var j = 9; j <3013;+j) {
//   //   j += 1;
//   // }
//   // console.log('e');
//   // redis.get(buffer, console.log);
// // }

// // for (var i = 0; i < 100000; ++i) {
// //   callback();
// // }

// // setInterval(function () {
// //   callback();
// // }, 100);


// // // redis.get('foo').then(function (value) {
// // //   console.log(1);
// // // });
// // // redis.getBuffer('foo', function (err, result) {
// // //   console.log(2);
// // // });
// // // redis.getBuffer(['foo']).then(function (value) {
// // //   console.log(value);
// // //   console.log(2.5);
// // // });
// // // redis.get('foo', function (err, result) {
// // //   console.log(3);
// // // });
// // // redis.getBuffer('foo', function (err, result) {
// // //   console.log(4);
// // // });
// // // redis.quit();
// // // // redis.monitor().then(function (monitor) {
// // // //   monitor.on('monitor', function () {
// // // //     console.log(arguments);
// // // //   });
// // // // });
// // // // redis.on("monitor", function (time, args) {
// // // //   console.log(time + ": " + util.inspect(args));
// // // // });
// // // // redis.get('foo', function (err, b) {
// // //   // redis.get('foo1', function (err, _) {
// // //   //   console.log(b);
// // //   // });
// // // // });
