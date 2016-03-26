'use strict';

var ioredis = require('../..');
describe('index', function () {
  describe('print()', function () {
    it('prints logs', function () {
      stub(console, 'log');
      ioredis.print(new Error('err'));
      ioredis.print(null, 'success');
      expect(console.log.calledTwice).to.eql(true);
      console.log.restore();
    });
  });
});

