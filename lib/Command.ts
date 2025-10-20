import { exists, getKeyIndexes } from "@ioredis/commands";
import * as calculateSlot from "cluster-key-slot";
import asCallback from "standard-as-callback";
import {
  convertBufferToString,
  optimizeErrorStack,
  toArg,
  convertMapToArray,
  convertObjectToArray,
} from "./utils";
import { Callback, Respondable, CommandParameter } from "./types";

export type ArgumentType =
  | string
  | Buffer
  | number
  | (string | Buffer | number | any[])[];

interface CommandOptions {
  /**
   * Set the encoding of the reply, by default buffer will be returned.
   */
  replyEncoding?: BufferEncoding | null;
  errorStack?: Error;
  keyPrefix?: string;
  /**
   * Force the command to be readOnly so it will also execute on slaves
   */
  readOnly?: boolean;
}

type ArgumentTransformer = (args: any[]) => any[];
type ReplyTransformer = (reply: any) => any;
interface FlagMap {
  [flag: string]: { [command: string]: true };
}

export interface CommandNameFlags {
  // Commands that can be processed when client is in the subscriber mode
  VALID_IN_SUBSCRIBER_MODE: [
    "subscribe",
    "psubscribe",
    "unsubscribe",
    "punsubscribe",
    "ssubscribe",
    "sunsubscribe",
    "ping",
    "quit"
  ];
  // Commands that are valid in monitor mode
  VALID_IN_MONITOR_MODE: ["monitor", "auth"];
  // Commands that will turn current connection into subscriber mode
  ENTER_SUBSCRIBER_MODE: ["subscribe", "psubscribe", "ssubscribe"];
  // Commands that may make current connection quit subscriber mode
  EXIT_SUBSCRIBER_MODE: ["unsubscribe", "punsubscribe", "sunsubscribe"];
  // Commands that will make client disconnect from server TODO shutdown?
  WILL_DISCONNECT: ["quit"];
  // Commands that are sent when the client is connecting
  HANDSHAKE_COMMANDS: ["auth", "select", "client", "readonly", "info"];
  // Commands that should not trigger a reconnection when errors occur
  IGNORE_RECONNECT_ON_ERROR: ["client"];
}

/**
 * Command instance
 *
 * It's rare that you need to create a Command instance yourself.
 *
 * ```js
 * var infoCommand = new Command('info', null, function (err, result) {
 *   console.log('result', result);
 * });
 *
 * redis.sendCommand(infoCommand);
 *
 * // When no callback provided, Command instance will have a `promise` property,
 * // which will resolve/reject with the result of the command.
 * var getCommand = new Command('get', ['foo']);
 * getCommand.promise.then(function (result) {
 *   console.log('result', result);
 * });
 * ```
 */
export default class Command implements Respondable {
  static FLAGS: {
    [key in keyof CommandNameFlags]: CommandNameFlags[key];
  } = {
    VALID_IN_SUBSCRIBER_MODE: [
      "subscribe",
      "psubscribe",
      "unsubscribe",
      "punsubscribe",
      "ssubscribe",
      "sunsubscribe",
      "ping",
      "quit",
    ],
    VALID_IN_MONITOR_MODE: ["monitor", "auth"],
    ENTER_SUBSCRIBER_MODE: ["subscribe", "psubscribe", "ssubscribe"],
    EXIT_SUBSCRIBER_MODE: ["unsubscribe", "punsubscribe", "sunsubscribe"],
    WILL_DISCONNECT: ["quit"],
    HANDSHAKE_COMMANDS: ["auth", "select", "client", "readonly", "info"],
    IGNORE_RECONNECT_ON_ERROR: ["client"],
  };

  private static flagMap?: FlagMap;
  private static _transformer: {
    argument: { [command: string]: ArgumentTransformer };
    reply: { [command: string]: ReplyTransformer };
  } = {
    argument: {},
    reply: {},
  };

  /**
   * Check whether the command has the flag
   */
  static checkFlag<T extends keyof CommandNameFlags>(
    flagName: T,
    commandName: string
  ): commandName is CommandNameFlags[T][number] {
    return !!this.getFlagMap()[flagName][commandName];
  }

  static setArgumentTransformer(name: string, func: ArgumentTransformer) {
    this._transformer.argument[name] = func;
  }

  static setReplyTransformer(name: string, func: ReplyTransformer) {
    this._transformer.reply[name] = func;
  }

  private static getFlagMap(): FlagMap {
    if (!this.flagMap) {
      this.flagMap = Object.keys(Command.FLAGS).reduce(
        (map: FlagMap, flagName: string) => {
          map[flagName] = {};
          Command.FLAGS[flagName].forEach((commandName: string) => {
            map[flagName][commandName] = true;
          });
          return map;
        },
        {}
      );
    }
    return this.flagMap;
  }

  ignore?: boolean;
  isReadOnly?: boolean;

  args: CommandParameter[];
  inTransaction = false;
  pipelineIndex?: number;

  isResolved = false;
  reject: (err: Error) => void;
  resolve: (result: any) => void;
  promise: Promise<any>;

  private replyEncoding: BufferEncoding | null;
  private errorStack: Error;
  private bufferMode: boolean;
  private callback: Callback;
  private transformed = false;
  private _commandTimeoutTimer?: NodeJS.Timeout;

  private slot?: number | null;
  private keys?: Array<string | Buffer>;

  /**
   * Creates an instance of Command.
   * @param name Command name
   * @param args An array of command arguments
   * @param options
   * @param callback The callback that handles the response.
   * If omit, the response will be handled via Promise
   */
  constructor(
    public name: string,
    args: Array<ArgumentType> = [],
    options: CommandOptions = {},
    callback?: Callback
  ) {
    this.replyEncoding = options.replyEncoding;
    this.errorStack = options.errorStack;

    this.args = args.flat();
    this.callback = callback;

    this.initPromise();

    if (options.keyPrefix) {
      // @ts-expect-error
      const isBufferKeyPrefix = options.keyPrefix instanceof Buffer;
      // @ts-expect-error
      let keyPrefixBuffer: Buffer | null = isBufferKeyPrefix
        ? options.keyPrefix
        : null;
      this._iterateKeys((key) => {
        if (key instanceof Buffer) {
          if (keyPrefixBuffer === null) {
            keyPrefixBuffer = Buffer.from(options.keyPrefix);
          }
          return Buffer.concat([keyPrefixBuffer, key]);
        } else if (isBufferKeyPrefix) {
          // @ts-expect-error
          return Buffer.concat([options.keyPrefix, Buffer.from(String(key))]);
        }
        return options.keyPrefix + key;
      });
    }

    if (options.readOnly) {
      this.isReadOnly = true;
    }
  }

  getSlot() {
    if (typeof this.slot === "undefined") {
      const key = this.getKeys()[0];
      this.slot = key == null ? null : calculateSlot(key);
    }
    return this.slot;
  }

  getKeys(): Array<string | Buffer> {
    return this._iterateKeys();
  }

  /**
   * Convert command to writable buffer or string
   */
  toWritable(_socket: object): string | Buffer {
    let result;
    const commandStr =
      "*" +
      (this.args.length + 1) +
      "\r\n$" +
      Buffer.byteLength(this.name) +
      "\r\n" +
      this.name +
      "\r\n";

    if (this.bufferMode) {
      const buffers = new MixedBuffers();
      buffers.push(commandStr);
      for (let i = 0; i < this.args.length; ++i) {
        const arg = this.args[i];
        if (arg instanceof Buffer) {
          if (arg.length === 0) {
            buffers.push("$0\r\n\r\n");
          } else {
            buffers.push("$" + arg.length + "\r\n");
            buffers.push(arg);
            buffers.push("\r\n");
          }
        } else {
          buffers.push(
            "$" +
              Buffer.byteLength(arg as string | Buffer) +
              "\r\n" +
              arg +
              "\r\n"
          );
        }
      }
      result = buffers.toBuffer();
    } else {
      result = commandStr;
      for (let i = 0; i < this.args.length; ++i) {
        const arg = this.args[i];
        result +=
          "$" +
          Buffer.byteLength(arg as string | Buffer) +
          "\r\n" +
          arg +
          "\r\n";
      }
    }
    return result;
  }

  stringifyArguments(): void {
    for (let i = 0; i < this.args.length; ++i) {
      const arg = this.args[i];
      if (typeof arg === "string") {
        // buffers and strings don't need any transformation
      } else if (arg instanceof Buffer) {
        this.bufferMode = true;
      } else {
        this.args[i] = toArg(arg);
      }
    }
  }

  /**
   * Convert buffer/buffer[] to string/string[],
   * and apply reply transformer.
   */
  transformReply(
    result: Buffer | Buffer[]
  ): string | string[] | Buffer | Buffer[] {
    if (this.replyEncoding) {
      result = convertBufferToString(result, this.replyEncoding);
    }
    const transformer = Command._transformer.reply[this.name];
    if (transformer) {
      result = transformer(result);
    }

    return result;
  }

  /**
   * Set the wait time before terminating the attempt to execute a command
   * and generating an error.
   */
  setTimeout(ms: number) {
    if (!this._commandTimeoutTimer) {
      this._commandTimeoutTimer = setTimeout(() => {
        if (!this.isResolved) {
          this.reject(new Error("Command timed out"));
        }
      }, ms);
    }
  }

  private initPromise() {
    const promise = new Promise((resolve, reject) => {
      if (!this.transformed) {
        this.transformed = true;
        const transformer = Command._transformer.argument[this.name];
        if (transformer) {
          this.args = transformer(this.args);
        }
        this.stringifyArguments();
      }

      this.resolve = this._convertValue(resolve);
      if (this.errorStack) {
        this.reject = (err) => {
          reject(optimizeErrorStack(err, this.errorStack.stack, __dirname));
        };
      } else {
        this.reject = reject;
      }
    });

    this.promise = asCallback(promise, this.callback);
  }

  /**
   * Iterate through the command arguments that are considered keys.
   */
  private _iterateKeys(
    transform: (key: CommandParameter) => CommandParameter = (key) => key
  ): (string | Buffer)[] {
    if (typeof this.keys === "undefined") {
      this.keys = [];
      if (exists(this.name)) {
        // @ts-expect-error
        const keyIndexes = getKeyIndexes(this.name, this.args);
        for (const index of keyIndexes) {
          this.args[index] = transform(this.args[index]);
          this.keys.push(this.args[index] as string | Buffer);
        }
      }
    }
    return this.keys;
  }

  /**
   * Convert the value from buffer to the target encoding.
   */
  private _convertValue(resolve: Function): (result: any) => void {
    return (value) => {
      try {
        const existingTimer = this._commandTimeoutTimer;
        if (existingTimer) {
          clearTimeout(existingTimer);
          delete this._commandTimeoutTimer;
        }

        resolve(this.transformReply(value));
        this.isResolved = true;
      } catch (err) {
        this.reject(err);
      }
      return this.promise;
    };
  }
}

const msetArgumentTransformer = function (args) {
  if (args.length === 1) {
    if (args[0] instanceof Map) {
      return convertMapToArray(args[0]);
    }
    if (typeof args[0] === "object" && args[0] !== null) {
      return convertObjectToArray(args[0]);
    }
  }
  return args;
};

const hsetArgumentTransformer = function (args) {
  if (args.length === 2) {
    if (args[1] instanceof Map) {
      return [args[0]].concat(convertMapToArray(args[1]));
    }
    if (typeof args[1] === "object" && args[1] !== null) {
      return [args[0]].concat(convertObjectToArray(args[1]));
    }
  }
  return args;
};

Command.setArgumentTransformer("mset", msetArgumentTransformer);
Command.setArgumentTransformer("msetnx", msetArgumentTransformer);

Command.setArgumentTransformer("hset", hsetArgumentTransformer);
Command.setArgumentTransformer("hmset", hsetArgumentTransformer);

Command.setReplyTransformer("hgetall", function (result) {
  if (Array.isArray(result)) {
    const obj = {};
    for (let i = 0; i < result.length; i += 2) {
      const key = result[i];
      const value = result[i + 1];
      if (key in obj) {
        // can only be truthy if the property is special somehow, like '__proto__' or 'constructor'
        // https://github.com/luin/ioredis/issues/1267
        Object.defineProperty(obj, key, {
          value,
          configurable: true,
          enumerable: true,
          writable: true,
        });
      } else {
        obj[key] = value;
      }
    }
    return obj;
  }
  return result;
});

class MixedBuffers {
  length = 0;
  items = [];

  push(x: string | Buffer) {
    this.length += Buffer.byteLength(x);
    this.items.push(x);
  }

  toBuffer(): Buffer {
    const result = Buffer.allocUnsafe(this.length);
    let offset = 0;
    for (const item of this.items) {
      const length = Buffer.byteLength(item);
      Buffer.isBuffer(item)
        ? (item as Buffer).copy(result, offset)
        : result.write(item, offset, length);
      offset += length;
    }
    return result;
  }
}
