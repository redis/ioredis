var bluebirdPromise = require('bluebird');
var nativePromise = global.Promise;

describe('Promise', function () {
  it('uses native promise by default', function () {
    var redis = new Redis();
    expect(redis.get('foo').constructor).to.eql(nativePromise)
  });

  it('can switch to a custom Promise implementation', function () {
    var origin = Redis.Promise;
    Redis.Promise = bluebirdPromise

    var redis = new Redis();
    expect(redis.get('foo').constructor).to.eql(bluebirdPromise)

    Redis.Promise = origin
    expect(redis.get('foo').constructor).to.eql(origin)
  });
});
