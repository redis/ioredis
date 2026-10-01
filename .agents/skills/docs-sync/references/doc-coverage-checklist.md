# ioredis Doc Coverage Checklist

Use this checklist to scan the selected scope and validate that user-facing ioredis behavior is documented in the right place. In diff mode, limit the scan to the selected task scope: staged changes, unstaged changes, staged plus unstaged changes, or a branch comparison such as `git diff main...HEAD` for PR-oriented audits. In comprehensive mode, inventory the public surfaces listed below.

## Public API inventory

- Public exports from `lib/index.ts`: default `Redis`, named `Redis`, `Cluster`, exported classes, exported types, and compatibility exports.
- Constructor and option types:
  - `lib/redis/RedisOptions.ts`: `RedisOptions`, `CommonRedisOptions`, `RetryStrategy`, `ReconnectOnError`, and `DEFAULT_REDIS_OPTIONS`.
  - `lib/cluster/ClusterOptions.ts`: `ClusterOptions`, `ClusterNodeRetryStrategy`, DNS/NAT helper types, and `DEFAULT_CLUSTER_OPTIONS`.
  - `lib/connectors/StandaloneConnector.ts`: standalone TCP/TLS connection options.
  - `lib/connectors/SentinelConnector/types.ts`: Sentinel connection options, failover behavior, and sentinel-specific limits.
- Generated command API:
  - `lib/utils/RedisCommander.ts` is generated and must not be hand-edited.
  - `bin/overrides.js`, `bin/argumentTypes.js`, `bin/returnTypes.js`, `bin/sortArguments.js`, and `bin/typeMaps.js` define command signature and return documentation inputs.
- Core classes and behavior surfaces: `lib/Redis.ts`, `lib/cluster/index.ts`, `lib/Command.ts`, `lib/Pipeline.ts`, `lib/transaction.ts`, `lib/ScanStream.ts`, `lib/DataHandler.ts`, `lib/autoPipelining.ts`, `lib/Script.ts`, and `lib/tracing.ts`.
- User-facing examples and executable docs: `README.md`, `examples/`, and `test/typing/`.

## Option JSDoc requirements

- Every public option on `CommonRedisOptions`, `RedisOptions`-contributing connection types, and `ClusterOptions` should have clear JSDoc unless the option is intentionally internal.
- JSDoc should include:
  - What the option changes in user-visible behavior.
  - Default value with `@default`, matching `DEFAULT_REDIS_OPTIONS` or `DEFAULT_CLUSTER_OPTIONS`.
  - Accepted values when the TypeScript type is broad, such as callback return contracts or string roles.
  - Topology limits, such as standalone-only, Sentinel-only, Cluster-only, subscriber-mode, or RESP mode constraints.
  - Redis version requirements when relevant.
- Keep JSDoc and defaults synchronized for options such as retry strategies, timeouts, offline queue behavior, ready checks, auto pipelining, client info, authentication, Sentinel discovery, Cluster redirections, SRV lookup, NAT mapping, and sharded subscribers.
- When an option is deprecated, renamed, or compatibility-only, document that in JSDoc and remove stale README guidance if it no longer applies.

## Documentation surfaces

- `README.md`: main guide, examples, feature overview, constructor options, Cluster, Sentinel, Pub/Sub, pipelines, transactions, Lua scripts, streams/scans, TLS, reconnect behavior, and TypeScript usage.
- `docs/`: generated TypeDoc output from `npm run docs`; update generated docs only as part of an intentional docs generation change.
- TypeDoc source comments: public JSDoc in `lib/index.ts`, `lib/redis/RedisOptions.ts`, `lib/cluster/ClusterOptions.ts`, connector option types, tracing types, and public classes.
- `examples/`: runnable examples that should compile and use current APIs.
- `test/typing/`: tsd coverage for public TypeScript signatures, command typings, constructor options, and exported types.

## Code-first pass

- Start from code, not existing docs. Identify the changed public symbol, option, command signature, return type, default, error, event, or lifecycle behavior.
- Map the behavior to the closest existing doc surface. Prefer updating an existing README section, JSDoc block, example, or typing test over creating a new document.
- For command typing changes, update generator config in `bin/`, regenerate `lib/utils/RedisCommander.ts`, and consider `test/typing/commands.test-d.ts`.
- For option changes, update the interface JSDoc, default object, README option guidance if present, and tsd coverage when the type surface matters.
- For behavior changes in Cluster, Sentinel, Pub/Sub, pipelines, transactions, scan streams, reconnect logic, ready checks, timeouts, tracing, or data handling, check both README prose and public JSDoc.

## Evidence capture

- Record the file path and symbol or setting name, for example `lib/redis/RedisOptions.ts:CommonRedisOptions.commandTimeout`.
- Record the default from `DEFAULT_REDIS_OPTIONS` or `DEFAULT_CLUSTER_OPTIONS` when documenting options.
- Record the implementation behavior that proves the docs text, such as the method, event handler, retry branch, or command transformer.
- Avoid large code dumps. A short path plus symbol and behavior note is enough.

## Red flags

- README option names, defaults, or examples differ from `RedisOptions`, `ClusterOptions`, connector option types, or default objects.
- Public options exist without JSDoc, or JSDoc omits important default/behavior constraints.
- Generated TypeDoc pages under `docs/` are stale relative to TypeScript source comments.
- `lib/utils/RedisCommander.ts` was manually edited instead of regenerated from `bin/` config.
- Command return types, Buffer variants, callbacks, Promise behavior, or pipeline/transaction behavior changed without typing or docs review.
- Removed, renamed, or deprecated features remain documented as current behavior.
- Examples rely on unsupported Redis versions, topology assumptions, or undocumented setup.

## Structural changes

- Propose README restructuring only when an existing section mixes quick-start usage with deep reference detail, or when Cluster/Sentinel/Pub/Sub/TypeScript material has no sensible home.
- Keep quick-start examples short. Move advanced retry, timeout, topology, command typing, and failure-mode details into focused sections or JSDoc.
- Cross-link related concepts instead of duplicating long explanations, especially for options shared between standalone Redis and Cluster `redisOptions`.

## Diff mode guidance

- Choose the diff source that matches the task:
  - Staged work: `git diff --cached`.
  - Unstaged work: `git diff`.
  - All local in-progress work: inspect both `git diff --cached` and `git diff`.
  - PR-oriented branch audit: `git diff main...HEAD` or the equivalent branch base.
- Focus only on changed public behavior: new exports/options, modified defaults, removed features, renamed settings, new command signatures, changed reply transformations, or changed lifecycle behavior.
- Document removals explicitly so stale README, examples, JSDoc, TypeDoc output, and typing tests can be pruned.

## Patch guidance

- Keep edits scoped and aligned to the existing README/JSDoc tone.
- Do not hand-edit `lib/utils/RedisCommander.ts`; regenerate it with `node bin/index.js` after command typing config changes.
- Leave translated or vendored docs untouched unless the task explicitly targets them.
- For Markdown-only updates, inspect nearby formatting. For JSDoc/API changes, run `npm run docs` when generated docs must be refreshed.
