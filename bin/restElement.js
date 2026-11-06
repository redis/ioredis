"use strict";

// TypeScript 4.1 rejects tuple rest elements that are not last (TS1256).
// Command overloads are written as [prefix..., ...rest, suffix..., callback].
// A generic spread `[...Rest, ...suffix]` is valid on TypeScript 4.0+ and keeps
// each suffix required and ordered, so a WITHSCORES overload does not also
// match calls that omit WITHSCORES. Unioning the suffix into the rest element
// is not used: that makes the suffix optional, and when the rest element
// already accepts the suffix (RedisKey includes string) the scores overload
// steals the plain call.

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

function isTypeParamReference(type) {
  return /^[A-Za-z_$][\w$]*$/.test(type);
}

// Unlabeled so the inner `[...Rest, ...suffix]` tuple stays homogeneous.
// TypeScript 4.1 rejects a mix of named and unnamed tuple members (TS5084).
function formatSuffix(element) {
  if (!element.optional) return element.type;
  return /[|&]/.test(element.type) ? `(${element.type})?` : `${element.type}?`;
}

// Returns a rewrite for a tuple whose rest element is not last, or null when
// the tuple is already valid or cannot be parsed safely.
//
// Array rests (`...keys: (RedisKey)[]`) introduce a fresh type parameter.
// Type-parameter rests (`...args: T`) are spread in place so `T` stays the
// tuple of values before the suffix and callback inference still sees it.
function foldTuple(inner, nextToken) {
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
  const suffix = elements.slice(restIndex + 1).map(formatSuffix);
  const reuseTypeParam = isTypeParamReference(rest.type);
  const spread = reuseTypeParam ? rest.type : nextToken();
  const parts = [
    ...prefix.map(formatElement),
    `...${rest.name}: [${["..." + spread, ...suffix].join(", ")}]`,
  ];
  return {
    interior: parts.join(", "),
    binding: reuseTypeParam
      ? null
      : { token: spread, constraint: rest.type.trim() },
  };
}

function transformTuples(source, state) {
  let out = "";
  const nextToken = () => `___RestParam_${state.nextId++}___`;
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
      const inner = transformTuples(source.slice(i + 1, close), state);
      const folded = foldTuple(inner, nextToken);
      if (folded == null) {
        out += `[${inner}]`;
      } else {
        if (folded.binding) state.bindings.push(folded.binding);
        out += `[${folded.interior}]`;
      }
      i = close;
      continue;
    }
    out += c;
  }
  return out;
}

function findFunctionParenBefore(source, index) {
  let square = 0;
  let paren = 0;
  let angle = 0;
  let brace = 0;
  for (let i = index - 1; i >= 0; i--) {
    const c = source[i];
    if (c === "'" || c === '"' || c === "`") {
      i = skipStringBackward(source, i);
      continue;
    }
    if (c === "]") square++;
    else if (c === "[") square = Math.max(0, square - 1);
    else if (c === ")") paren++;
    else if (c === "(") {
      if (paren === 0 && square === 0 && angle === 0 && brace === 0) return i;
      paren = Math.max(0, paren - 1);
    } else if (c === ">") angle++;
    else if (c === "<") angle = Math.max(0, angle - 1);
    else if (c === "}") brace++;
    else if (c === "{") brace = Math.max(0, brace - 1);
  }
  return -1;
}

function skipStringBackward(source, end) {
  const quote = source[end];
  for (let i = end - 1; i >= 0; i--) {
    let slashes = 0;
    while (i - slashes >= 0 && source[i - slashes] === "\\") slashes++;
    if (source[i] === quote && slashes % 2 === 0) return i;
  }
  return 0;
}

function existingTypeParamNames(source, parenIndex) {
  let j = parenIndex - 1;
  while (j >= 0 && /\s/.test(source[j])) j--;
  if (source[j] !== ">") return [];
  let depth = 0;
  let open = -1;
  for (let k = j; k >= 0; k--) {
    if (source[k] === ">") depth++;
    else if (source[k] === "<") {
      depth--;
      if (depth === 0) {
        open = k;
        break;
      }
    }
  }
  if (open < 0) return [];
  return splitTopLevel(source.slice(open + 1, j), ",")
    .map((part) => {
      const match = part.trim().match(/^([A-Za-z_$][\w$]*)/);
      return match ? match[1] : null;
    })
    .filter(Boolean);
}

function insertTypeParam(source, parenIndex, constraint) {
  const names = existingTypeParamNames(source, parenIndex);
  let chosen = "Rest";
  let n = 2;
  while (names.includes(chosen)) {
    chosen = `Rest${n}`;
    n++;
  }
  let j = parenIndex - 1;
  while (j >= 0 && /\s/.test(source[j])) j--;
  if (source[j] === ">") {
    return {
      text:
        source.slice(0, j) +
        `, ${chosen} extends ${constraint}` +
        source.slice(j),
      chosen,
    };
  }
  return {
    text:
      source.slice(0, parenIndex) +
      `<${chosen} extends ${constraint}>` +
      source.slice(parenIndex),
    chosen,
  };
}

function bindRestParams(source, bindings) {
  let out = source;
  for (const binding of bindings) {
    const idx = out.indexOf(binding.token);
    if (idx < 0) {
      throw new Error(`Missing rest placeholder ${binding.token}`);
    }
    const paren = findFunctionParenBefore(out, idx);
    if (paren < 0) {
      throw new Error(
        `No function signature for rest placeholder ${binding.token}`
      );
    }
    const inserted = insertTypeParam(out, paren, binding.constraint);
    const shift = inserted.text.length - out.length;
    const tokenIdx = idx + shift;
    if (
      inserted.text.slice(tokenIdx, tokenIdx + binding.token.length) !==
      binding.token
    ) {
      throw new Error(`Rest placeholder ${binding.token} moved unexpectedly`);
    }
    out =
      inserted.text.slice(0, tokenIdx) +
      inserted.chosen +
      inserted.text.slice(tokenIdx + binding.token.length);
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
  const state = { nextId: 0, bindings: [] };
  const transformed = transformTuples(source, state);
  return reorderLooseOverloads(bindRestParams(transformed, state.bindings));
}

module.exports = ensureRestElementsLast;
module.exports.ensureRestElementsLast = ensureRestElementsLast;
