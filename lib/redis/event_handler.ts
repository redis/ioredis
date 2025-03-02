"use strict";

import Deque = require("denque");
import { AbortError } from "redis-errors";
import Command from "../Command";
import { MaxRetriesPerRequestError } from "../errors";
import { CommandItem, Respondable } from "../types";
import { Debug, noop, CONNECTION_CLOSED_ERROR_MSG } from "../utils";
import DataHandler from "../DataHandler";

const debug = Debug("connection");

export function connectHandler(self) {
  return function () {
    self.setStatus("connect");

    self.resetCommandQueue();

    // AUTH command should be processed before any other commands
    let flushed = false;
    const { connectionEpoch } = self;
    if (self.condition.auth) {
      self.auth(self.condition.auth, function (err) {
        if (connectionEpoch !== self.connectionEpoch) {
          return;
        }
        if (err) {
          if (err.message.indexOf("no password is set") !== -1) {
            self.options.logger.warn(
              "[WARN] Redis server does not require a password, but a password was supplied."
            );
          } else if (
            err.message.indexOf(
              "without any password configured for the default user"
            ) !== -1
          ) {
            self.options.logger.warn(
              "[WARN] This Redis server's `default` user does not require a password, but a password was supplied"
            );
          } else if (
            err.message.indexOf(
              "wrong number of arguments for 'auth' command"
            ) !== -1
          ) {
            self.options.logger.warn(
              `[ERROR] The server returned "wrong number of arguments for 'auth' command". You are probably passing both username and password to Redis version 5 or below. You should only pass the 'password' option for Redis version 5 and under.`
            );
          } else {
            flushed = true;
            self.recoverFromFatalError(err, err);
          }
        }
      });
    }

    if (self.condition.select) {
      self.select(self.condition.select).catch((err) => {
        // If the node is in cluster mode, select is disallowed.
        // In this case, reconnect won't help.
        self.silentEmit("error", err);
      });
    }

    if (!self.options.enableReadyCheck) {
      exports.readyHandler(self)();
    }

    /*
      No need to keep the reference of DataHandler here
      because we don't need to do the cleanup.
      `Stream#end()` will remove all listeners for us.
    */
    new DataHandler(self, {
      stringNumbers: self.options.stringNumbers,
    });

    if (self.options.enableReadyCheck) {
      self._readyCheck(function (err, info) {
        if (connectionEpoch !== self.connectionEpoch) {
          return;
        }
        if (err) {
          if (!flushed) {
            self.recoverFromFatalError(
              new Error("Ready check failed: " + err.message),
              err
            );
          }
        } else {
          if (self.connector.check(info)) {
            exports.readyHandler(self)();
          } else {
            self.disconnect(true);
          }
        }
      });
    }
  };
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
        "skip reconnecting because `retryStrategy` doesn't return a number"
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
            "reach maxRetriesPerRequest limitation, flushing command queue..."
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
        (error: Error) => self.emit("error", error)
      );
      const { sendCommand } = self;
      self.sendCommand = function (command) {
        if (Command.checkFlag("VALID_IN_MONITOR_MODE", command.name)) {
          return sendCommand.call(self, command);
        }
        command.reject(
          new Error("Connection is in monitoring mode, can't process commands.")
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

    if (self.options.connectionName) {
      debug("set the connection name [%s]", self.options.connectionName);
      self.client("setname", self.options.connectionName).catch(noop);
    }

    if (self.options.readOnly) {
      debug("set the connection to readonly mode");
      self.readonly().catch(noop);
    }

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
          debug("ssubscribe %d channels", ssubscribeChannels.length);
          self.ssubscribe(ssubscribeChannels);
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
