import { CommandParameter } from "../types";

/**
 * Parses a command parameter to a number.
 * @param arg - The command parameter to parse (number, string, or Buffer)
 * @returns The parsed number, or undefined if parsing fails or arg is undefined
 */
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

/**
 * Parses a command parameter to a string.
 * @param arg - The command parameter to parse (string or Buffer)
 * @returns The parsed string, or undefined if arg is not a string/Buffer or is undefined
 */
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

/**
 * Parses a command parameter as seconds and converts to milliseconds.
 * @param arg - The command parameter representing seconds
 * @returns The value in milliseconds, 0 if value is <= 0, or undefined if parsing fails
 */
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

/**
 * Parses the BLOCK option from Redis command arguments (e.g., XREAD, XREADGROUP).
 * @param args - Array of command parameters to search for the BLOCK option
 * @returns The block duration in milliseconds, 0 if duration is <= 0,
 *          null if BLOCK option is not found, or undefined if BLOCK is found but duration is invalid
 */
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
