'use strict';

describe('watch-exec', function () {

  it('should support watch/exec transactions', function (done) {
    var redis1 = new Redis();
    redis1.watch('watchkey')
      .then(function() {
        return redis1.multi().set('watchkey', '1').exec();
      })
      .then(function(result) {
        expect(result.length).to.eql(1);
        expect(result[0]).to.eql([null, 'OK']);
      })
      .nodeify(done);
  });

  it('should support watch/exec transaction rollback', function (done) {
    var redis1 = new Redis();
    var redis2 = new Redis();
    redis1.watch('watchkey')
      .then(function() {
        return redis2.set('watchkey', '2');
      })
      .then(function() {
        return redis1.multi().set('watchkey', '1').exec();
      })
      .then(function(result) {
        expect(result).to.be.null;
      })
      .nodeify(done);
  });

});
