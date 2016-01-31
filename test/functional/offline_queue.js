'use strict';

describe('offline queue', function () {
  context('maxOfflineQueueSize', function () {
    it('should shift out the oldest command', function (done) {
      var redis = new Redis({
        maxOfflineQueueSize: 3,
        port: 17891
      });

      var rejected = 0;
      redis.set('foo', 'bar', function (err) {
        expect(++rejected).to.eql(1);
        expect(err).to.have.property('message', 'Offline queue is full');
      });

      redis.set('foo', 'bar', function (err) {
        expect(++rejected).to.eql(2);
        expect(err).to.have.property('message', 'Offline queue is full');
        expect(redis.offlineQueue.get(0).command.args[0]).to.eql('foo1');
        expect(redis.offlineQueue.get(1).command.args[0]).to.eql('foo2');
        expect(redis.offlineQueue.get(2).command.args[0]).to.eql('foo3');
        done();
      });

      redis.set('foo1', 'bar');
      redis.set('foo2', 'bar');
      redis.set('foo3', 'bar');
    });
  });
});
