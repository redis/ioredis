interface DiagnosticChannel<T> {
  readonly hasSubscribers: boolean;
  publish(message: T): void;
}

interface DiagnosticsChannelModule {
  channel<T>(name: string): DiagnosticChannel<T>;
}

const diagnosticsChannel: DiagnosticsChannelModule | undefined = (() => {
  try {
    return "getBuiltinModule" in process
      ? (process as any).getBuiltinModule("node:diagnostics_channel")
      : require("node:diagnostics_channel");
  } catch {
    return undefined;
  }
})();

const noopChannel: DiagnosticChannel<unknown> = {
  hasSubscribers: false,
  publish() {},
};

export function createDiagnosticChannel<T>(name: string): DiagnosticChannel<T> {
  return diagnosticsChannel?.channel<T>(name) ?? noopChannel;
}
