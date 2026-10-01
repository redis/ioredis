# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, Copilot, Cursor, Aider, etc.) when working with code in this repository.

## Project Overview

ioredis is a full-featured Redis client for Node.js, written 100% in TypeScript. Source lives in `lib/`, compiles to CommonJS in `built/` (the published artifact), and supports standalone, Sentinel, and Cluster topologies.

## Common Commands

### Building

```bash
npm run build          # Wipe built/ and compile TypeScript
node bin/index.js      # Regenerate lib/utils/RedisCommander.ts
```

### Linting and Formatting

```bash
npm run lint           # Run ESLint over lib/
npm run format         # Format files with Prettier
npm run format-check   # Check formatting
```

### Testing

Functional and cluster tests require running Redis servers. Unit tests under `test/unit/` mock the network and do not need a server.

To start and stop local Redis test infrastructure:

```bash
npm run docker:setup      # Start standalone Redis on 6379 and cluster nodes on 3000-3005
npm run docker:teardown   # Stop test Redis servers
```

```bash
npm test                  # Default non-cluster test: test:js then test:tsd
npm run test:js           # Mocha over test/helpers, test/unit, test/functional
npm run test:cluster      # Mocha over test/cluster
npm run test:tsd          # Build then run tsd against test/typing
npm run test:cov          # Test coverage

# Run a single test file
TS_NODE_TRANSPILE_ONLY=true NODE_ENV=test npx mocha --no-experimental-strip-types "test/unit/foo.ts"

# Run a single test by name
TS_NODE_TRANSPILE_ONLY=true NODE_ENV=test npx mocha --no-experimental-strip-types "test/unit/foo.ts" --grep "partial test title"
```

## Generated Code

**Do not hand-edit**: `lib/utils/RedisCommander.ts` (generated), `built/` (build output), and `node_modules/`.

`lib/utils/RedisCommander.ts` holds the typed signatures for every Redis command. This is what gives calls like `redis.set(...)` their types.

Regenerate it with:

```bash
node bin/index.js
```

Generation uses `@ioredis/interface-generator` plus per-command config in `bin/`:

- **`bin/template.ts`** — File skeleton; generated interface is spliced into the `////` marker.
- **`bin/overrides.js`** — Hand-written signatures for commands the generator gets wrong, such as `hgetall` and `mset`.
- **`bin/argumentTypes.js`**, **`bin/returnTypes.js`**, **`bin/sortArguments.js`**, **`bin/typeMaps.js`** — Argument and return type mapping and ordering.

When adding command typing support, edit the `bin/` config and regenerate. Never patch `RedisCommander.ts` directly.

## Architecture

### Layered Design

```text
Public API (`Redis`, `Cluster`, `Pipeline`, `Command`, options)
  → Command facade (`Commander`, generated `RedisCommander` typings, Lua scripts)
    → Command objects and queues (`Command`, offline queue, command queue, pipeline queue)
      → Topology routing (standalone, Sentinel, Cluster slots, subscriber groups)
        → Connection layer (`connectors/`, `redis/event_handler.ts`, retry and ready checks)
          → RESP parsing and reply handling (`DataHandler`, `redis-parser`)
```

### Key Source Areas

- **`lib/index.ts`** — Public export surface for the package. Changes here affect the published TypeScript declarations and user-facing API.
- **`lib/Redis.ts`** — Main standalone and Sentinel client. Manages connection lifecycle (`wait → connecting → connect → ready → close → reconnecting → end`), offline queue behavior, reconnection strategy, and connector selection.
- **`lib/utils/Commander.ts`** — Shared command facade for `Redis` and `Cluster`. Dynamically attaches builtin Redis commands, string and `Buffer` variants, autopipelining dispatch, direct `sendCommand`, and `defineCommand` Lua registration.
- **`lib/Command.ts`** — Single Redis command representation. Handles argument transformation, reply transformation, promise/callback resolution, key-slot calculation, and subscriber/monitor-mode command flags.
- **`lib/DataHandler.ts`** — Parser and reply dispatcher. Wraps `redis-parser`, consumes socket data, resolves queued commands, and routes Pub/Sub replies and monitor messages.
- **`lib/connectors/`** — Network connector implementations. `StandaloneConnector` handles TCP/TLS sockets; `SentinelConnector/` resolves masters through Sentinel using `FailoverDetector` and `SentinelIterator`.
- **`lib/cluster/`** — Cluster client, per-node connection pool, slot cache refresh, redirection handling for `MOVED` and `ASK`, retry scheduling, and cluster Pub/Sub through `ClusterSubscriber`, `ShardedSubscriber`, and `ClusterSubscriberGroup`.
- **`lib/Pipeline.ts`** and **`lib/transaction.ts`** — Batched command execution. `pipeline()` is non-atomic batching; `multi()` adds MULTI/EXEC transaction behavior.
- **`lib/autoPipelining.ts`** — Same-tick command batching. `notAllowedAutoPipelineCommands` lists commands that must bypass autopipelining, such as auth, subscribe, and multi.
- **`lib/Script.ts`** — Lua script abstraction used by `defineCommand`, with `EVALSHA` execution and `EVAL` fallback.
- **`lib/ScanStream.ts`** — Readable stream wrapper for `SCAN`, `HSCAN`, `SSCAN`, and `ZSCAN`.
- **`lib/tracing.ts`** — Command and connection tracing hooks with argument sanitization.

### How Commands Execute

1. User calls a method such as `redis.get()` or `cluster.set()`.
2. `Commander` routes the call through autopipelining, pipeline/transaction handling, or direct `sendCommand`.
3. A `Command` object is created with transformed arguments and callback/promise state.
4. Standalone clients enqueue the command on one connection; Cluster clients choose a node by key slot and may retry on redirects.
5. The command is written to the socket after connection readiness checks and offline queue handling.
6. `redis-parser` parses the RESP reply from the socket.
7. `DataHandler` resolves the matching queued command, applies reply transformers, and emits Pub/Sub or monitor events when relevant.

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/): `<type>: <subject>`.

Common types include `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, and `chore`.

Releases are automated via semantic-release (`.releaserc.json`), so commit messages drive the changelog and version bump.
