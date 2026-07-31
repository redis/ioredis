import { expect } from "chai";
import Command from "../../lib/Command";
import HimportCoordinator, {
  cloneHimportFieldsets,
  HimportConnection,
} from "../../lib/himport/HimportCoordinator";

class FakeConnection implements HimportConnection {
  readonly commands: Command[] = [];
  prepareErrors: Array<Error | undefined> = [];

  sendCommand(command: Command): unknown {
    this.commands.push(command);

    if (
      command.name === "himport" &&
      String(command.args[0]).toUpperCase() === "PREPARE"
    ) {
      const error = this.prepareErrors.shift();
      if (error) {
        command.reject(error);
      } else {
        command.resolve(Buffer.from("OK"));
      }
    } else {
      command.resolve(Buffer.from("OK"));
    }

    return command.promise;
  }
}

class DeferredConnection implements HimportConnection {
  readonly commands: Command[] = [];

  sendCommand(command: Command): unknown {
    this.commands.push(command);
    return command.promise;
  }
}

describe("HimportCoordinator", () => {
  it("deep-copies and freezes configured fieldsets", () => {
    const name = Buffer.from("fieldset");
    const field = Buffer.from("field");
    const fields = [field];
    const source = [{ name, fields }];

    const copied = cloneHimportFieldsets(source);

    name.fill(0);
    field.fill(0);
    fields.push(Buffer.from("later"));
    source.push({ name: "other", fields: ["field"] });

    expect(copied).to.have.lengthOf(1);
    expect(copied[0].name.toString()).to.equal("fieldset");
    expect(copied[0].fields).to.have.lengthOf(1);
    expect(copied[0].fields[0].toString()).to.equal("field");
    expect(Object.isFrozen(copied)).to.equal(true);
    expect(Object.isFrozen(copied[0])).to.equal(true);
    expect(Object.isFrozen(copied[0].fields)).to.equal(true);
  });

  it("rejects duplicate names after binary canonicalization", () => {
    expect(() =>
      cloneHimportFieldsets([
        { name: "same", fields: ["a"] },
        { name: Buffer.from("same"), fields: ["b"] },
      ])
    ).to.throw("Duplicate HIMPORT fieldset name");
  });

  it("coalesces preparation and prepares once per session", async () => {
    const fieldsets = cloneHimportFieldsets([
      { name: "fieldset", fields: ["a", "b"] },
    ]);
    const coordinator = new HimportCoordinator(fieldsets);
    const connection = new FakeConnection();
    const set = new Command("himport", ["SET", "key", "fieldset", "1", "2"]);

    coordinator.beginSession(connection);
    const first = coordinator.prepareCommand(connection, set);
    const second = coordinator.prepareCommand(connection, set);

    expect(first).to.equal(second);
    await first;
    expect(connection.commands).to.have.lengthOf(1);
    expect(connection.commands[0].args).to.deep.equal([
      "PREPARE",
      "fieldset",
      "a",
      "b",
    ]);
    expect(coordinator.prepareCommand(connection, set)).to.equal(undefined);

    coordinator.beginSession(connection);
    await coordinator.prepareCommand(connection, set);
    expect(connection.commands).to.have.lengthOf(2);
  });

  it("retains preparation failures and retries on later use", async () => {
    const fieldsets = cloneHimportFieldsets([
      { name: "fieldset", fields: ["field"] },
    ]);
    const coordinator = new HimportCoordinator(fieldsets);
    const connection = new FakeConnection();
    const set = new Command("himport", ["SET", "key", "fieldset", "value"]);
    const rootCause = new Error("ERR duplicate field name in fieldset");

    connection.prepareErrors.push(rootCause);
    coordinator.beginSession(connection);

    let received: Error | undefined;
    try {
      await coordinator.prepareCommand(connection, set);
    } catch (error) {
      received = error as Error;
    }

    expect(received).to.equal(rootCause);

    await coordinator.prepareCommand(connection, set);
    expect(connection.commands).to.have.lengthOf(2);
    expect(coordinator.prepareCommand(connection, set)).to.equal(undefined);
  });

  it("does not treat an old-session preparation as current", async () => {
    const fieldsets = cloneHimportFieldsets([
      { name: "fieldset", fields: ["field"] },
    ]);
    const coordinator = new HimportCoordinator(fieldsets);
    const connection = new DeferredConnection();
    const set = new Command("himport", ["SET", "key", "fieldset", "value"]);

    coordinator.beginSession(connection);
    const oldSessionPreparation = coordinator.prepareCommand(connection, set);
    coordinator.beginSession(connection);
    const currentPreparation = coordinator.prepareCommand(connection, set);
    expect(connection.commands).to.have.lengthOf(2);

    let oldPreparationSettled = false;
    oldSessionPreparation.then(() => {
      oldPreparationSettled = true;
    });
    connection.commands[0].resolve(Buffer.from("OK"));
    await Promise.resolve();
    expect(oldPreparationSettled).to.equal(false);

    connection.commands[1].resolve(Buffer.from("OK"));
    await Promise.all([oldSessionPreparation, currentPreparation]);
    expect(oldPreparationSettled).to.equal(true);
    expect(coordinator.prepareCommand(connection, set)).to.equal(undefined);
  });

  it("re-prepares and retries once after a missing-fieldset error", async () => {
    const fieldsets = cloneHimportFieldsets([
      { name: "fieldset", fields: ["field"] },
    ]);
    const coordinator = new HimportCoordinator(fieldsets);
    const connection = new FakeConnection();
    const set = new Command("himport", ["SET", "key", "fieldset", "value"], {
      replyEncoding: "utf8",
    });

    coordinator.beginSession(connection);
    await coordinator.prepareCommand(connection, set);
    coordinator.installRecovery(connection, set, () => {
      connection.sendCommand(set);
    });

    set.reject(new Error("ERR no such fieldset"));

    expect(await set.promise).to.equal("OK");
    expect(
      connection.commands.filter(
        (command) => String(command.args[0]).toUpperCase() === "PREPARE"
      )
    ).to.have.lengthOf(2);
    expect(
      connection.commands.filter(
        (command) => String(command.args[0]).toUpperCase() === "SET"
      )
    ).to.have.lengthOf(1);
  });

  it("coalesces concurrent missing-fieldset recoveries", async () => {
    const fieldsets = cloneHimportFieldsets([
      { name: "fieldset", fields: ["field"] },
    ]);
    const coordinator = new HimportCoordinator(fieldsets);
    const connection = new DeferredConnection();
    const firstSet = new Command(
      "himport",
      ["SET", "key:1", "fieldset", "value"],
      { replyEncoding: "utf8" }
    );
    const secondSet = new Command(
      "himport",
      ["SET", "key:2", "fieldset", "value"],
      { replyEncoding: "utf8" }
    );

    coordinator.beginSession(connection);
    const initialPreparation = coordinator.prepareCommand(connection, firstSet);
    connection.commands[0].resolve(Buffer.from("OK"));
    await initialPreparation;

    coordinator.installRecovery(connection, firstSet, () => {
      connection.sendCommand(firstSet);
    });
    coordinator.installRecovery(connection, secondSet, () => {
      connection.sendCommand(secondSet);
    });

    firstSet.reject(new Error("ERR no such fieldset"));
    secondSet.reject(new Error("ERR no such fieldset"));

    const preparations = connection.commands.filter(
      (command) => String(command.args[0]).toUpperCase() === "PREPARE"
    );
    expect(preparations).to.have.lengthOf(2);

    preparations[1].resolve(Buffer.from("OK"));
    await preparations[1].promise;
    await Promise.resolve();

    const retriedSets = connection.commands.filter(
      (command) => String(command.args[0]).toUpperCase() === "SET"
    );
    expect(retriedSets).to.have.lengthOf(2);
    for (const command of retriedSets) {
      command.resolve(Buffer.from("OK"));
    }
    expect(await Promise.all([firstSet.promise, secondSet.promise])).to.eql([
      "OK",
      "OK",
    ]);
  });
});
