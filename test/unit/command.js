var Command = require('../../lib/command');

describe('Command', function () {
  describe('constructor()', function () {
    it('should reject when the command isnt a string', function () {
      var command = new Command(123);
      return command.promise.catch(function (err) {
        expect(err).to.be.instanceof(Error);
      });
    });

    it('should flatten the args', function () {
      var command = new Command('get', ['foo', ['bar', ['zoo']]]);
      expect(command.args).to.eql(['foo', 'bar', ['zoo']]);
    });
  });

  describe('#toWritable()', function () {
    it('should return correct string', function () {
      var command = new Command('get', ['foo', 'bar', 'zooo']);
      expect(command.toWritable()).to.eql('*4\r\n$3\r\nget\r\n$3\r\nfoo\r\n$3\r\nbar\r\n$4\r\nzooo\r\n');
    });

    it('should return buffer when there\'s at least one arg is a buffer', function () {
      var command = new Command('get', ['foo', new Buffer('bar'), 'zooo']);
      var result = command.toWritable();
      expect(result).to.be.instanceof(Buffer);
      expect(result.toString()).to.eql('*4\r\n$3\r\nget\r\n$3\r\nfoo\r\n$3\r\nbar\r\n$4\r\nzooo\r\n');
    });
  });
});
