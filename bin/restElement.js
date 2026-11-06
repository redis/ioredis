"use strict";

// TypeScript 4.1 rejects tuple rest elements that are not last (TS1256).
// Command overloads are written as [prefix..., ...rest, suffix..., callback].
// Folding the suffix types into the rest element keeps that rest last, which
// is valid on TypeScript 4.1, and still accepts the original argument order
// (including a trailing callback). Moving the suffix in front of the rest
// would typecheck only calls that pass those arguments first.

function skipString(source, start) {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i++) {
    const c = source[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === quote) return i + 1;
  }
  return source.length;
}

function findClosing(source, openIndex, openCh, closeCh) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    const c = source[i];
    if (c === "'" || c === '"' || c === "`") {
      i = skipString(source, i) - 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      const next = source.indexOf("\n", i);
      i = next < 0 ? source.length - 1 : next;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const next = source.indexOf("*/", i + 2);
      i = next < 0 ? source.length - 1 : next + 1;
      continue;
    }
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`Unbalanced '${openCh}' at ${openIndex}`);
}

function splitTopLevel(source, separator) {
  const parts = [];
  let current = "";
  let angle = 0;
  let square = 0;
  let paren = 0;
  let brace = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "'" || c === '"' || c === "`") {
      const end = skipString(source, i);
      current += source.slice(i, end);
      i = end - 1;
      continue;
    }
    if (c === "<") angle++;
    else if (c === ">") angle = Math.max(0, angle - 1);
    else if (c === "[") square++;
    else if (c === "]") square = Math.max(0, square - 1);
    else if (c === "(") paren++;
    else if (c === ")") paren = Math.max(0, paren - 1);
    else if (c === "{") brace++;
    else if (c === "}") brace = Math.max(0, brace - 1);
    if (
      c === separator &&
      angle === 0 &&
      square === 0 &&
      paren === 0 &&
      brace === 0
    ) {
      parts.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  parts.push(current);
  return parts;
}

function unwrapParens(type) {
  let value = type.trim();
  while (value.startsWith("(") && value.endsWith(")")) {
    const close = findClosing(value, 0, "(", ")");
    if (close !== value.length - 1) break;
    value = value.slice(1, -1).trim();
  }
  return value;
}

function splitUnion(type) {
  return splitTopLevel(unwrapParens(type), "|")
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripTrailingArray(type) {
  if (!type.endsWith("[]")) return null;
  const element = type.slice(0, -2).trim();
  if (!element) return null;
  return element;
}

function restElementTypes(restType) {
  const arrayElement = stripTrailingArray(restType.trim());
  if (arrayElement !== null) return splitUnion(arrayElement);
  if (/^[A-Za-z_$][\w$]*$/.test(restType.trim())) {
    return [`${restType.trim()}[number]`];
  }
  return splitUnion(`${restType.trim()}[number]`);
}

function parseElement(element) {
  const trimmed = element.trim();
  if (!trimmed) return null;
  const rest = trimmed.startsWith("...");
  const body = rest ? trimmed.slice(3).trim() : trimmed;
  const match = body.match(/^([A-Za-z_$][\w$]*)\s*(\?)?\s*:\s*([\s\S]+)$/);
  if (!match) return null;
  return {
    rest,
    name: match[1],
    optional: Boolean(match[2]),
    type: match[3].trim(),
  };
}

function formatElement(element) {
  return `${element.name}${element.optional ? "?" : ""}: ${element.type}`;
}

// Returns the rewritten tuple interior, or null when the tuple is already valid
// or cannot be parsed safely.
function foldTuple(inner) {
  const elements = splitTopLevel(inner, ",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(parseElement);
  if (elements.length === 0 || elements.some((element) => element == null)) {
    return null;
  }
  const restIndexes = [];
  elements.forEach((element, index) => {
    if (element.rest) restIndexes.push(index);
  });
  if (restIndexes.length !== 1) return null;
  const restIndex = restIndexes[0];
  if (restIndex === elements.length - 1) return null;

  const prefix = elements.slice(0, restIndex);
  const rest = elements[restIndex];
  const suffix = elements.slice(restIndex + 1);
  const types = [];
  for (const type of [
    ...restElementTypes(rest.type),
    ...suffix.flatMap((element) => splitUnion(element.type)),
  ]) {
    if (!types.includes(type)) types.push(type);
  }

  return [
    ...prefix.map(formatElement),
    `...${rest.name}: (${types.join(" | ")})[]`,
  ].join(", ");
}

function transformTuples(source) {
  let out = "";
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "'" || c === '"' || c === "`") {
      const end = skipString(source, i);
      out += source.slice(i, end);
      i = end - 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      const stop = end < 0 ? source.length : end;
      out += source.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? source.length : end + 2;
      out += source.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (c === "[") {
      const close = findClosing(source, i, "[", "]");
      const inner = transformTuples(source.slice(i + 1, close));
      const folded = foldTuple(inner);
      out += `[${folded == null ? inner : folded}]`;
      i = close;
      continue;
    }
    out += c;
  }
  return out;
}

function isLooseRestOverload(line) {
  const paramsEnd = line.lastIndexOf("):");
  const params = paramsEnd === -1 ? line : line.slice(0, paramsEnd);
  return /\.\.\.[A-Za-z_$][\w$]*\s*:\s*\([^;]*Callback</.test(params);
}

function signatureName(line) {
  const match = line.match(/^(\s*)([A-Za-z_][\w$]*)(<[\s\S]*?>)?\(/);
  if (!match || !line.trimEnd().endsWith(";")) return null;
  return match[2];
}

// Precise rest overloads must precede folded callback overloads inside one
// command block. Blocks are split by comments and blank lines so a later
// subcommand cannot move into an earlier doc section.
function reorderLooseOverloads(source) {
  const lines = source.split("\n");
  let index = 0;
  while (index < lines.length) {
    if (signatureName(lines[index]) == null) {
      index++;
      continue;
    }
    const start = index;
    while (index < lines.length && signatureName(lines[index]) != null) {
      index++;
    }
    const groups = new Map();
    for (let cursor = start; cursor < index; cursor++) {
      const name = signatureName(lines[cursor]);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(cursor);
    }
    for (const indexes of groups.values()) {
      const next = [
        ...indexes
          .filter((lineIndex) => !isLooseRestOverload(lines[lineIndex]))
          .map((lineIndex) => lines[lineIndex]),
        ...indexes
          .filter((lineIndex) => isLooseRestOverload(lines[lineIndex]))
          .map((lineIndex) => lines[lineIndex]),
      ];
      indexes.forEach((lineIndex, position) => {
        lines[lineIndex] = next[position];
      });
    }
  }
  return lines.join("\n");
}

function ensureRestElementsLast(source) {
  return reorderLooseOverloads(transformTuples(source));
}

module.exports = ensureRestElementsLast;
module.exports.ensureRestElementsLast = ensureRestElementsLast;
