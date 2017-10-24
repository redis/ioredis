'use strict';

var real_debug = require('debug');

var debug = require('../../lib/utils/debug');

describe('utils/debug', function () {

  afterEach(function () {
    real_debug.enable(process.env.DEBUG || '');
  });

  describe('.exports.getStringValue', function () {
    it('should return a string or undefined', function () {
      expect(debug.getStringValue(true)).to.be.undefined;
      expect(debug.getStringValue(undefined)).to.be.undefined;
      expect(debug.getStringValue(null)).to.be.undefined;
      expect(debug.getStringValue(false)).to.be.undefined;
      expect(debug.getStringValue(1)).to.be.undefined;
      expect(debug.getStringValue(1.1)).to.be.undefined;
      expect(debug.getStringValue(-1)).to.be.undefined;
      expect(debug.getStringValue(-1.1)).to.be.undefined;

      expect(debug.getStringValue('abc')).to.be.a('string');
      expect(debug.getStringValue(Buffer.from ? Buffer.from('abc') : new Buffer('abc'))).to.be.a('string');
      expect(debug.getStringValue(new Date())).to.be.a('string');
      expect(debug.getStringValue({ foo: { bar: 'qux' } })).to.be.a('string');
    });
  });

  // describe('.exports.genRedactedString', function () {
  //   it('should return a string, truncated if applicable', function () {
  //     // TODO: the unit test underneath already tests the actual string truncation logic .
  //     //       .. so this one is not needed?
  //   });
  // });

  describe('.exports', function () {
    it('should return a function', function () {
      expect(debug('test')).to.be.a('function');
    });

    it('should output to console if DEBUG is set', function () {
      var dbg_ns = 'ioredis:debugtest';

      real_debug.enable(dbg_ns);

      var logspy = spy();
      var fn = debug(dbg_ns);

      fn.log = logspy;

      expect(fn.enabled).to.equal(true);
      expect(fn.namespace).to.equal(dbg_ns);

      var data = [], i = 0;

      while (i < 1000) {
        data.push(String(i)); i += 1;
      }

      var datastr = JSON.stringify(data);

      fn('my message %s', { json: data });
      expect(logspy.called).to.equal(true);

      var args = logspy.getCall(0).args;

      var wanted_arglen = 30 // " ... <REDACTED full-length="">"
                        + debug.MAX_ARGUMENT_LENGTH // max-length of redacted string
                        + datastr.length.toString().length; // length of string of string length (inception much?)

      expect(args.length).to.be.above(1);
      expect(args[1]).to.be.a('string');
      expect(args[1].length).to.equal(wanted_arglen);
    });
  });
});
