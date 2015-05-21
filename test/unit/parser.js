'use strict';

['javascript', 'hiredis'].forEach(function (type) {
  var Parser;
  if (type === 'hiredis') {
    try {
      Parser = require('../../lib/parsers/hiredis');
    } catch (err) {
      if (err.message.match(/Cannot find module/)) {
        return;
      }
      throw err;
    }
  } else {
    Parser = require('../../lib/parsers/javascript');
  }

  describe(type + ' parser', function () {
    it('should return the correct reply', function (done) {
      var parser = new Parser({ returnBuffers: true });
      parser.on('reply', function (res) {
        expect(res.toString()).to.eql('OK');
        done();
      });
      parser.execute(new Buffer('+OK\r\n'));
    });

    it('should return bulk strings', function (done) {
      var parser = new Parser({ returnBuffers: true });
      parser.on('reply', function (res) {
        expect(res.toString()).to.eql('OK');
        done();
      });
      parser.execute(new Buffer('$2\r\nOK\r\n'));
    });

    it('should support return string directly', function (done) {
      var parser = new Parser({ returnBuffers: false });
      parser.on('reply', function (res) {
        expect(res).to.eql('OK');
        done();
      });
      parser.execute(new Buffer('+OK\r\n'));
    });

    it('should return integer correctly', function (done) {
      var parser = new Parser({ returnBuffers: false });
      parser.on('reply', function (res) {
        expect(res).to.eql(178);
        done();
      });
      parser.execute(new Buffer(':178\r\n'));
    });

    it('should return error correctly', function (done) {
      var parser = new Parser({ returnBuffers: false });
      parser.on('reply error', function (res) {
        expect(res).to.be.instanceof(Redis.ReplyError);
        expect(res.name).to.eql('ReplyError');
        expect(res.message).to.eql('ERR error');
        done();
      });
      parser.execute(new Buffer('-ERR error\r\n'));
    });

    it('should return array correctly', function (done) {
      var parser = new Parser({ returnBuffers: false });
      parser.on('reply', function (res) {
        expect(res).to.eql(['foo', [3, 'bar']]);
        done();
      });
      parser.execute(new Buffer('*2\r\n$3\r\nfoo\r\n*2\r\n:3\r\n$3\r\nbar\r\n'));
    });

    it('should support partial data', function (done) {
      var parser = new Parser({ returnBuffers: false });
      parser.on('reply', function (res) {
        expect(res).to.eql(['foo', [3, 'bar']]);
        done();
      });
      parser.execute(new Buffer('*2\r\n$3\r\nfoo\r'));
      setTimeout(function () {
        parser.execute(new Buffer(''));
        setTimeout(function () {
          parser.execute(new Buffer('\n*2\r\n:3\r\n$3\r\nbar\r\n'));
        });
      }, 1);
    });
  });
});
