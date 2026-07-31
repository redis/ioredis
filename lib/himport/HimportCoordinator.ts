import Command from "../Command";
import { Debug } from "../utils";
import type { HimportFieldset } from "./types";

type HimportConnectionRole = "standalone" | "cluster" | "master" | "replica";

export interface HimportConnection {
  sendCommand(command: Command): unknown;
}

interface HimportPipelineOwner extends HimportConnection {
  slots?: readonly (readonly string[])[];
  connectionPool?: {
    getInstanceByKey(key: string): HimportConnection | undefined;
    getSampleInstance(role: "master"): HimportConnection | undefined;
  };
}

interface HimportPipelineInterception {
  owner: HimportPipelineOwner;
  commands: readonly Command[];
  slot?: number;
  preferredNodeKey?: string;
  setDestination(connection: HimportConnection): void;
  resume(): void;
  reject(error: Error): void;
}

interface HimportDefinition {
  readonly canonicalName: string;
  readonly name: string | Buffer;
  readonly fields: readonly (string | Buffer)[];
}

type PreparationState =
  | { status: "preparing"; promise: Promise<void> }
  | { status: "prepared" };

interface ConnectionSessionState {
  fieldsets: Map<string, PreparationState>;
}

interface ManagedSetContext {
  definition: HimportDefinition;
  lastConnection?: HimportConnection;
  resumeSend?: () => void;
  recoveryAttempts: number;
  recoveryInstalled: boolean;
  sendWithoutPreparationOn?: HimportConnection;
}

export interface HimportBinding {
  coordinator: HimportCoordinator;
  role: HimportConnectionRole;
}

const bindings = new WeakMap<object, HimportBinding>();
const internalCommands = new WeakSet<Command>();
const debug = Debug("himport");

function copyValue(value: string | Buffer): string | Buffer {
  return value instanceof Buffer ? Buffer.from(value) : value;
}

function canonicalize(value: string | Buffer): string {
  return Buffer.from(value).toString("base64");
}

function commandToken(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  return Buffer.isBuffer(value)
    ? value.toString("utf8").toUpperCase()
    : String(value).toUpperCase();
}

export function cloneHimportFieldsets(
  fieldsets: readonly HimportFieldset[] | undefined
): readonly HimportFieldset[] | undefined {
  if (fieldsets === undefined) {
    return undefined;
  }
  if (!Array.isArray(fieldsets)) {
    throw new TypeError("himportFieldsets must be an array");
  }

  const names = new Set<string>();
  const copied = fieldsets.map((fieldset) => {
    if (!fieldset || typeof fieldset !== "object") {
      throw new TypeError("Each HIMPORT fieldset must be an object");
    }
    if (typeof fieldset.name !== "string" && !Buffer.isBuffer(fieldset.name)) {
      throw new TypeError(
        "Each HIMPORT fieldset name must be a string or Buffer"
      );
    }
    if (!Array.isArray(fieldset.fields)) {
      throw new TypeError(
        "Each HIMPORT fieldset fields value must be an array"
      );
    }

    const name = copyValue(fieldset.name);
    const canonicalName = canonicalize(name);
    if (names.has(canonicalName)) {
      throw new TypeError("Duplicate HIMPORT fieldset name");
    }
    names.add(canonicalName);

    const fields = fieldset.fields.map((field) => {
      if (typeof field !== "string" && !Buffer.isBuffer(field)) {
        throw new TypeError("Each HIMPORT field must be a string or Buffer");
      }
      return copyValue(field);
    });

    return Object.freeze({
      name,
      fields: Object.freeze(fields),
    });
  });

  return Object.freeze(copied);
}

export default class HimportCoordinator {
  private readonly definitions: readonly HimportDefinition[];
  private readonly definitionsByName = new Map<string, HimportDefinition>();
  private readonly sessions = new WeakMap<
    HimportConnection,
    ConnectionSessionState
  >();
  private readonly managedSets = new WeakMap<Command, ManagedSetContext>();

  constructor(fieldsets: readonly HimportFieldset[]) {
    this.definitions = fieldsets.map((fieldset) => {
      const definition = {
        canonicalName: canonicalize(fieldset.name),
        name: fieldset.name,
        fields: fieldset.fields,
      };
      this.definitionsByName.set(definition.canonicalName, definition);
      return definition;
    });
  }

  get size(): number {
    return this.definitions.length;
  }

  beginSession(connection: HimportConnection): void {
    this.sessions.set(connection, {
      fieldsets: new Map(),
    });
  }

  detach(connection: HimportConnection): void {
    this.sessions.delete(connection);
  }

  invalidate(connection: HimportConnection): void {
    const session = this.sessions.get(connection);
    if (session) {
      session.fieldsets.clear();
    }
  }

  getDefinitions(): readonly HimportDefinition[] {
    return this.definitions;
  }

  classify(command: Command): ManagedSetContext | undefined {
    const existing = this.managedSets.get(command);
    if (existing) {
      return existing;
    }
    if (
      command.name.toLowerCase() !== "himport" ||
      commandToken(command.args[0]) !== "SET"
    ) {
      return undefined;
    }

    const fieldsetName = command.args[2];
    if (typeof fieldsetName !== "string" && !Buffer.isBuffer(fieldsetName)) {
      return undefined;
    }

    const definition = this.definitionsByName.get(canonicalize(fieldsetName));
    if (!definition) {
      return undefined;
    }

    const context: ManagedSetContext = {
      definition,
      recoveryAttempts: 0,
      recoveryInstalled: false,
    };
    this.managedSets.set(command, context);
    return context;
  }

  prepareCommand(
    connection: HimportConnection,
    command: Command
  ): Promise<void> | undefined {
    const context = this.classify(command);
    if (!context) {
      return undefined;
    }
    return this.ensurePrepared(connection, context.definition);
  }

  hasManagedSet(commands: readonly Command[]): boolean {
    return commands.some((command) => this.classify(command) !== undefined);
  }

  prepareCommands(
    connection: HimportConnection,
    commands: readonly Command[]
  ): Promise<void> | undefined {
    const preparations = new Set<Promise<void>>();
    for (const command of commands) {
      const preparation = this.prepareCommand(connection, command);
      if (preparation) {
        preparations.add(preparation);
      }
    }
    if (preparations.size === 0) {
      return undefined;
    }
    return Promise.all(preparations).then(() => undefined);
  }

  interceptCommand(
    connection: HimportConnection,
    command: Command,
    ready: boolean,
    resumeSend: () => void
  ): boolean {
    if (command.isSettled) {
      return true;
    }

    if (command.name.toLowerCase() === "reset") {
      this.invalidate(connection);
    }

    const managedSet = this.classify(command);
    if (!managedSet) {
      return false;
    }

    this.installRecovery(connection, command, resumeSend);
    const maySend = this.consumeAllowedSend(connection, command);
    if (!ready || maySend) {
      return false;
    }

    const preparation = this.prepareCommand(connection, command);
    if (!preparation) {
      return false;
    }

    preparation.then(
      () => {
        if (command.isSettled) {
          return;
        }
        try {
          this.allowNextSend(connection, command);
          resumeSend();
        } catch (error) {
          command.reject(error as Error);
        }
      },
      (error: Error) => {
        if (!command.isSettled) {
          command.reject(error);
        }
      }
    );
    return true;
  }

  allowNextSend(connection: HimportConnection, command: Command): void {
    const context = this.classify(command);
    if (context) {
      context.sendWithoutPreparationOn = connection;
    }
  }

  consumeAllowedSend(connection: HimportConnection, command: Command): boolean {
    const context = this.managedSets.get(command);
    if (context?.sendWithoutPreparationOn !== connection) {
      return false;
    }
    context.sendWithoutPreparationOn = undefined;
    return true;
  }

  installRecovery(
    connection: HimportConnection,
    command: Command,
    resumeSend: () => void
  ): void {
    const context = this.classify(command);
    if (!context) {
      return;
    }

    context.lastConnection = connection;
    context.resumeSend = resumeSend;
    if (context.recoveryInstalled) {
      return;
    }
    context.recoveryInstalled = true;

    const reject = command.reject;
    command.reject = (error: Error) => {
      if (command.isSettled) {
        return;
      }

      const recoveryConnection = context.lastConnection;
      const recoverySend = context.resumeSend;
      if (
        context.recoveryAttempts > 0 ||
        !recoveryConnection ||
        !recoverySend ||
        !isMissingFieldsetError(error)
      ) {
        reject.call(command, error);
        return;
      }

      context.recoveryAttempts += 1;
      this.markUnprepared(recoveryConnection, context.definition);
      const preparation = this.ensurePrepared(
        recoveryConnection,
        context.definition
      );

      Promise.resolve(preparation).then(
        () => {
          if (command.isSettled) {
            return;
          }
          try {
            this.allowNextSend(recoveryConnection, command);
            recoverySend();
          } catch (sendError) {
            reject.call(command, sendError as Error);
          }
        },
        (preparationError: Error) => {
          if (!command.isSettled) {
            reject.call(command, preparationError);
          }
        }
      );
    };
  }

  ensurePrepared(
    connection: HimportConnection,
    definition: HimportDefinition
  ): Promise<void> | undefined {
    const session = this.getSession(connection);
    const current = session.fieldsets.get(definition.canonicalName);

    if (current?.status === "prepared") {
      return undefined;
    }
    if (current?.status === "preparing") {
      return current.promise;
    }

    const command = new Command("himport", [
      "PREPARE",
      definition.name,
      ...definition.fields,
    ]);
    internalCommands.add(command);

    const promise = Promise.resolve(connection.sendCommand(command)).then(
      () => {
        if (this.sessions.get(connection) !== session) {
          return (
            this.ensurePrepared(connection, definition) ?? Promise.resolve()
          );
        }
        const latest = session.fieldsets.get(definition.canonicalName);
        if (latest?.status === "preparing" && latest.promise === promise) {
          session.fieldsets.set(definition.canonicalName, {
            status: "prepared",
          });
        }
      },
      (error: Error) => {
        if (this.sessions.get(connection) !== session) {
          return (
            this.ensurePrepared(connection, definition) ?? Promise.resolve()
          );
        }
        const latest = session.fieldsets.get(definition.canonicalName);
        if (latest?.status === "preparing" && latest.promise === promise) {
          session.fieldsets.delete(definition.canonicalName);
        }
        throw error;
      }
    );

    session.fieldsets.set(definition.canonicalName, {
      status: "preparing",
      promise,
    });
    return promise;
  }

  private getSession(connection: HimportConnection): ConnectionSessionState {
    let session = this.sessions.get(connection);
    if (!session) {
      session = {
        fieldsets: new Map(),
      };
      this.sessions.set(connection, session);
    }
    return session;
  }

  private markUnprepared(
    connection: HimportConnection,
    definition: HimportDefinition
  ): void {
    const fieldsets = this.getSession(connection).fieldsets;
    if (fieldsets.get(definition.canonicalName)?.status === "prepared") {
      fieldsets.delete(definition.canonicalName);
    }
  }
}

export function bindHimportCoordinator(
  owner: object,
  coordinator: HimportCoordinator,
  role: HimportConnectionRole
): void {
  bindings.set(owner, { coordinator, role });
}

export function getHimportBinding(owner: object): HimportBinding | undefined {
  return bindings.get(owner);
}

export function interceptHimportCommand(
  connection: HimportConnection,
  command: Command,
  ready: boolean,
  resumeSend: () => void
): boolean {
  const binding = bindings.get(connection);
  if (
    !binding ||
    binding.role === "replica" ||
    isInternalHimportCommand(command)
  ) {
    return false;
  }
  return binding.coordinator.interceptCommand(
    connection,
    command,
    ready,
    resumeSend
  );
}

export function interceptHimportPipeline({
  owner,
  commands,
  slot,
  preferredNodeKey,
  setDestination,
  resume,
  reject,
}: HimportPipelineInterception): boolean {
  const binding = bindings.get(owner);
  if (!binding || !binding.coordinator.hasManagedSet(commands)) {
    return false;
  }

  let connection: HimportConnection = owner;
  if (binding.role === "cluster") {
    const nodeKey = preferredNodeKey ?? owner.slots?.[slot]?.[0];
    const connectionPool = owner.connectionPool;
    const clusterConnection =
      (nodeKey && connectionPool?.getInstanceByKey(nodeKey)) ||
      connectionPool?.getSampleInstance("master");

    if (!clusterConnection) {
      reject(new Error("No master node is available for the pipeline"));
      return true;
    }

    connection = clusterConnection;
    setDestination(connection);
  }

  const preparation = binding.coordinator.prepareCommands(connection, commands);
  if (!preparation) {
    return false;
  }

  preparation.then(
    () => {
      try {
        resume();
      } catch (error) {
        reject(error as Error);
      }
    },
    (error: Error) => {
      reject(error);
    }
  );
  return true;
}

export function setHimportRole(
  owner: object,
  role: HimportConnectionRole
): void {
  const binding = bindings.get(owner);
  if (binding) {
    binding.role = role;
  }
}

export function unbindHimportCoordinator(owner: object): void {
  const binding = bindings.get(owner);
  if (binding) {
    binding.coordinator.detach(owner as HimportConnection);
    bindings.delete(owner);
  }
}

export function isInternalHimportCommand(command: Command): boolean {
  return internalCommands.has(command);
}

export function isHimportControlCommand(command: Command): boolean {
  if (command.name.toLowerCase() !== "himport") {
    return false;
  }
  return ["PREPARE", "DISCARD", "DISCARDALL"].includes(
    commandToken(command.args[0])
  );
}

export function interceptHimportControlCommand(
  connections: readonly HimportConnection[],
  command: Command
): boolean {
  if (!isHimportControlCommand(command) || connections.length === 0) {
    return false;
  }

  const replies = connections.map((connection) => {
    const clone = new Command(command.name, command.args);
    connection.sendCommand(clone);
    return clone.promise;
  });

  Promise.allSettled(replies).then((results) => {
    let firstReply: unknown;
    let hasFirstReply = false;

    for (const result of results) {
      if (result.status === "rejected") {
        command.reject(result.reason);
        return;
      }
      if (!hasFirstReply) {
        firstReply = result.value;
        hasFirstReply = true;
      } else if (String(result.value) !== String(firstReply)) {
        debug(
          "divergent HIMPORT reply across masters (%s != %s)",
          result.value,
          firstReply
        );
      }
    }

    command.resolve(firstReply);
  });

  return true;
}

function isMissingFieldsetError(error: Error): boolean {
  return error.message.toLowerCase().includes("no such fieldset");
}
