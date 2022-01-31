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
    evalsha.promise = evalsha.promise.catch((err: Error) => {
      if (err.toString().indexOf("NOSCRIPT") === -1) {
        throw err;
      }
      const command = new Command("eval", [this.lua].concat(args), options);
      if (container.isPipeline === true) container.redis.sendCommand(command);
      else container.sendCommand(command);
      return command.promise;
    });

    asCallback(evalsha.promise, callback);

    // The result here is one of
    // - a Promise when executed on the redis instance
    // - a pipeline instance in pipeline mode
    return container.sendCommand(evalsha);
  }
}
