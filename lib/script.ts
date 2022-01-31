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

    if (container.isPipeline) {
      return usingPipeline(this, container, args, options, callback);
    } else if (container.isCluster) {
      return usingCluster(this, container, args, options, callback);
    } else {
      return usingStandalone(this, container, args, options, callback);
    }
  }
}

function createEvalShaWithFallback(script, args, options, client) {
  const evalsha = createEvalSha(script, args, options);
  evalsha.promise = evalsha.promise.catch((err: Error) => {
    if (err.toString().indexOf("NOSCRIPT") === -1) {
      throw err;
    }

    // Do an eval as fallback, redis will hash and load it
    const evalcmd = new Command("eval", [script.lua].concat(args), options);
    evalcmd.promise = evalcmd.promise.then((r) => {
      client._addedScriptHashes[script.sha] = true;
      return r;
    });
    return client.sendCommand(evalcmd);
  });
  return evalsha;
}

function createEvalSha(script, args, options) {
  const evalsha = new Command("evalsha", [script.sha].concat(args), options);
  evalsha.isCustomCommand = true;
  return evalsha;
}

// Pipeline mode (cluster and regular)
function usingPipeline(script, pipeline, args, options, callback) {
  // The script was loaded explicitly in this pipeline,
  // so we can directly execute evalsha without loading the script again
  if (pipeline._addedScriptHashes && pipeline._addedScriptHashes[script.sha]) {
    const evalsha = createEvalSha(script, args, options);
    asCallback(evalsha.promise, callback);
    return pipeline.sendCommand(evalsha);
  }

  // The script is loaded in redis already, so we try an evalsha
  // and fallback to loading the script if it fails
  if (pipeline.redis._addedScriptHashes[script.sha]) {
    const evalsha = createEvalShaWithFallback(
      script,
      args,
      options,
      pipeline.redis
    );
    asCallback(evalsha.promise, callback);
    return pipeline.sendCommand(evalsha);
  }

  // If the script is not present on redis or in the pipeline,
  // we use eval to load the script into the pipeline
  if (!pipeline._addedScriptHashes) pipeline._addedScriptHashes = {};
  pipeline._addedScriptHashes[script.sha] = true;

  const evalcmd = new Command("eval", [script.lua].concat(args), options);
  evalcmd.promise = evalcmd.promise.then((r) => {
    pipeline.redis._addedScriptHashes[script.sha] = true;
    return r;
  });
  asCallback(evalcmd.promise, callback);
  return pipeline.sendCommand(evalcmd);
}

// Standalone mode (cluster)
function usingCluster(script, cluster, args, options, callback) {
  const evalsha = createEvalShaWithFallback(script, args, options, cluster);
  asCallback(evalsha.promise, callback);
  return cluster.sendCommand(evalsha);
}

// Standalone mode (regular)
function usingStandalone(script, redis, args, options, callback) {
  if (redis._addedScriptHashes[script.sha]) {
    const evalsha = createEvalShaWithFallback(script, args, options, redis);
    return asCallback(redis.sendCommand(evalsha), callback);
  }

  const command = new Command("eval", [script.lua].concat(args), options);
  command.promise = command.promise.then((r) => {
    redis._addedScriptHashes[script.sha] = true;
    return r;
  });

  asCallback(command.promise, callback);
  return redis.sendCommand(command);
}
