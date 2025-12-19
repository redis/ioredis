import { CommandParameter } from "../types";

const parseNumberArgument = (
  arg: CommandParameter | undefined
): number | undefined => {
  if (typeof arg === "number") {
    return arg;
  }

  if (Buffer.isBuffer(arg)) {
    return parseNumberArgument(arg.toString());
  }

  if (typeof arg === "string") {
    const value = Number(arg);
    return Number.isFinite(value) ? value : undefined;
  }

  return undefined;
};

const parseStringArgument = (
  arg: CommandParameter | undefined
): string | undefined => {
  if (typeof arg === "string") {
    return arg;
  }

  if (Buffer.isBuffer(arg)) {
    return arg.toString();
  }

  return undefined;
};

export const parseSecondsArgument = (
  arg: CommandParameter | undefined
): number | undefined => {
  const value = parseNumberArgument(arg);

  if (value === undefined) {
    return undefined;
  }

  if (value <= 0) {
    return 0;
  }

  return value * 1000;
};

export const parseBlockOption = (
  args: CommandParameter[]
): number | null | undefined => {
  for (let i = 0; i < args.length; i++) {
    const token = parseStringArgument(args[i]);
    if (token && token.toLowerCase() === "block") {
      const duration = parseNumberArgument(args[i + 1]);
      if (duration === undefined) {
        return undefined;
      }

      if (duration <= 0) {
        return 0;
      }

      return duration;
    }
  }

  return null;
};
