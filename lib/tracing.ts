import type { CommandParameter } from "./types";

// Argument sanitization rules adapted from @opentelemetry/redis-common (Apache 2.0).
// https://github.com/open-telemetry/opentelemetry-js-contrib/blob/main/packages/redis-common/src/index.ts
//
// Each entry specifies how many positional args (after the command name) are safe
// to emit. -1 means all args are safe (read-only/structural commands).
// Unlisted commands default to 0 (all args redacted) for safe-by-default behavior,
// which covers AUTH, HELLO, and unknown/custom commands.
const SERIALIZATION_SUBSETS: Array<{ regex: RegExp; args: number }> = [
  { regex: /^ECHO/i, args: 0 },
  { regex: /^(LPUSH|MSET|PFA|PUBLISH|RPUSH|SADD|SET|SPUBLISH|XADD|ZADD)/i, args: 1 },
  { regex: /^(HSET|HMSET|LSET|LINSERT)/i, args: 2 },
  { regex: /^(ACL|BIT|B[LRZ]|CLIENT|CLUSTER|CONFIG|COMMAND|DECR|DEL|EVAL|EX|FUNCTION|GEO|GET|HINCR|HMGET|HSCAN|INCR|L[TRLM]|MEMORY|P[EFISTU]|RPOP|S[CDIMORSU]|XACK|X[CDGILPRT]|Z[CDILMPRS])/i, args: -1 },
];

export function sanitizeArgs(commandName: string, args: CommandParameter[]): string[] {
  let allowedArgCount = 0;

  for (const subset of SERIALIZATION_SUBSETS) {
    if (subset.regex.test(commandName)) {
      allowedArgCount = subset.args;
      break;
    }
  }

  if (allowedArgCount === -1) {
    return args.map((a) => String(a));
  }

  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (i < allowedArgCount) {
      result.push(String(args[i]));
    } else {
      result.push("?");
    }
  }
  return result;
}

// Context types for the two tracing channels
export interface CommandTraceContext {
  command: string;
  args: string[];
  database: number;
  serverAddress: string;
  serverPort: number | undefined;
}

export interface BatchCommandTraceContext extends CommandTraceContext {
  batchMode: "PIPELINE";
  batchSize: number;
}

// Context for the batch operation itself (MULTI as a whole).
// Distinct from BatchCommandTraceContext which is a single command within a pipeline.
export interface BatchOperationContext {
  batchMode: "MULTI";
  batchSize: number;
  database: number;
  serverAddress: string;
  serverPort: number | undefined;
}

export interface ConnectTraceContext {
  serverAddress: string;
  serverPort: number | undefined;
  connectionEpoch: number;
}

type CommandContext = CommandTraceContext | BatchCommandTraceContext;

// Shim interface to fix @types/node gaps:
// - hasSubscribers is missing on TracingChannel
// - tracePromise is typed as returning void but returns the promise at runtime
interface TracingChannel<ContextType> {
  readonly hasSubscribers: boolean;
  tracePromise<T>(
    fn: () => Promise<T>,
    context?: ContextType
  ): Promise<T>;
}

// Load diagnostics_channel with Node 18 compatibility
const dc: any = (() => {
  try {
    return ("getBuiltinModule" in process)
      ? (process as any).getBuiltinModule("node:diagnostics_channel")
      : require("node:diagnostics_channel");
  } catch {
    return undefined;
  }
})();

const hasTracingChannel = dc && typeof dc.tracingChannel === "function";

const commandChannel: TracingChannel<CommandContext> | undefined =
  hasTracingChannel
    ? (dc.tracingChannel("ioredis:command") as TracingChannel<CommandContext>)
    : undefined;

const batchChannel: TracingChannel<BatchOperationContext> | undefined =
  hasTracingChannel
    ? (dc.tracingChannel("ioredis:batch") as TracingChannel<BatchOperationContext>)
    : undefined;

const connectChannel: TracingChannel<ConnectTraceContext> | undefined =
  hasTracingChannel
    ? (dc.tracingChannel("ioredis:connect") as TracingChannel<ConnectTraceContext>)
    : undefined;

function shouldTrace(
  channel: TracingChannel<any> | undefined
): channel is TracingChannel<any> {
  return !!channel && channel.hasSubscribers !== false;
}

const noop = () => {};

export function traceCommand<T>(
  fn: () => Promise<T>,
  contextFactory: () => CommandContext
): Promise<T> {
  if (!shouldTrace(commandChannel)) return fn();

  // tracePromise returns a wrapper promise that re-rejects on error.
  // Silence the wrapper to prevent unhandled rejections when callers
  // (e.g. Pipeline) discard the return value. Callers that await this
  // promise still see the rejection through their own .then() chain.
  const traced = commandChannel.tracePromise(fn, contextFactory());
  traced.catch(noop);
  return traced;
}

export function traceBatch<T>(
  fn: () => Promise<T>,
  contextFactory: () => BatchOperationContext
): Promise<T> {
  if (!shouldTrace(batchChannel)) return fn();

  const traced = batchChannel.tracePromise(fn, contextFactory());
  traced.catch(noop);
  return traced;
}

export function traceConnect<T>(
  fn: () => Promise<T>,
  contextFactory: () => ConnectTraceContext
): Promise<T> {
  if (!shouldTrace(connectChannel)) return fn();

  return connectChannel.tracePromise(fn, contextFactory());
}
