import { AbortError } from "redis-errors";

/**
 * Rejects a MULTI/EXEC transaction whose WATCH was invalidated by a Smart
 * Client Handoff: the watched keys lived on the previous physical connection,
 * so executing the transaction on the new one would silently drop the
 * optimistic lock. The transaction is aborted before anything is sent;
 * retry it with a fresh WATCH.
 */
export default class WatchError extends AbortError {
  constructor() {
    super(
      "WATCH was invalidated by a connection handoff; the transaction was aborted before execution. Retry it with a fresh WATCH."
    );
    Error.captureStackTrace(this, this.constructor);
  }

  get name(): string {
    return this.constructor.name;
  }
}
