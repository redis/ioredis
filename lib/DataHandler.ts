import { NetStream, CommandItem, Respondable } from "./types";
import Deque = require("denque");
import { EventEmitter } from "events";
import Command from "./Command";
import { Debug } from "./utils";
import SubscriptionSet from "./SubscriptionSet";
import { Decoder, RESP_TYPES } from "./resp/decoder";
import { TypeMapping } from "./resp/types";

const debug = Debug("dataHandler");

type ReplyData = null | boolean | string | Buffer | number | Array<ReplyData>;

export interface Condition {
  select: number;
  auth?: string | [string, string];
  subscriber: false | SubscriptionSet;
}

export type FlushQueueOptions = {
  offlineQueue?: boolean;
  commandQueue?: boolean;
};

export interface DataHandledable extends EventEmitter {
  stream: NetStream;
  status: string;
  condition: Condition | null;
  commandQueue: Deque<CommandItem>;

  disconnect(reconnect: boolean): void;
  recoverFromFatalError(
    commandError: Error,
    err: Error,
    options: FlushQueueOptions
  ): void;
  handleReconnection(err: Error, item: CommandItem): void;
}

interface ParserOptions {
  stringNumbers: boolean;
  replyMapping: "legacy" | "resp3";
  protocol: 2 | 3;
}

export default class DataHandler {
  private readonly protocol: 2 | 3;

  constructor(private redis: DataHandledable, parserOptions: ParserOptions) {
    this.protocol = parserOptions.protocol;
    // Parser options can't change over the lifetime of a connection, so the
    // mapping is resolved once instead of per reply.
    const typeMapping = getParserTypeMapping(parserOptions);
    const decoder = new Decoder({
      getTypeMapping: () => typeMapping,
      onReply: (reply: any) => {
        this.returnReply(reply);
      },
      onErrorReply: (err: Error) => {
        this.returnError(err);
      },
      onPush: (reply: any) => {
        this.returnPush(reply);
      },
    });

    // prependListener ensures the parser receives and processes data before socket timeout checks are performed
    redis.stream.prependListener("data", (data) => {
      try {
        decoder.write(data);
      } catch (err) {
        this.returnFatalError(err as Error);
      }
    });
    // prependListener() doesn't enable flowing mode automatically - we need to resume the stream manually
    redis.stream.resume();
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

    if (item.command.name == "ssubscribe" && err.message.includes("MOVED")) {
      this.redis.emit("moved");
      return;
    }

    this.redis.handleReconnection(err, item);
  }

  private returnReply(reply: ReplyData) {
    if (this.handleMonitorReply(reply)) {
      return;
    }
    // Under RESP3, pub/sub traffic arrives exclusively as push frames
    // (returnPush), so a normal reply on a subscribed connection is always a
    // command response. Routing it by content would misinterpret replies that
    // merely look like pub/sub messages (e.g. an LRANGE result starting with
    // "message") and desync the command queue.
    if (this.protocol !== 3 && this.handleSubscriberReply(reply)) {
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

  private returnPush(reply: ReplyData) {
    if (!Array.isArray(reply) || reply.length === 0) {
      return;
    }

    const replyType = reply[0].toString();
    debug('receive push "%s"', replyType);

    switch (replyType) {
      case "message":
      case "pmessage":
      case "smessage":
        this.handleSubscriberReply(reply);
        break;
      case "ssubscribe":
      case "subscribe":
      case "psubscribe": {
        if (!this.redis.condition.subscriber) {
          this.redis.condition.subscriber = new SubscriptionSet();
        }

        const channel = reply[1].toString();
        this.redis.condition.subscriber.add(replyType, channel);
        const item = this.shiftCommand(reply);
        if (!item) {
          return;
        }
        if (
          !fillSubCommand(item.command, reply[2] as string | Buffer | number)
        ) {
          this.redis.commandQueue.unshift(item);
        }
        break;
      }
      case "sunsubscribe":
      case "unsubscribe":
      case "punsubscribe": {
        if (this.redis.condition.subscriber) {
          const channel = reply[1] ? reply[1].toString() : null;
          if (channel) {
            this.redis.condition.subscriber.del(replyType, channel);
          }
        }

        const count = reply[2] as string | Buffer | number;
        if (Number(count) === 0) {
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
        if (Number(count) === 0) {
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
      // the reply is made to AUTH & MONITOR.
      return false;
    }

    // Since commands sent in the monitoring mode will trigger an exception,
    // any replies we received in the monitoring mode should consider to be
    // realtime monitor data instead of result of commands.
    const len = replyStr.indexOf(" ");
    const timestamp = replyStr.slice(0, len);
    const argIndex = replyStr.indexOf('"');
    const args = replyStr
      .slice(argIndex + 1, -1)
      .split('" "')
      .map((elem) => elem.replace(/\\"/g, '"'));
    const dbAndSource = replyStr.slice(len + 2, argIndex - 2).split(" ");
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

// All string RESP types (simple, blob, verbatim) decode to Buffer rather than
// utf8 strings. This keeps the parser encoding-agnostic: ioredis decides
// utf8-vs-Buffer per command afterwards via `replyEncoding`. Decoding to utf8
// here would be irreversible and corrupt binary-safe values (e.g. DUMP output,
// serialized blobs), whereas bytes -> string stays lossless and deferred. This
// mirrors the old `redis-parser` running with `returnBuffers: true`.

// RESP2-compatible shapes: RESP3-only container and numeric types are
// flattened so replies are identical across both protocols. Strings stay
// buffers; utf8 conversion is decided per command by `replyEncoding`.
const legacyTypeMapping: TypeMapping = {
  [RESP_TYPES.SIMPLE_STRING]: Buffer,
  [RESP_TYPES.BLOB_STRING]: Buffer,
  [RESP_TYPES.VERBATIM_STRING]: Buffer,
  [RESP_TYPES.BIG_NUMBER]: String,
  [RESP_TYPES.DOUBLE]: String,
  [RESP_TYPES.MAP]: Array,
  [RESP_TYPES.SET]: Array,
};

// Leaving MAP and DOUBLE unmapped makes the decoder produce plain objects
// (with string keys) and numbers respectively.
const resp3TypeMapping: TypeMapping = {
  [RESP_TYPES.SIMPLE_STRING]: Buffer,
  [RESP_TYPES.BLOB_STRING]: Buffer,
  [RESP_TYPES.VERBATIM_STRING]: Buffer,
  [RESP_TYPES.BIG_NUMBER]: String,
  [RESP_TYPES.SET]: Array,
};

function getParserTypeMapping(parserOptions: ParserOptions): TypeMapping {
  const base =
    parserOptions.replyMapping === "resp3"
      ? resp3TypeMapping
      : legacyTypeMapping;

  // `stringNumbers` means "all numerics as strings", so it wins over the
  // preset for DOUBLE as well.
  return parserOptions.stringNumbers
    ? { ...base, [RESP_TYPES.NUMBER]: String, [RESP_TYPES.DOUBLE]: String }
    : base;
}

const remainingRepliesMap = new WeakMap<Respondable, number>();

function fillSubCommand(command: Respondable, count: string | Buffer | number) {
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

function fillUnsubCommand(
  command: Respondable,
  count: string | Buffer | number
) {
  let remainingReplies = remainingRepliesMap.has(command)
    ? remainingRepliesMap.get(command)
    : command.args.length;

  if (remainingReplies === 0) {
    if (Number(count) === 0) {
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
