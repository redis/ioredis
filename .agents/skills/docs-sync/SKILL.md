---
name: docs-sync
description: Keep ioredis documentation synchronized with code behavior. Use when an agent changes public APIs, options, Redis command support, examples, generated typings, connection behavior, Cluster/Sentinel behavior, Pub/Sub, pipelines, transactions, scan streams, reconnect behavior, TypeScript usage, or release-facing behavior that may require README or docs updates.
---

# Docs Sync

Use this skill to decide whether an ioredis change needs documentation, update the right docs, and keep examples aligned with tested behavior.

For broad documentation audits, option/API coverage checks, or unclear documentation scope, also read `references/doc-coverage-checklist.md` before deciding what to update.

## Workflow

1. Inspect the changed behavior.
   - Read the diff and the surrounding implementation.
   - Identify whether users must know a new capability, option, error case, event, command signature, return shape, or migration concern.
   - Treat TypeScript declarations and public JSDoc as documentation when command signatures, constructor options, or exported types change.

2. Find the documentation surface.
   - `README.md`: primary user-facing guide, examples, feature overview, options, and common workflows.
   - `lib/redis/RedisOptions.ts`: `RedisOptions`, `CommonRedisOptions`, option JSDoc, and `DEFAULT_REDIS_OPTIONS`.
   - `lib/cluster/ClusterOptions.ts`: `ClusterOptions`, cluster option JSDoc, and `DEFAULT_CLUSTER_OPTIONS`.
   - `lib/connectors/StandaloneConnector.ts` and `lib/connectors/SentinelConnector/types.ts`: connection option types that contribute to public constructor options.
   - `docs/`: generated TypeDoc output from public source comments.
   - `examples/`: runnable snippets that should match current API behavior.
   - `lib/index.ts` and public TypeDoc comments: exported API documentation surface.
   - `test/typing/`: executable documentation for TypeScript signatures.

3. Update docs when the change affects users.
   - Public option or constructor behavior: document option name, default, behavior, topology limitations, and Redis version constraints in JSDoc first; update README/examples when users need prose or usage guidance.
   - Redis command support: update generator config in `bin/`, regenerate `lib/utils/RedisCommander.ts`, and document only if README/docs mention related command groups or if the change affects command typing, return mapping, or examples.
   - Pub/Sub, sharded Pub/Sub, monitor, pipeline, transaction, Sentinel, Cluster, TLS, reconnect, or offline queue behavior: update the relevant README/docs section.
   - New or changed public exports from `lib/index.ts`: update TypeDoc comments and typing tests when the exported type or class is part of the supported API.
   - Breaking or compatibility-sensitive behavior: add explicit migration or caveat wording.
   - Internal-only refactors with no behavioral/API impact: state that no docs update is needed and why.

4. Keep examples honest.
   - Prefer short examples that compile against the current public API.
   - Avoid documenting behavior that is not covered by tests unless you also add or request coverage.
   - If an example requires a Redis version, topology, or protocol mode, say so near the example.
   - Use existing README style and terminology.

5. Verify documentation changes.
   - For TypeScript examples or declarations, run the focused tsd test or add one when appropriate.
   - For API docs comments, run `npm run docs` when the change affects generated docs.
   - For command typing changes, run `node bin/index.js` before validating generated typings.
   - For Markdown-only edits, inspect nearby formatting and links; run `npm run format-check` only when relevant files are covered by Prettier.

## Documentation Decision Checklist

- Does the change alter public exports from `lib/index.ts`?
- Does it add, remove, rename, or change JSDoc/defaults for `RedisOptions`, `CommonRedisOptions`, `ClusterOptions`, standalone connection options, or Sentinel connection options?
- Does it add, remove, or change a Redis command method signature?
- Does it change reply transformation, Buffer variants, callbacks, or Promise behavior?
- Does it affect connection lifecycle, retries, ready checks, offline queue, or subscriber mode?
- Does it affect Cluster routing, redirections, subscriber groups, Sentinel discovery, or TLS?
- Does it add an option, event, error condition, or environment assumption?
- Would a user need different code after this change?

If any answer is yes, update docs or explicitly explain why existing docs already cover it.
