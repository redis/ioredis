"use strict";

const start = process.hrtime.bigint();

import * as calculateSlot from "cluster-key-slot";
import { writeFileSync } from "fs";
import { join } from "path";
import { v4 as uuid } from "uuid";

// Input parameters
const numKeys = parseInt(process.env.KEYS || "1000000", 10);
const numNodes = parseInt(process.env.NODES || "3", 10);

// Prepare topology
const maxSlot = 16384;
const destination = join(__dirname, `cluster-${numNodes}.txt`);
const counts = Array.from(Array(numNodes), () => 0);
const keys = [];

/*
  This algorithm is taken and adapted from Redis source code
  See: https://github.com/redis/redis/blob/d9f970d8d3f0b694f1e8915cab6d4eab9cfb2ef1/src/redis-cli.c#L5453
*/
const nodes = []; // This only holds starting slot, since the ending slot can be computed out of the next one
let first = 0;
let cursor = 0;
const slotsPerNode = maxSlot / numNodes;

for (let i = 0; i < numNodes; i++) {
  let last = Math.round(cursor + slotsPerNode - 1);

  if (last > maxSlot || i === numNodes - 1) {
    last = maxSlot - 1;
  }

  if (last < first) {
    last = first;
  }

  nodes.push(first);
  first = last + 1;
  cursor += slotsPerNode;
}

// Generate keys and also track slot allocations
for (let i = 0; i < numKeys; i++) {
  const key = uuid();
  const slot = calculateSlot(key);
  const node = nodes.findIndex(
    (start, i) => i === numNodes - 1 || (slot >= start && slot < nodes[i + 1])
  );

  counts[node]++;
  keys.push(key);
}

// Save keys
writeFileSync(destination, keys.join("\n"));

// Print summary
console.log(
  `Generated ${numKeys} keys in ${(
    Number(process.hrtime.bigint() - start) / 1e6
  ).toFixed(2)} ms `
);

for (let i = 0; i < numNodes; i++) {
  const from = nodes[i];
  const to = (i === numNodes - 1 ? maxSlot : nodes[i + 1]) - 1;
  console.log(
    `  - Generated ${
      counts[i]
    } keys for node(s) serving slots ${from}-${to} (${(
      (counts[i] * 100) /
      numKeys
    ).toFixed(2)} %)`
  );
}
