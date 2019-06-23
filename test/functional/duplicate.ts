import Redis from '../../lib/redis'
import {expect} from 'chai'

describe('duplicate', () => {
  it('clone the options', () => {
    var redis = new Redis()
    var duplicatedRedis = redis.duplicate()
    redis.options.port = 1234
    expect(duplicatedRedis.options.port).to.eql(6379)
  });
});
