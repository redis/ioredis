import debug from "debug";

const MAX_ARGUMENT_LENGTH = 200;
const NAMESPACE_PREFIX = "ioredis";

/**
 * helper function that tried to get a string value for
 * arbitrary "debug" arg
 */
function getStringValue(v: any): string | void {
  if (v === null) {
    return;
  }

  switch (typeof v) {
    case "boolean":
      return;
    case "number":
      return;

    case "object":
      if (Buffer.isBuffer(v)) {
        return v.toString("hex");
      }
      if (Array.isArray(v)) {
        return v.join(",");
      }

      try {
        return JSON.stringify(v);
      } catch (e) {
        return;
      }

    case "string":
      return v;
  }
}

/**
 * helper function that redacts a string representation of a "debug" arg
 */
function genRedactedString(str: string, maxLen: number): string {
  const { length } = str;

  return length <= maxLen
    ? str
    : str.slice(0, maxLen) + ' ... <REDACTED full-length="' + length + '">';
}

/**
 * a wrapper for the `debug` module, used to generate
 * "debug functions" that trim the values in their output
 */
export default function genDebugFunction(
  namespace: string
): (...args: any[]) => void {
  const fn = debug(`${NAMESPACE_PREFIX}:${namespace}`);

  function wrappedDebug(...args: any[]): void {
    if (!fn.enabled) {
      return; // no-op
    }

    let sanitizeString = false;
    // we skip the first arg because that is the message
    for (let i = 1; i < args.length; i++) {
        const str = getStringValue(args[i]);;
        if(sanitizeString) {
            // The previous array index indicates this current index
            // needs to be removed from the logs.
            args[i] = '***********';
            sanitizeString = false;
            continue;
        }
        if(typeof str === "string" && str === 'auth') {
            // Expect the next array index will contain 
            // sensitive data that should not be in plaintext
            sanitizeString = true;
        } else if (typeof str === "string" && str.length > MAX_ARGUMENT_LENGTH) {
            args[i] = genRedactedString(str, MAX_ARGUMENT_LENGTH);
        }
    }

    return fn.apply(null, args);
  }

  Object.defineProperties(wrappedDebug, {
    namespace: {
      get() {
        return fn.namespace;
      },
    },
    enabled: {
      get() {
        return fn.enabled;
      },
    },
    destroy: {
      get() {
        return fn.destroy;
      },
    },
    log: {
      get() {
        return fn.log;
      },
      set(l) {
        fn.log = l;
      },
    },
  });
  return wrappedDebug;
}

// TODO: remove these
// expose private stuff for unit-testing
export { MAX_ARGUMENT_LENGTH, getStringValue, genRedactedString };
