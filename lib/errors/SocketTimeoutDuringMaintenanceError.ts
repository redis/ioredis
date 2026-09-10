export default class SocketTimeoutDuringMaintenanceError extends Error {
  constructor(timeoutMs: number) {
    super(
      `Socket timeout during server maintenance. Expecting data, but didn't receive any in ${timeoutMs}ms.`
    );
    Error.captureStackTrace(this, this.constructor);
  }

  get name(): string {
    return this.constructor.name;
  }
}
