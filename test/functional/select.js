'use strict';

describe('select', function () {
  it('should support auto select', function (done) {
    var redis = new Redis({ db: 2 });
    redis.set('foo', '2');
    redis.select('2');
    redis.get('foo', function (err, res) {
      expect(res).to.eql('2');
      done();
    });
  });

  it('should resend commands to the correct db', function (done) {
    var redis = new Redis();
    redis.once('ready', function () {
      redis.set('foo', '2', function () {
        redis.stream.destroy();
        redis.select('3');
        redis.set('foo', '3');
        redis.select('0');
        redis.get('foo', function (err, res) {
          expect(res).to.eql('2');
          redis.select('3');
          redis.get('foo', function (err, res) {
            expect(res).to.eql('3');
            done();
          });
        });
      });
    });
  });

  it('should re-select the current db when reconnect', function (done) {
    var redis = new Redis();

    redis.once('ready', function () {
      redis.set('foo', 'bar');
      redis.select(2);
      redis.set('foo', '2', function () {
        redis.stream.destroy();
        redis.get('foo', function (err, res) {
          expect(res).to.eql('2');
          done();
        });
      });
    });
  });

  it('should emit "select" event when db changes', function (done) {
    var changes = [];
    var redis = new Redis();
    redis.on('select', function (db) {
      changes.push(db);
    });
    redis.select('2', function () {
      expect(changes).to.eql([2]);
      redis.select('4', function () {
        expect(changes).to.eql([2, 4]);
        redis.select('4', function () {
          expect(changes).to.eql([2, 4]);
          done();
        });
      });
    });
  });

  it('should be sent on the connect event', function (done) {
    var redis = new Redis({ db: 2 });
    var selectBuffer = redis.selectBuffer;
    redis.selectBuffer = function () {
      return selectBuffer.apply(redis, arguments).then(function () {
        redis.selectBuffer = selectBuffer;
        redis.disconnect();
        done();
      });
    };
    redis.on('connect', function () {
      redis.subscribe('anychannel');
    });
  });
});
