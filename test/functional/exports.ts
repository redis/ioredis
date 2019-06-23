import {Command, Cluster, ReplyError} from '../../lib'
import {expect} from 'chai'

describe('exports', function () {
  describe('.Command', function () {
    it('should be `Command`', function () {
      expect(Command).to.eql(require('../../lib/command').default)
    });
  });

  describe('.Cluster', function () {
    it('should be `Cluster`', function () {
      expect(Cluster).to.eql(require('../../lib/cluster').default)
    });
  });

  describe('.ReplyError', function () {
    it('should be `ReplyError`', function () {
      expect(ReplyError).to.eql(require('redis-errors').ReplyError)
    });
  });
});
