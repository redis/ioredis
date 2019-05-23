'use strict';

var Commander = require('../../lib/commander');

describe('Commander', function () {
  describe('#getBuiltinCommands()', () => {
    it('returns a new copy of commands', () => {
      const c = new Commander()
      const commands = c.getBuiltinCommands()
      commands.unshift('abc')
      const commandsNew = c.getBuiltinCommands()
      expect(commands.slice(1)).to.eql(commandsNew)
    })
  })

  it('should pass the correct arguments', function () {
    stub(Commander.prototype, 'sendCommand').callsFake(command => {
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
