interface RedisError extends Error {
  command?: Record<string, unknown>;
}

export function sanitizeError(error: RedisError): RedisError {
  if (error?.command?.args) {
    const { args, ...commandWithoutArgs } = error.command;
    error.command = commandWithoutArgs;
  }
  return error;
}

let warned = false;
export function warnOnceAboutSanitizeErrors() {
  if (warned) return;
  warned = true;
  console.warn(
    "[WARN] In the future, command args will automatically be sanitized away from error objects. To keep the current behavior, set sanitizeErrors: false when configuring ioredis"
  );
}
