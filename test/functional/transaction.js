describe('transaction', function () {
  it('should works like pipeline by default', function (done) {
    var redis = new Redis();
    redis.multi().set('foo', 'transaction').get('foo').exec(function (err, result) {
      expect(err).to.eql(null);
      expect(result).to.eql([[null, 'OK'], [null, 'transaction']]);
      done();
    });
  });

  it('should handle runtime errors correctly', function (done) {
    var redis = new Redis();
    redis.multi().set('foo', 'bar').lpush('foo', 'abc').exec(function (err, result) {
      expect(err).to.eql(null);
      expect(result.length).to.eql(2);
      expect(result[0]).to.eql([null, 'OK']);
      expect(result[1][0]).to.be.instanceof(Error);
      expect(result[1][0].toString()).to.match(/wrong kind of value/);
      done();
    });
  });

  it('should handle compile-time errors correctly', function (done) {
    var redis = new Redis();
    redis.multi().set('foo').get('foo').exec(function (err, result) {
      expect(err).to.be.instanceof(Error);
      expect(err.toString()).to.match(/Transaction discarded because of previous errors/);
      done();
    });
  });
});
