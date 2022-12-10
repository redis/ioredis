import { NetStream, CommandItem, Respondable } from "./types";
import Deque = require("denque");
import { EventEmitter } from "events";
import Command from "./Command";
import { Debug } from "./utils";
import * as RedisParser from "redis-parser";
import SubscriptionSet from "./SubscriptionSet";

const debug = Debug("dataHandler");

type ReplyData = string | Buffer | number | Array<string | Buffer | number>;

interface Condition {
  select: number;
  auth: string;
  subscriber: false | SubscriptionSet;
}

interface DataHandledable extends EventEmitter {
  stream: NetStream;
  status: string;
  condition: Condition;
  commandQueue: Deque<CommandItem>;

  disconnect(reconnect: boolean): void;
  recoverFromFatalError(commandError: Error, err: Error, options: any): void;
  handleReconnection(err: Error, item: CommandItem): void;
}

interface ParserOptions {
  stringNumbers: boolean;
}

export default class DataHandler {
  constructor(private redis: DataHandledable, parserOptions: ParserOptions) {
    const parser = new RedisParser({
      stringNumbers: parserOptions.stringNumbers,
      returnBuffers: true,
      returnError: (err: Error) => {
        this.returnError(err);
      },
      returnFatalError: (err: Error) => {
        this.returnFatalError(err);
      },
      returnReply: (reply: any) => {
        this.returnReply(reply);
      },
    });

    redis.stream.on("data", (data) => {
      parser.execute(data);
    });
  }

  private returnFatalError(err: Error) {
    err.message += ". Please report this.";
    this.redis.recoverFromFatalError(err, err, { offlineQueue: false });
  }

  private returnError(err: Error) {
    const item = this.shiftCommand(err);
    if (!item) {
      return;
    }

    (err as any).command = {
      name: item.command.name,
      args: item.command.args,
    };

    this.redis.handleReconnection(err, item);
  }

  private returnReply(reply: ReplyData) {
    if (this.handleMonitorReply(reply)) {
      return;
    }
    if (this.handleSubscriberReply(reply)) {
      return;
    }

    const item = this.shiftCommand(reply);
    if (!item) {
      return;
    }
    if (Command.checkFlag("ENTER_SUBSCRIBER_MODE", item.command.name)) {
      this.redis.condition.subscriber = new SubscriptionSet();
      this.redis.condition.subscriber.add(
        item.command.name,
        reply[1].toString()
      );

      if (!fillSubCommand(item.command, reply[2])) {
        this.redis.commandQueue.unshift(item);
      }
    } else if (Command.checkFlag("EXIT_SUBSCRIBER_MODE", item.command.name)) {
      if (!fillUnsubCommand(item.command, reply[2])) {
        this.redis.commandQueue.unshift(item);
      }
    } else {
      item.command.resolve(reply);
    }
  }

  private handleSubscriberReply(reply: ReplyData): boolean {
    if (!this.redis.condition.subscriber) {
      return false;
    }
    const replyType = Array.isArray(reply) ? reply[0].toString() : null;
    debug('receive reply "%s" in subscriber mode', replyType);

    switch (replyType) {
      case "message":
        if (this.redis.listeners("message").length > 0) {
          // Check if there're listeners to avoid unnecessary `toString()`.
          this.redis.emit(
            "message",
            reply[1].toString(),
            reply[2] ? reply[2].toString() : ""
          );
        }
        this.redis.emit("messageBuffer", reply[1], reply[2]);
        break;
      case "pmessage": {
        const pattern = reply[1].toString();
        if (this.redis.listeners("pmessage").length > 0) {
          this.redis.emit(
            "pmessage",
            pattern,
            reply[2].toString(),
            reply[3].toString()
          );
        }
        this.redis.emit("pmessageBuffer", pattern, reply[2], reply[3]);
        break;
      }
      case "smessage": {
        if (this.redis.listeners("smessage").length > 0) {
          this.redis.emit(
            "smessage",
            reply[1].toString(),
            reply[2] ? reply[2].toString() : ""
          );
        }
        this.redis.emit("smessageBuffer", reply[1], reply[2]);
        break;
      }
      case "ssubscribe":
      case "subscribe":
      case "psubscribe": {
        const channel = reply[1].toString();
        this.redis.condition.subscriber.add(replyType, channel);
        const item = this.shiftCommand(reply);
        if (!item) {
          return;
        }
        if (!fillSubCommand(item.command, reply[2])) {
          this.redis.commandQueue.unshift(item);
        }
        break;
      }
      case "sunsubscribe":
      case "unsubscribe":
      case "punsubscribe": {
        const channel = reply[1] ? reply[1].toString() : null;
        if (channel) {
          this.redis.condition.subscriber.del(replyType, channel);
        }
        const count = reply[2];
        if (count === 0) {
          this.redis.condition.subscriber = false;
        }
        const item = this.shiftCommand(reply);
        if (!item) {
          return;
        }
        if (!fillUnsubCommand(item.command, count)) {
          this.redis.commandQueue.unshift(item);
        }
        break;
      }
      default: {
        const item = this.shiftCommand(reply);
        if (!item) {
          return;
        }
        item.command.resolve(reply);
      }
    }
    return true;
  }

  private handleMonitorReply(reply: ReplyData): boolean {
    if (this.redis.status !== "monitoring") {
      return false;
    }

    const replyStr = reply.toString();
    if (replyStr === "OK") {
      // Valid commands in the monitoring mode are AUTH and MONITOR,
      // both of which always reply with 'OK'.
      // So if we got an 'OK', we can make certain that
      // the reply is made to AUTH & MONITO.
      return false;
    }

    // Since commands sent in the monitoring mode will trigger an exception,
    // any replies we received in the monitoring mode should consider to be
    // realtime monitor data instead of result of commands.
    const len = replyStr.indexOf(" ");
    const timestamp = replyStr.slice(0, len);
    const argindex = replyStr.indexOf('"');
    const args = replyStr
      .slice(argindex + 1, -1)
      .split('" "')
      .map((elem) => elem.replace(/\\"/g, '"'));
    const dbAndSource = replyStr.slice(len + 2, argindex - 2).split(" ");
    this.redis.emit("monitor", timestamp, args, dbAndSource[1], dbAndSource[0]);
    return true;
  }

  private shiftCommand(reply: ReplyData | Error): CommandItem | null {
    const item = this.redis.commandQueue.shift();
    if (!item) {
      const message =
        "Command queue state error. If you can reproduce this, please report it.";
      const error = new Error(
        message +
          (reply instanceof Error
            ? ` Last error: ${reply.message}`
            : ` Last reply: ${reply.toString()}`)
      );
      this.redis.emit("error", error);
      return null;
    }
    return item;
  }
}

const remainingRepliesMap = new WeakMap<Respondable, number>();

function fillSubCommand(command: Respondable, count: number) {
  let remainingReplies = remainingRepliesMap.has(command)
    ? remainingRepliesMap.get(command)
    : command.args.length;

  remainingReplies -= 1;

  if (remainingReplies <= 0) {
    command.resolve(count);
    remainingRepliesMap.delete(command);
    return true;
  }
  remainingRepliesMap.set(command, remainingReplies);
  return false;
}

function fillUnsubCommand(command: Respondable, count: number) {
  let remainingReplies = remainingRepliesMap.has(command)
    ? remainingRepliesMap.get(command)
    : command.args.length;

  if (remainingReplies === 0) {
    if (count === 0) {
      remainingRepliesMap.delete(command);
      command.resolve(count);
      return true;
    }
    return false;
  }

  remainingReplies -= 1;
  if (remainingReplies <= 0) {
    command.resolve(count);
    return true;
  }
  remainingRepliesMap.set(command, remainingReplies);
  return false;
}
