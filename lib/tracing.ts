import type { CommandParameter } from "./types";

// Context types for the two tracing channels
export interface CommandContext {
  command: string;
  args: CommandParameter[];
  database: number;
  serverAddress: string;
  serverPort: number | undefined;
  batchMode?: "pipeline" | "multi";
  batchSize?: number;
}

export interface ConnectContext {
  serverAddress: string;
  serverPort: number | undefined;
}

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

const connectChannel: TracingChannel<ConnectContext> | undefined =
  hasTracingChannel
    ? (dc.tracingChannel("ioredis:connect") as TracingChannel<ConnectContext>)
    : undefined;

export function traceCommand<T>(
  fn: () => Promise<T>,
  contextFactory: () => CommandContext
): Promise<T> {
  if (commandChannel?.hasSubscribers) {
    return commandChannel.tracePromise(fn, contextFactory());
  }
  return fn();
}

export function traceConnect<T>(
  fn: () => Promise<T>,
  contextFactory: () => ConnectContext
): Promise<T> {
  if (connectChannel?.hasSubscribers) {
    return connectChannel.tracePromise(fn, contextFactory());
  }
  return fn();
}
