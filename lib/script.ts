import { createHash } from "crypto";
import Command from "./command";
import asCallback from "standard-as-callback";
import { CallbackFunction } from "./types";

function isPromise(obj: any): boolean {
  return (
    !!obj &&
    (typeof obj === "object" || typeof obj === "function") &&
    typeof obj.then === "function"
  );
}

export default class Script {
  private sha: string;

  constructor(
    private lua: string,
    private numberOfKeys: number = null,
    private keyPrefix: string = "",
    private readOnly: boolean = false
  ) {
    this.sha = createHash("sha1").update(lua).digest("hex");
  }

  execute(
    container: any,
    args: any[],
    options: any,
    callback?: CallbackFunction
  ) {
    if (typeof this.numberOfKeys === "number") {
      args.unshift(this.numberOfKeys);
    }
    if (this.keyPrefix) {
      options.keyPrefix = this.keyPrefix;
    }
    if (this.readOnly) {
      options.readOnly = true;
    }

    const evalsha = new Command("evalsha", [this.sha].concat(args), options);
    evalsha.isCustomCommand = true;

    const result = container.sendCommand(evalsha);
    if (isPromise(result)) {
      return asCallback(
        result.catch((err: Error) => {
          if (err.toString().indexOf("NOSCRIPT") === -1) {
            throw err;
          }
          return container.sendCommand(
            new Command("eval", [this.lua].concat(args), options)
          );
        }),
        callback
      );
    }

    // result is not a Promise--probably returned from a pipeline chain; however,
    // we still need the callback to fire when the script is evaluated
    asCallback(evalsha.promise, callback);

    return result;
  }
}
