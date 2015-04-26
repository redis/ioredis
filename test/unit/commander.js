'use strict';

var Commander = require('../../lib/commander');

describe('Commander', function () {
  it('should pass the correct arguments', function () {
    stub(Commander.prototype, 'sendCommand', function (command) {
      return command;
    });

    var command;

    var c = new Commander();
    command = c.call('set', 'foo', 'bar');
    expect(command.name).to.eql('set');
    expect(command.args[0]).to.eql('foo');
    expect(command.args[1]).to.eql('bar');

    command = c.callBuffer('set', ['foo', 'bar']);
    expect(command.name).to.eql('set');
    expect(command.args[0]).to.eql('foo');
    expect(command.args[1]).to.eql('bar');

    command = c.call('set', 'foo', 'bar', function () {});
    expect(command.name).to.eql('set');
    expect(command.args.length).to.eql(2);

    command = c.callBuffer('set', 'foo', 'bar', function () {});
    expect(command.name).to.eql('set');
    expect(command.args.length).to.eql(2);

    Commander.prototype.sendCommand.restore();
  });
});
