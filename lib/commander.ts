import { defaults } from "./utils/lodash";
import { list } from "@ioredis/commands";
import Command from "./command";
import Script from "./script";
import * as PromiseContainer from "./promiseContainer";
import asCallback from "standard-as-callback";
import {
  executeWithAutoPipelining,
  shouldUseAutoPipelining,
} from "./autoPipelining";

export interface ICommanderOptions {
  showFriendlyErrorStack?: boolean;
}

const DROP_BUFFER_SUPPORT_ERROR =
  "*Buffer methods are not available " +
  'because "dropBufferSupport" option is enabled.' +
  "Refer to https://github.com/luin/ioredis/wiki/Improve-Performance for more details.";

/**
 * Commander
 *
 * This is the base class of Redis, Redis.Cluster and Pipeline
 *
 * @param {boolean} [options.showFriendlyErrorStack=false] - Whether to show a friendly error stack.
 * Will decrease the performance significantly.
 * @constructor
 */
export default function Commander() {
  this.options = defaults({}, this.options || {}, {
    showFriendlyErrorStack: false,
  });
  this.scriptsSet = {};
  this.addedBuiltinSet = new Set();
}

const commands = list.filter((command) => command !== "monitor");
commands.push("sentinel");

/**
 * Return supported builtin commands
 *
 * @return {string[]} command list
 * @public
 */
Commander.prototype.getBuiltinCommands = function () {
  return commands.slice(0);
};

/**
 * Create a builtin command
 *
 * @param {string} commandName - command name
 * @return {object} functions
 * @public
 */
Commander.prototype.createBuiltinCommand = function (commandName) {
  return {
    string: generateFunction(null, commandName, "utf8"),
    buffer: generateFunction(null, commandName, null),
  };
};

/**
 * Create add builtin command
 *
 * @param {string} commandName - command name
 * @return {object} functions
 * @public
 */
Commander.prototype.addBuiltinCommand = function (commandName) {
  this.addedBuiltinSet.add(commandName);
  this[commandName] = generateFunction(commandName, commandName, "utf8");
  this[commandName + "Buffer"] = generateFunction(
    commandName + "Buffer",
    commandName,
    null
  );
};

commands.forEach(function (commandName) {
  Commander.prototype[commandName] = generateFunction(
    commandName,
    commandName,
    "utf8"
  );
  Commander.prototype[commandName + "Buffer"] = generateFunction(
    commandName + "Buffer",
    commandName,
    null
  );
});

Commander.prototype.call = generateFunction("call", "utf8");
Commander.prototype.callBuffer = generateFunction("callBuffer", null);
// eslint-disable-next-line @typescript-eslint/camelcase
Commander.prototype.send_command = Commander.prototype.call;

/**
 * Define a custom command using lua script
 *
 * @param {string} name - the command name
 * @param {object} definition
 * @param {string} definition.lua - the lua code
 * @param {number} [definition.numberOfKeys=null] - the number of keys.
 * @param {boolean} [definition.readOnly=false] - force this script to be readonly so it executes on slaves as well.
 * If omit, you have to pass the number of keys as the first argument every time you invoke the command
 */
Commander.prototype.defineCommand = function (name, definition) {
  const script = new Script(
    definition.lua,
    definition.numberOfKeys,
    this.options.keyPrefix,
    definition.readOnly
  );
  this.scriptsSet[name] = script;
  this[name] = generateScriptingFunction(name, name, script, "utf8");
  this[name + "Buffer"] = generateScriptingFunction(
    name + "Buffer",
    name,
    script,
    null
  );
};

/**
 * Send a command
 *
 * @abstract
 * @public
 */
Commander.prototype.sendCommand = function () {};

function generateFunction(functionName: string | null, _encoding: string);
function generateFunction(
  functionName: string | null,
  _commandName: string | void,
  _encoding: string
);
function generateFunction(
  functionName: string | null,
  _commandName?: string,
  _encoding?: string
) {
  if (typeof _encoding === "undefined") {
    _encoding = _commandName;
    _commandName = null;
  }

  return function (...args) {
    const commandName = _commandName || args.shift();
    let callback = args[args.length - 1];

    if (typeof callback === "function") {
      args.pop();
    } else {
      callback = undefined;
    }

    const options = {
      errorStack: this.options.showFriendlyErrorStack ? new Error() : undefined,
      keyPrefix: this.options.keyPrefix,
      replyEncoding: _encoding,
    };

    if (this.options.dropBufferSupport && !_encoding) {
      return asCallback(
        PromiseContainer.get().reject(new Error(DROP_BUFFER_SUPPORT_ERROR)),
        callback
      );
    }

    // No auto pipeline, use regular command sending
    if (!shouldUseAutoPipelining(this, functionName, commandName)) {
      return this.sendCommand(
        new Command(commandName, args, options, callback)
      );
    }

    // Create a new pipeline and make sure it's scheduled
    return executeWithAutoPipelining(
      this,
      functionName,
      commandName,
      args,
      callback
    );
  };
}

function generateScriptingFunction(
  functionName,
  commandName,
  script,
  encoding
) {
  return function () {
    let length = arguments.length;
    const lastArgIndex = length - 1;
    let callback = arguments[lastArgIndex];
    if (typeof callback !== "function") {
      callback = undefined;
    } else {
      length = lastArgIndex;
    }
    const args = new Array(length);
    for (let i = 0; i < length; i++) {
      args[i] = arguments[i];
    }

    let options;
    if (this.options.dropBufferSupport) {
      if (!encoding) {
        return asCallback(
          PromiseContainer.get().reject(new Error(DROP_BUFFER_SUPPORT_ERROR)),
          callback
        );
      }
      options = { replyEncoding: null };
    } else {
      options = { replyEncoding: encoding };
    }

    if (this.options.showFriendlyErrorStack) {
      options.errorStack = new Error();
    }

    // No auto pipeline, use regular command sending
    if (!shouldUseAutoPipelining(this, functionName, commandName)) {
      return script.execute(this, args, options, callback);
    }

    // Create a new pipeline and make sure it's scheduled
    return executeWithAutoPipelining(
      this,
      functionName,
      commandName,
      args,
      callback
    );
  };
}
