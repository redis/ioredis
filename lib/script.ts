import { createHash } from "crypto";
import Command from "./command";
import asCallback from "standard-as-callback";
import { CallbackFunction } from "./types";
export default class Script {
  private sha: string;
  private Command: new (...args: any[]) => Command;

  constructor(
    private lua: string,
    private numberOfKeys: number = null,
    private keyPrefix: string = "",
    private readOnly: boolean = false
  ) {
    this.sha = createHash("sha1").update(lua).digest("hex");

    const sha = this.sha;
    const socketHasScriptLoaded = new WeakSet();
    this.Command = class CustomScriptCommand extends Command {
      toWritable(socket: object): string | Buffer {
        const origReject = this.reject;
        this.reject = (err) => {
          if (err.toString().indexOf("NOSCRIPT") !== -1) {
            socketHasScriptLoaded.delete(socket);
          }
          this.reject = origReject;
          this.reject(err);
        };

        if (!socketHasScriptLoaded.has(socket)) {
          socketHasScriptLoaded.add(socket);
          this.name = "eval";
          this.args[0] = lua;
        } else if (this.name === "eval") {
          this.name = "evalsha";
          this.args[0] = sha;
        }
        return super.toWritable(socket);
      }
    };
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

    const evalsha = new this.Command(
      "evalsha",
      [this.sha, ...args],
      options
    );
    evalsha.isCustomCommand = true;

    evalsha.promise = evalsha.promise.catch((err: Error) => {
      if (err.toString().indexOf("NOSCRIPT") === -1) {
        throw err;
      }

      // Resend the same custom evalsha command that gets transformed to an eval
      // in case it's not loaded yet on the connectionDo an eval as fallback, redis will hash and load it
      const resend = new this.Command(
        "evalsha",
        [this.sha, ...args],
        options
      );
      resend.isCustomCommand = true;

      const client = container.isPipeline ? container.redis : container;
      return client.sendCommand(resend);
    });

    asCallback(evalsha.promise, callback);
    return container.sendCommand(evalsha);
  }
}
