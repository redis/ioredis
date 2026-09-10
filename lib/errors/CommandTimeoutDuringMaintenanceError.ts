export default class CommandTimeoutDuringMaintenanceError extends Error {
  constructor(timeoutMs: number) {
    super(
      `Command timed out during server maintenance (relaxed timeout: ${timeoutMs}ms)`
    );
    Error.captureStackTrace(this, this.constructor);
  }

  get name(): string {
    return this.constructor.name;
  }
}
