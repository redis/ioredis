import * as sinon from "sinon";
import { expect } from "chai";
import Commander from "../../lib/commander";

describe("Commander", function () {
  describe("#getBuiltinCommands()", () => {
    it("returns a new copy of commands", () => {
      const c = new Commander();
      const commands = c.getBuiltinCommands();
      commands.unshift("abc");
      const commandsNew = c.getBuiltinCommands();
      expect(commands.slice(1)).to.eql(commandsNew);
    });
  });

  describe("#addBuiltinCommand()", () => {
    beforeEach(() => sinon.spy(Commander.prototype, "sendCommand"));
    afterEach(() => sinon.restore());
    it("adds string command", () => {
      const c = new Commander();
      c.addBuiltinCommand("someCommand");
      c.someCommand();
      const command = Commander.prototype.sendCommand.getCall(0).args[0];
      expect(command.name).to.eql("someCommand");
      expect(command.replyEncoding).to.eql("utf8");
    });

    it("adds buffer command", () => {
      const c = new Commander();
      c.addBuiltinCommand("someCommand");
      c.someCommandBuffer();
      const command = Commander.prototype.sendCommand.getCall(0).args[0];
      expect(command.name).to.eql("someCommand");
      expect(command.replyEncoding).to.eql(null);
    });
  });

  it("should pass the correct arguments", function () {
    sinon.stub(Commander.prototype, "sendCommand").callsFake((command) => {
      return command;
    });

    let command;

    const c = new Commander();
    command = c.call("set", "foo", "bar");
    expect(command.name).to.eql("set");
    expect(command.args[0]).to.eql("foo");
    expect(command.args[1]).to.eql("bar");

    command = c.callBuffer("set", ["foo", "bar"]);
    expect(command.name).to.eql("set");
    expect(command.args[0]).to.eql("foo");
    expect(command.args[1]).to.eql("bar");

    command = c.call("set", "foo", "bar", function () {});
    expect(command.name).to.eql("set");
    expect(command.args.length).to.eql(2);

    command = c.callBuffer("set", "foo", "bar", function () {});
    expect(command.name).to.eql("set");
    expect(command.args.length).to.eql(2);

    Commander.prototype.sendCommand.restore();
  });
});
