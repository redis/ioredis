import { ReplyError } from "redis-errors";

export type ErrorReply = ReplyError;

export class SimpleError extends ReplyError {
  get name() {
    return "ReplyError";
  }
}

export class BlobError extends ReplyError {
  get name() {
    return "ReplyError";
  }
}
