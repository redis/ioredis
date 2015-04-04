describe('pipeline', function () {
  it('should return correct result', function (done) {
    var redis = new Redis();
    redis.pipeline().set('foo', '1').get('foo').set('foo', '2').incr('foo').get('foo').exec(function (err, results) {
      expect(err).to.eql(null);
      expect(results).to.eql([
        [null, 'OK'],
        [null, '1'],
        [null, 'OK'],
        [null, 3],
        [null, '3']
      ]);
      done();
    });
  });

  it('should support mix string command and buffer command', function (done) {
    var redis = new Redis();
    redis.pipeline().set('foo', 'bar').set('foo', new Buffer('bar')).getBuffer('foo').get(new Buffer('foo')).exec(function (err, results) {
      expect(err).to.eql(null);
      expect(results).to.eql([
        [null, 'OK'],
        [null, 'OK'],
        [null, new Buffer('bar')],
        [null, 'bar']
      ]);
      done();
    });
  });

  it('should handle error correctly', function (done) {
    var redis = new Redis();
    redis.pipeline().set('foo').exec(function (err, results) {
      expect(err).to.eql(null);
      expect(results.length).to.eql(1);
      expect(results[0].length).to.eql(1);
      expect(results[0][0].toString()).to.match(/wrong number of arguments/);
      done();
    });
  });
});
