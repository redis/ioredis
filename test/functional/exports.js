describe('exports', function () {
  describe('.Command', function () {
    it('should be `Command`', function () {
      var Command = require('../../lib/command');
      expect(Redis.Command).to.eql(Command);
    });
  });

  describe('.Cluster', function () {
    it('should be `Cluster`', function () {
      var Cluster = require('../../lib/cluster').default;
      expect(Redis.Cluster).to.eql(Cluster);
    });
  });

  describe('.ReplyError', function () {
    it('should be `ReplyError`', function () {
      var {ReplyError} = require('redis-errors');
      expect(Redis.ReplyError).to.eql(ReplyError);
    });
  });
});
