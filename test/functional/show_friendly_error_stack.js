'use strict';

describe('showFriendlyErrorStack', function () {
  it('should show friendly error stack', function (done) {
    var redis = new Redis({ showFriendlyErrorStack: true });
    stub(process.stderr, 'write', function (data) {
      var errors = data.split('\n');
      if (errors[0].indexOf('Unhandled') !== -1) {
        expect(errors[0].indexOf('ReplyError')).not.eql(-1);
        expect(errors[1].indexOf('show_friendly_error_stack.js')).not.eql(-1);
        process.stderr.write.restore();
        done();
      }
    });
    redis.set('foo');
  });
});
