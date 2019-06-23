import real_debug = require('debug')
import * as sinon from 'sinon'
import {expect} from 'chai'
import debug, {getStringValue, MAX_ARGUMENT_LENGTH} from '../../lib/utils/debug'

describe('utils/debug', function () {

  afterEach(function () {
    real_debug.enable(process.env.DEBUG || '');
  });

  describe('.exports.getStringValue', function () {
    it('should return a string or undefined', function () {
      expect(getStringValue(true)).to.be.undefined;
      expect(getStringValue(undefined)).to.be.undefined;
      expect(getStringValue(null)).to.be.undefined;
      expect(getStringValue(false)).to.be.undefined;
      expect(getStringValue(1)).to.be.undefined;
      expect(getStringValue(1.1)).to.be.undefined;
      expect(getStringValue(-1)).to.be.undefined;
      expect(getStringValue(-1.1)).to.be.undefined;

      expect(getStringValue('abc')).to.be.a('string');
      expect(getStringValue(Buffer.from ? Buffer.from('abc') : Buffer.from('abc'))).to.be.a('string');
      expect(getStringValue(new Date())).to.be.a('string');
      expect(getStringValue({ foo: { bar: 'qux' } })).to.be.a('string');
    });
  });

  describe('.exports', function () {
    it('should return a function', function () {
      expect(debug('test')).to.be.a('function');
    });

    it('should output to console if DEBUG is set', function () {
      var dbg_ns = 'ioredis:debugtest';

      real_debug.enable(dbg_ns);

      var logspy = sinon.spy();
      var fn = debug('debugtest');

      // @ts-ignore
      fn.log = logspy;

      // @ts-ignore
      expect(fn.enabled).to.equal(true);
      // @ts-ignore
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
                        + MAX_ARGUMENT_LENGTH // max-length of redacted string
                        + datastr.length.toString().length; // length of string of string length (inception much?)

      expect(args.length).to.be.above(1);
      expect(args[1]).to.be.a('string');
      expect(args[1].length).to.equal(wanted_arglen);
    });
  });
});
