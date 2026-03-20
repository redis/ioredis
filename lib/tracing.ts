import type { CommandParameter } from "./types";

// Context types for the two tracing channels
export interface CommandTraceContext {
  command: string;
  args: CommandParameter[];
  database: number;
  serverAddress: string;
  serverPort: number | undefined;
}

export interface BatchCommandTraceContext extends CommandTraceContext {
  batchMode: "PIPELINE" | "MULTI";
  batchSize: number;
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

const connectChannel: TracingChannel<ConnectTraceContext> | undefined =
  hasTracingChannel
    ? (dc.tracingChannel("ioredis:connect") as TracingChannel<ConnectTraceContext>)
    : undefined;

function shouldTrace(
  channel: TracingChannel<any> | undefined
): channel is TracingChannel<any> {
  return !!channel && channel.hasSubscribers !== false;
}

export function traceCommand<T>(
  fn: () => Promise<T>,
  contextFactory: () => CommandContext
): Promise<T> {
  if (shouldTrace(commandChannel)) {
    return commandChannel.tracePromise(fn, contextFactory());
  }
  return fn();
}

export function traceConnect<T>(
  fn: () => Promise<T>,
  contextFactory: () => ConnectTraceContext
): Promise<T> {
  if (shouldTrace(connectChannel)) {
    return connectChannel.tracePromise(fn, contextFactory());
  }
  return fn();
}
