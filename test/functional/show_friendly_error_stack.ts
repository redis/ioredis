import Redis from '../../lib/redis'
import {expect} from 'chai'

var path = require('path');
var scriptName = path.basename(__filename);

describe('showFriendlyErrorStack', function () {
  it('should show friendly error stack', function (done) {
    var redis = new Redis({ showFriendlyErrorStack: true });
    redis.set('foo').catch(function (err) {
      var errors = err.stack.split('\n');
      expect(errors[0].indexOf('ReplyError')).not.eql(-1);
      expect(errors[1].indexOf(scriptName)).not.eql(-1);
      done();
    });
  });
});
