#!/usr/bin/env node
/**
 * Compares two API lists written by bin/api-extract.js and prints what was
 * added, removed and changed. A name counts as changed when it exists in both
 * lists but its lines (signatures, overloads) differ.
 *
 * Usage: node bin/api-diff.js <before> <after>
 */
const fs = require("fs");

// "MethodSignature Redis.get :: get(...)" -> "Redis.get"
// "Event Cluster.node error"              -> "event Cluster.node error"
function keyOf(line) {
  const kind = line.slice(0, line.indexOf(" "));
  const name = line.slice(kind.length + 1).split(" :: ")[0];
  return kind === "Event" ? `event ${name}` : name;
}

function load(file) {
  const byKey = new Map();
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    const key = keyOf(line);
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key).add(line);
  }
  return byKey;
}

function diff(before, after) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const [key, lines] of after) {
    if (!before.has(key)) added.push(...lines);
  }
  for (const [key, lines] of before) {
    if (!after.has(key)) {
      removed.push(...lines);
      continue;
    }
    const next = after.get(key);
    const gone = [...lines].filter((l) => !next.has(l));
    const come = [...next].filter((l) => !lines.has(l));
    if (gone.length || come.length) changed.push({ key, gone, come });
  }
  return { added, removed, changed };
}

function main() {
  const [beforeFile, afterFile] = process.argv.slice(2);
  if (!beforeFile || !afterFile) {
    console.error("Usage: node bin/api-diff.js <before> <after>");
    process.exitCode = 2;
    return;
  }

  const { added, removed, changed } = diff(load(beforeFile), load(afterFile));
  if (!added.length && !removed.length && !changed.length) {
    console.log("No public API changes.");
    return;
  }

  const section = (title, lines) => {
    if (!lines.length) return;
    console.log(`${title}:`);
    for (const line of lines) console.log(`  ${line}`);
    console.log();
  };
  section(
    "Added",
    added.map((l) => `+ ${l}`)
  );
  section(
    "Removed",
    removed.map((l) => `- ${l}`)
  );
  if (changed.length) {
    console.log("Changed:");
    for (const { key, gone, come } of changed) {
      console.log(`  ${key}`);
      for (const l of gone) console.log(`    - ${l}`);
      for (const l of come) console.log(`    + ${l}`);
    }
  }
}

main();
