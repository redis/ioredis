var Redis = require('redis');
var redis = Redis.createClient();

redis.multi().set('foo', 'bar').get('foo').set('foo').get('foo').exec(function (err, result) {
  console.log(err, result);
});
