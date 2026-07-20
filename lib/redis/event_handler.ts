"use strict";

import Deque = require("denque");
import { AbortError } from "redis-errors";
import Command from "../Command";
import { MaxRetriesPerRequestError } from "../errors";
import { CommandItem, Respondable } from "../types";
import { Debug, noop, CONNECTION_CLOSED_ERROR_MSG } from "../utils";
import { PACKAGE_VERSION } from "../utils/version";
import DataHandler from "../DataHandler";

const debug = Debug("connection");

interface HandshakeCommand {
  kind: "hello" | "auth" | "select" | "client" | "readonly";
  send: () => Promise<unknown>;
  errorHandler?: (err: Error) => void;
}

function getHandshakeCommands(self: any): HandshakeCommand[] {
  const commands: HandshakeCommand[] = [];

  if (self.condition.protocol === 3) {
    const helloCommandArgs: Array<string | number> = [self.condition.protocol];

    if (self.condition.auth) {
      helloCommandArgs.push("AUTH");

      if (Array.isArray(self.condition.auth)) {
        helloCommandArgs.push(self.condition.auth[0], self.condition.auth[1]);
      } else {
        helloCommandArgs.push("default", self.condition.auth);
      }
    }

    commands.push({
      kind: "hello",
      send: () => self.hello(helloCommandArgs),
      errorHandler: handleAuthError,
    });
  } else if (self.condition.auth) {
    commands.push({
      kind: "auth",
      send: () => self.auth(self.condition.auth),
      errorHandler: handleAuthError,
    });
  }

  if (self.condition.select) {
    commands.push({
      kind: "select",
      send: () => self.select(self.condition.select),
      errorHandler: (err) => self.silentEmit("error", err),
    });
  }

  if (self.options.connectionName) {
    debug("set the connection name [%s]", self.options.connectionName);
    commands.push({
      kind: "client",
      send: () => self.client("setname", self.options.connectionName),
      errorHandler: noop,
    });
  }

  if (self.options.readOnly) {
    debug("set the connection to readonly mode");
    commands.push({
      kind: "readonly",
      send: () => self.readonly(),
      errorHandler: noop,
    });
  }

  if (!self.options.disableClientInfo) {
    debug("set the client info");

    commands.push({
      kind: "client",
      send: () => self.client("SETINFO", "LIB-VER", PACKAGE_VERSION),
      errorHandler: noop,
    });
    commands.push({
      kind: "client",
      send: () =>
        self.client(
          "SETINFO",
          "LIB-NAME",
          self.options?.clientInfoTag
            ? `ioredis(${self.options.clientInfoTag})`
            : "ioredis",
        ),
      errorHandler: noop,
    });
  }

  return commands;
}

async function sendHandshake(
  commands: HandshakeCommand[],
  protocol: number,
): Promise<void> {
  if (protocol !== 3) {
    await Promise.all(
      commands.map(({ send, errorHandler }) =>
        errorHandler ? send().catch(errorHandler) : send(),
      ),
    );
    return;
  }

  // HELLO may carry AUTH. Send everything optimistically, then inspect
  // HELLO before surfacing setup errors.
  const results = await Promise.allSettled(commands.map(({ send }) => send()));
  const helloIndex = commands.findIndex(({ kind }) => kind === "hello");
  const helloResult = helloIndex === -1 ? undefined : results[helloIndex];

  if (
    helloResult?.status === "rejected" &&
    isProtocolNegotiationError(helloResult.reason as Error)
  ) {
    throw helloResult.reason;
  }

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "rejected") {
      const { errorHandler } = commands[i];
      if (errorHandler) {
        errorHandler(result.reason as Error);
        continue;
      }
      throw result.reason;
    }
  }
}

export function connectHandler(self) {
  return async function () {
    try {
      self.resetCommandQueue();
      self.condition.handshake = true;
      self.setStatus("connect");

      /*
        No need to keep the reference of DataHandler here
        because we don't need to do the cleanup.
        `Stream#end()` will remove all listeners for us.
      */
      new DataHandler(self, {
        stringNumbers: self.options.stringNumbers,
        replyMapping: self.condition.replyMapping,
      });

      const { connectionEpoch } = self;
      const isActiveConnect = () =>
        connectionEpoch === self.connectionEpoch && self.status === "connect";
      const finishHandshake = () => {
        if (!isActiveConnect()) {
          return false;
        }
        self.condition.handshake = false;
        return true;
      };

      try {
        await sendHandshake(getHandshakeCommands(self), self.condition.protocol);
      } catch (err) {
        // The connection may have been closed (and possibly already
        // reconnected) while the client setup commands above were still
        // in flight. In that case this callback is stale and the
        // connection is no longer the one we are setting up, so calling
        // readyHandler() would mark a dead connection as "ready" and
        // permanently stop reconnection. The enableReadyCheck branch
        // below is already guarded by the same connectionEpoch check.
        // See https://github.com/redis/ioredis/issues/2099
        if (!isActiveConnect()) {
          return;
        }

        // Only an unsupported-RESP3 error is recoverable; everything else is fatal.
        if (!isProtocolNegotiationError(err as Error)) {
          return self.recoverFromFatalError(err, err);
        }

        // resp3 shapes are unavailable on RESP2, but the data is unaffected
        // (RESP2 never sends the remapped frames), so just warn — don't touch
        // the option.
        if (self.options.replyMapping === "resp3") {
          console.warn(
            '[WARN] replyMapping "resp3" was requested, but the server does not support RESP3. ' +
              "Replies will use RESP2-compatible shapes until connected to a server that supports RESP3.",
          );
        }

        debug("server rejected RESP3, downgrading connection to RESP2");
        self.condition.protocol = 2;
        self.condition.replyMapping = "legacy";

        try {
          await sendHandshake(
            getHandshakeCommands(self),
            self.condition.protocol,
          );
        } catch (downgradeErr) {
          if (!isActiveConnect()) {
            return;
          }
          return self.recoverFromFatalError(downgradeErr, downgradeErr);
        }
      }

      if (!isActiveConnect()) {
        return;
      }

      // Keep the public "connect" state/event while the internal handshake gate
      // stays closed. INFO is a handshake command so it's still writable here,
      // while a user SUBSCRIBE is not — it stays queued and can't race the
      // connection into subscriber mode before we're ready (which would get
      // INFO rejected).
      if (!self.options.enableReadyCheck) {
        if (!finishHandshake()) {
          return;
        }
        return exports.readyHandler(self)();
      }

      self._readyCheck(function (err: Error | null, info: unknown) {
        if (!isActiveConnect()) {
          return;
        }
        if (err) {
          self.recoverFromFatalError(err, err);
        } else if (self.connector.check(info)) {
          if (!finishHandshake()) {
            return;
          }
          exports.readyHandler(self)();
        } else {
          self.disconnect(true);
        }
      });
    } catch (err) {
      self.recoverFromFatalError(err as Error, err as Error);
    }
  };
}

function handleAuthError(err: Error): void {
  const msg = err.message || "";
  if (msg.indexOf("no password is set") !== -1) {
    console.warn(
      "[WARN] Redis server does not require a password, but a password was supplied.",
    );
    return;
  }
  if (
    msg.indexOf("without any password configured for the default user") !== -1
  ) {
    console.warn(
      "[WARN] This Redis server's `default` user does not require a password, but a password was supplied",
    );
    return;
  }
  if (msg.indexOf("wrong number of arguments for 'auth' command") !== -1) {
    console.warn(
      `[ERROR] The server returned "wrong number of arguments for 'auth' command". You are probably passing both username and password to Redis version 5 or below. You should only pass the 'password' option for Redis version 5 and under.`,
    );
    return;
  }
  throw err;
}

// True when HELLO 3 failed because the server can't do RESP3: no HELLO at all
// (Redis < 6) or HELLO present but the version refused (NOPROTO).
function isProtocolNegotiationError(err: Error): boolean {
  const msg = (err.message || "").toUpperCase();
  return (
    msg.includes("NOPROTO") ||
    (msg.includes("UNKNOWN COMMAND") && msg.includes("HELLO"))
  );
}

function abortError(command: Respondable) {
  const err = new AbortError("Command aborted due to connection close");
  (err as any).command = {
    name: command.name,
    args: command.args,
  };
  return err;
}

// If a contiguous set of pipeline commands starts from index zero then they
// can be safely reattempted. If however we have a chain of pipelined commands
// starting at index 1 or more it means we received a partial response before
// the connection close and those pipelined commands must be aborted. For
// example, if the queue looks like this: [2, 3, 4, 0, 1, 2] then after
// aborting and purging we'll have a queue that looks like this: [0, 1, 2]
function abortIncompletePipelines(commandQueue: Deque<CommandItem>) {
  let expectedIndex = 0;
  for (let i = 0; i < commandQueue.length; ) {
    const command = commandQueue.peekAt(i)?.command as Command;
    const pipelineIndex = command.pipelineIndex;
    if (pipelineIndex === undefined || pipelineIndex === 0) {
      expectedIndex = 0;
    }
    if (pipelineIndex !== undefined && pipelineIndex !== expectedIndex++) {
      commandQueue.remove(i, 1);
      command.reject(abortError(command));
      continue;
    }
    i++;
  }
}

// If only a partial transaction result was received before connection close,
// we have to abort any transaction fragments that may have ended up in the
// offline queue
function abortTransactionFragments(commandQueue: Deque<CommandItem>) {
  for (let i = 0; i < commandQueue.length; ) {
    const command = commandQueue.peekAt(i)?.command as Command;
    if (command.name === "multi") {
      break;
    }
    if (command.name === "exec") {
      commandQueue.remove(i, 1);
      command.reject(abortError(command));
      break;
    }
    if ((command as Command).inTransaction) {
      commandQueue.remove(i, 1);
      command.reject(abortError(command));
    } else {
      i++;
    }
  }
}

export function closeHandler(self) {
  return function () {
    const prevStatus = self.status;
    self.setStatus("close");

    if (self.commandQueue.length) {
      abortIncompletePipelines(self.commandQueue);
    }
    if (self.offlineQueue.length) {
      abortTransactionFragments(self.offlineQueue);
    }

    if (prevStatus === "ready") {
      if (!self.prevCondition) {
        self.prevCondition = self.condition;
      }
      if (self.commandQueue.length) {
        self.prevCommandQueue = self.commandQueue;
      }
    }

    if (self.manuallyClosing) {
      self.manuallyClosing = false;
      debug("skip reconnecting since the connection is manually closed.");
      return close();
    }

    if (typeof self.options.retryStrategy !== "function") {
      debug("skip reconnecting because `retryStrategy` is not a function");
      return close();
    }
    const retryDelay = self.options.retryStrategy(++self.retryAttempts);

    if (typeof retryDelay !== "number") {
      debug(
        "skip reconnecting because `retryStrategy` doesn't return a number",
      );
      return close();
    }

    debug("reconnect in %sms", retryDelay);

    self.setStatus("reconnecting", retryDelay);
    self.reconnectTimeout = setTimeout(function () {
      self.reconnectTimeout = null;
      self.connect().catch(noop);
    }, retryDelay);

    const { maxRetriesPerRequest } = self.options;
    if (typeof maxRetriesPerRequest === "number") {
      if (maxRetriesPerRequest < 0) {
        debug("maxRetriesPerRequest is negative, ignoring...");
      } else {
        const remainder = self.retryAttempts % (maxRetriesPerRequest + 1);
        if (remainder === 0) {
          debug(
            "reach maxRetriesPerRequest limitation, flushing command queue...",
          );
          self.flushQueue(new MaxRetriesPerRequestError(maxRetriesPerRequest));
        }
      }
    }
  };

  function close() {
    self.setStatus("end");
    self.flushQueue(new Error(CONNECTION_CLOSED_ERROR_MSG));
  }
}

export function errorHandler(self) {
  return function (error) {
    debug("error: %s", error);
    self.silentEmit("error", error);
  };
}

export function readyHandler(self) {
  return function () {
    self.setStatus("ready");
    self.retryAttempts = 0;

    if (self.options.monitor) {
      self.call("monitor").then(
        () => self.setStatus("monitoring"),
        (error: Error) => self.emit("error", error),
      );
      const { sendCommand } = self;
      self.sendCommand = function (command) {
        if (Command.checkFlag("VALID_IN_MONITOR_MODE", command.name)) {
          return sendCommand.call(self, command);
        }
        command.reject(
          new Error(
            "Connection is in monitoring mode, can't process commands.",
          ),
        );
        return command.promise;
      };
      self.once("close", function () {
        delete self.sendCommand;
      });
      return;
    }
    const finalSelect = self.prevCondition
      ? self.prevCondition.select
      : self.condition.select;

    if (self.prevCondition) {
      const condition = self.prevCondition;
      self.prevCondition = null;
      if (condition.subscriber && self.options.autoResubscribe) {
        // We re-select the previous db first since
        // `SELECT` command is not valid in sub mode.
        if (self.condition.select !== finalSelect) {
          debug("connect to db [%d]", finalSelect);
          self.select(finalSelect);
        }
        const subscribeChannels = condition.subscriber.channels("subscribe");
        if (subscribeChannels.length) {
          debug("subscribe %d channels", subscribeChannels.length);
          self.subscribe(subscribeChannels);
        }
        const psubscribeChannels = condition.subscriber.channels("psubscribe");
        if (psubscribeChannels.length) {
          debug("psubscribe %d channels", psubscribeChannels.length);
          self.psubscribe(psubscribeChannels);
        }
        const ssubscribeChannels = condition.subscriber.channels("ssubscribe");
        if (ssubscribeChannels.length) {
          debug("ssubscribe %s", ssubscribeChannels.length);
          for (const channel of ssubscribeChannels) {
            self.ssubscribe(channel);
          }
        }
      }
    }

    if (self.prevCommandQueue) {
      if (self.options.autoResendUnfulfilledCommands) {
        debug("resend %d unfulfilled commands", self.prevCommandQueue.length);
        while (self.prevCommandQueue.length > 0) {
          const item = self.prevCommandQueue.shift();
          if (
            item.select !== self.condition.select &&
            item.command.name !== "select"
          ) {
            self.select(item.select);
          }
          self.sendCommand(item.command, item.stream);
        }
      } else {
        self.prevCommandQueue = null;
      }
    }

    if (self.offlineQueue.length) {
      debug("send %d commands in offline queue", self.offlineQueue.length);
      const offlineQueue = self.offlineQueue;
      self.resetOfflineQueue();
      while (offlineQueue.length > 0) {
        const item = offlineQueue.shift();
        if (
          item.select !== self.condition.select &&
          item.command.name !== "select"
        ) {
          self.select(item.select);
        }
        self.sendCommand(item.command, item.stream);
      }
    }

    if (self.condition.select !== finalSelect) {
      debug("connect to db [%d]", finalSelect);
      self.select(finalSelect);
    }
  };
}
