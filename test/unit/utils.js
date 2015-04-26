var utils = require('../../lib/utils');
describe('utils', function () {
  describe('.bufferEqual', function () {
    it('should return correctly', function () {
      expect(utils.bufferEqual(new Buffer('123'), new Buffer('abc'))).to.eql(false);
      expect(utils.bufferEqual(new Buffer('abc'), new Buffer('abc'))).to.eql(true);
      expect(utils.bufferEqual(new Buffer('bc'), new Buffer('abc'))).to.eql(false);
      expect(utils.bufferEqual(new Buffer(''), new Buffer(''))).to.eql(true);
    });

    it('should work when Buffer#equals not exists', function () {
      var equals = Buffer.prototype.equals;
      delete Buffer.prototype.equals;
      expect(utils.bufferEqual(new Buffer('123'), new Buffer('abc'))).to.eql(false);
      expect(utils.bufferEqual(new Buffer('abc'), new Buffer('abc'))).to.eql(true);
      expect(utils.bufferEqual(new Buffer('bc'), new Buffer('abc'))).to.eql(false);
      expect(utils.bufferEqual(new Buffer(''), new Buffer(''))).to.eql(true);
      Buffer.prototype.equals = equals;
    });
  });

  describe('.convertBufferToString', function () {
    it('should return correctly', function () {
      expect(utils.convertBufferToString(new Buffer('123'))).to.eql('123');
      expect(utils.convertBufferToString([new Buffer('abc'), new Buffer('abc')])).to.eql(['abc', 'abc']);
      expect(utils.convertBufferToString([new Buffer('abc'), [[new Buffer('abc')]]])).to.eql(['abc', [['abc']]]);
      expect(utils.convertBufferToString([new Buffer('abc'), 5, 'b', [[new Buffer('abc'), 4]]])).to.eql(['abc', 5, 'b', [['abc', 4]]]);
    });
  });

  describe('.wrapMultiResult', function () {
    it('should return correctly', function () {
      expect(utils.wrapMultiResult([1, 2])).to.eql([[null, 1], [null, 2]]);
      expect(utils.wrapMultiResult([1, 2, new Error('2')])).to.eql([[null, 1], [null, 2], [new Error('2')]]);
    });
  });

  describe('.isInt', function () {
    it('should return correctly', function () {
      expect(utils.isInt(2)).to.eql(true);
      expect(utils.isInt('2231')).to.eql(true);
      expect(utils.isInt('s')).to.eql(false);
      expect(utils.isInt('1s')).to.eql(false);
      expect(utils.isInt(false)).to.eql(false);
    });
  });

  describe('.packObject', function () {
    it('should return correctly', function () {
      expect(utils.packObject([1, 2])).to.eql({ 1: 2 });
      expect(utils.packObject([1, '2'])).to.eql({ 1: '2' });
      expect(utils.packObject([1, '2', 'abc', 'def'])).to.eql({ 1: '2', abc: 'def' });
    });
  });

  describe('.timeout', function () {
    it('should return a callback', function (done) {
      var invoked = false;
      var wrappedCallback1 = utils.timeout(function () {
        invoked = true;
      }, 0);
      wrappedCallback1();

      var invokedTimes = 0;
      var wrappedCallback2 = utils.timeout(function (err) {
        expect(err.message).to.match(/timeout/);
        invokedTimes += 1;
        wrappedCallback2();
        setTimeout(function () {
          expect(invoked).to.eql(true);
          expect(invokedTimes).to.eql(1);
          done();
        }, 0);
      }, 0);
    });
  });

  describe('.convertObjectToArray', function () {
    it('should return correctly', function () {
      expect(utils.convertObjectToArray({ 1: 2 })).to.eql(['1', 2]);
      expect(utils.convertObjectToArray({ 1: '2' })).to.eql(['1', '2']);
      expect(utils.convertObjectToArray({ 1: '2', abc: 'def' })).to.eql(['1', '2', 'abc', 'def']);
    });
  });

  describe('.convertMapToArray', function () {
    it('should return correctly', function () {
      if (typeof Map !== 'undefined') {
        expect(utils.convertMapToArray(new Map([['1', 2]]))).to.eql(['1', 2]);
        expect(utils.convertMapToArray(new Map([[1, 2]]))).to.eql([1, 2]);
        expect(utils.convertMapToArray(new Map([[1, '2'], ['abc', 'def']]))).to.eql([1, '2', 'abc', 'def']);
      }
    });
  });

  describe('.calcSlot', function () {
    it('should return correctly', function () {
      expect(utils.calcSlot('123')).to.eql(5970);
      expect(utils.calcSlot('ab{c')).to.eql(4619);
      expect(utils.calcSlot('ab{c}2')).to.eql(7365);
      expect(utils.calcSlot('ab{{c}2')).to.eql(2150);
      expect(utils.calcSlot('ab{qq}{c}2')).to.eql(5598);
      expect(utils.calcSlot('ab}')).to.eql(11817);
      expect(utils.calcSlot('encoding')).to.eql(3060);
    });
  });

  describe('.toArg', function () {
    it('should return correctly', function () {
      expect(utils.toArg(null)).to.eql('');
      expect(utils.toArg(undefined)).to.eql('');
      expect(utils.toArg('abc')).to.eql('abc');
      expect(utils.toArg(123)).to.eql('123');
    });
  });

  describe('.optimizeErrorStack', function () {
    it('should return correctly', function () {
      var error = new Error();
      var res = utils.optimizeErrorStack(error, new Error().stack + '\n@', __dirname);
      expect(res.stack.split('\n').pop()).to.eql('@');
    });
  });
});
