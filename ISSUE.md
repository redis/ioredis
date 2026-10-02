# Cluster stays in `close` forever after an aborted `connect()`

> **Temporary file.** It gathers the evidence behind this branch and will be deleted before the pull
> request is merged. Its content is meant to end up in the GitHub issue and in the PR description.

Code references point to `main` at [`a8378bd`](https://github.com/redis/ioredis/tree/a8378bd9a6d44823b2c1813f258a179313d4a23f)
(6.0.0 + later fixes). The same code paths exist in 4.28.5 and 5.11.1.

## Summary

A `Cluster` can end up with `status === "close"`, no `reconnectTimeout`, no `close` listener and an
empty connection pool. Nothing in ioredis moves it out of that state: `handleCloseEvent()` never runs
again, so the client neither reconnects nor reaches `end`. With `enableOfflineQueue: true` (the
default), every command is pushed to the unbounded `offlineQueue` and never settles, until the process
runs out of memory.

It is triggered by a late `end` from a node socket that lands while `connect()` is resolving the
startup node hostnames.

## What we saw in production (Commanders Act)

- Service: a Node.js HTTP collector that counts hits in Redis Cluster with fire-and-forget pipelines
  (`INCRBY`), ioredis **4.28.5**, default `clusterRetryStrategy`, `enableReadyCheck: true`,
  `enableOfflineQueue: true`, one hostname in `startupNodes`.
- A heap snapshot of the pod, about 100 minutes after the problem began, shows:
  - **94 % of the heap** (≈ 1.7 GB of 1.81 GB) held by `Cluster.offlineQueue`:
    **444,844 queued `INCRBY` commands**, never sent, never rejected (≈ 4 KB and ≈ 50 JS objects
    each, with their `Pipeline`, promises and suspended async functions);
  - the `Cluster` object in this state:

    | Field | Value | Meaning |
    |---|---|---|
    | `status` | `"close"` | |
    | `reconnectTimeout` | `null` | no reconnection scheduled |
    | `manuallyClosing` | `false` | not `quit()` nor `disconnect()` |
    | `_events` | `{ error }` only | **no `close` listener**: `handleCloseEvent()` will never run |
    | `connectionPool.nodes.all` | empty | aborted before `connectionPool.reset(nodes)` |
    | `subscriber.started` | `false` | `subscriber.stop()` ran last, i.e. `disconnect()` was called |
    | `_addedScriptHashesCleanInterval` | still set | last event was a `connect()` that stopped before setting its listeners |

- The queue grew at a constant ≈ 4,400 commands/min (≈ 1 GB/h) from its first entry to the snapshot:
  the client never recovered on its own. Other clients in the same process (standalone `Redis`) were
  `ready`.

## Mechanism

Reconstructed from the snapshot state and the code, then reproduced (see below).

1. A Redis incident (typically a failover) makes `CLUSTER INFO` report `cluster_state:fail` while
   `CLUSTER SLOTS` still answers. The ready check fails and calls `disconnect(true)`
   ([index.ts:358-367](https://github.com/redis/ioredis/blob/a8378bd9a6d44823b2c1813f258a179313d4a23f/lib/cluster/index.ts#L358-L367)).
   `manuallyClosing` stays `false`.
2. `disconnect(true)` calls `connectionPool.reset([])`
   ([index.ts:442](https://github.com/redis/ioredis/blob/a8378bd9a6d44823b2c1813f258a179313d4a23f/lib/cluster/index.ts#L442)),
   which calls `disconnect()` on every node and **removes it from the pool immediately**
   ([ConnectionPool.ts:203-209](https://github.com/redis/ioredis/blob/a8378bd9a6d44823b2c1813f258a179313d4a23f/lib/cluster/ConnectionPool.ts#L203-L209)),
   although its socket is not closed yet. Each socket emits `end` later.
3. The first `end` finds the pool empty: `drain` → `setStatus("close")`
   ([index.ts:252-254](https://github.com/redis/ioredis/blob/a8378bd9a6d44823b2c1813f258a179313d4a23f/lib/cluster/index.ts#L252-L254))
   → the `once("close")` listener runs `handleCloseEvent()` → `reconnecting`, retry in ≈ 100 ms.
4. The retry calls `connect()`: `status = "connecting"`, then **asynchronous DNS lookup** of the
   startup nodes
   ([index.ts:301](https://github.com/redis/ioredis/blob/a8378bd9a6d44823b2c1813f258a179313d4a23f/lib/cluster/index.ts#L301)).
   The new `once("close")` listeners are only registered **after** the lookup
   ([index.ts:386-387](https://github.com/redis/ioredis/blob/a8378bd9a6d44823b2c1813f258a179313d4a23f/lib/cluster/index.ts#L386-L387)).
5. A **late** `end` from one of the old sockets arrives during the lookup. The pool is still empty,
   and the pool emits `drain` on **every** `end` that finds it empty, not only the first one
   ([ConnectionPool.ts:140-150](https://github.com/redis/ioredis/blob/a8378bd9a6d44823b2c1813f258a179313d4a23f/lib/cluster/ConnectionPool.ts#L140-L150)).
   The guard added for `recreate()` (`this.nodes.all[key] !== redis`) does not apply: the key is no
   longer in the pool at all. → `setStatus("close")` with **no listener**.
6. The lookup resolves. `connect()` sees `status !== "connecting"` and gives up with
   `Connection is aborted`
   ([index.ts:316-323](https://github.com/redis/ioredis/blob/a8378bd9a6d44823b2c1813f258a179313d4a23f/lib/cluster/index.ts#L316-L323))
   **without scheduling a reconnection**. The rejection is swallowed by the caller in
   `handleCloseEvent()`
   ([index.ts:1076-1078](https://github.com/redis/ioredis/blob/a8378bd9a6d44823b2c1813f258a179313d4a23f/lib/cluster/index.ts#L1076-L1078)).
7. Result: `close`, no listener, no timer, empty pool. `sendCommand()` keeps queueing.

Why it is rare: it needs an incident that empties the pool at once (failed ready check), a socket that
closes more slowly than the retry delay (node not answering the FIN, busy event loop; up to
`disconnectTimeout`, 2 s), and that late `end` must land inside the DNS lookup window (usually a few
ms, longer with slow DNS or a saturated libuv thread pool).

`commandTimeout` and `maxRetriesPerRequest` do not help: they apply to node connections, not to
`Cluster.sendCommand()`, which queues the command before any node is involved.

## Reproduction and workaround

Reproduced in our codebase against a real 3-node cluster with ioredis 4.28.5:

1. wait for `ready`;
2. wrap `resolveStartupNodeHostnames()` once so that, after the real lookup, it makes the pool emit
   `drain` (what the late `end` of a removed node does);
3. call `disconnect(true)` (what a failed ready check does) and wait 500 ms.

Observed: `status === "close"`, `reconnectTimeout` empty, and `cluster.set()` stays pending in
`offlineQueue`.

That reproduction emits the stray `drain` by hand. This branch reproduces it in ioredis' own suite
without touching any internals:
[test/functional/cluster/lateNodeEnd.ts](test/functional/cluster/lateNodeEnd.ts), with two
`MockServer` nodes and real sockets.

| Production | Test |
|---|---|
| Failover: `CLUSTER INFO` reports `cluster_state:fail` | The first `CLUSTER INFO` answers `cluster_state:fail` → real ready check → `disconnect(true)` |
| A node does not answer the FIN (paused or overloaded) | The node that answered sets `allowHalfOpen = true` on its socket: it never closes its side, so ioredis destroys it after `disconnectTimeout` (200 ms in the test), and its `end` comes late |
| Slow DNS lookup during the reconnection | The `dnsLookup` option of the reconnection answers right after that late `end` |
| Commands keep coming | A `get` is sent during the incident |

The test expects the cluster to become `ready` again and the `get` to resolve. On `main` it fails,
consistently (10 runs out of 10):

```text
Error: no "ready" within 1000ms: status=close, reconnectTimeout=false, offlineQueue=1
```

with the same debug sequence as in production:

```text
ioredis:cluster Ready check failed (fail). Reconnecting...
ioredis:cluster status: connect -> disconnecting
ioredis:cluster:connectionPool Reset with []
ioredis:cluster status: disconnecting -> close
ioredis:cluster status: close -> reconnecting
ioredis:cluster Cluster is disconnected. Retrying after 102ms
ioredis:cluster status: reconnecting -> connecting
ioredis:cluster status: connecting -> close
ioredis:cluster resolved hostname redis.test to IP 127.0.0.1
ioredis:cluster discard connecting after resolving startup nodes because the status changed to close
ioredis:cluster Got error RedisError: Connection is aborted when reconnecting. Ignoring...
```

Nothing happens after the last line: no retry, no `end`.

Run it with:

```bash
TS_NODE_TRANSPILE_ONLY=true NODE_ENV=test npx mocha --no-experimental-strip-types \
  test/functional/cluster/lateNodeEnd.ts
```

We work around it with an application-level watchdog, `watchStuckCluster`: every 5 s it checks
`status === "close" && !reconnectTimeout && !manuallyClosing`; if that lasts 10 s it calls
`cluster.connect()` again. A legitimate `close` lasts at most one retry delay, so 10 s is
unambiguous. In the same test, the watchdog brings the cluster back to `ready` and the queued commands
are replayed. It relies on private fields (`reconnectTimeout`, `manuallyClosing`, `offlineQueue`), so it
is not a real fix.

## Related tickets

| Ticket | State | What it is about | Proximity to this bug |
|---|---|---|---|
| [#1864](https://github.com/redis/ioredis/pull/1864) fix: Improve cluster connection pool logic when disconnecting | PR closed by stale bot, **not merged** | Stray `drain` events from nodes removed by `reset()` set the status to `close` during a later `connect()` → `Connection is aborted`. Fix: remove node listeners when a node leaves the pool, add new nodes before removing old ones. Reproduced with `quit()` + `connect()` (Bull). | **Very high**: same root cause (step 5), different trigger. Its listener cleanup would likely prevent the stray `drain`, but not the "abort without reconnecting" in step 6. |
| [#709](https://github.com/redis/ioredis/issues/709) flaky cluster connection sequence | Closed | Cluster sometimes never connects after a failed ready check (`cluster_state:fail`) on startup. | **High**: same trigger (`disconnect(true)` from the ready check). |
| [#741](https://github.com/redis/ioredis/pull/741) chore(test): easy way to get cluster stuck | PR open since 2018 | Test with a mock server returning `cluster_state:fail` a few times, plus a fix keeping the `connect()` promise across `disconnect(true)`. | **High** for the test setup (reusable to trigger the ready-check path); its fix targets the lost `connect()` promise, not the lost reconnection. |
| [#979](https://github.com/redis/ioredis/issues/979) DNS lookup failure causes cluster connection to hang | Closed | Errors during `resolveStartupNodeHostnames()` led to a hang or an early exit. | **Medium**: same DNS window in `connect()`, different failure (lookup error, not a status change). |
| [#2099](https://github.com/redis/ioredis/issues/2099) Sometimes the connection is not reestablished when `enableReadyCheck` is false | Closed | Standalone `Redis` stops retrying after some restarts. | **Low**: same symptom (retries stop forever), standalone client, different code. |
| [#587](https://github.com/redis/ioredis/issues/587) Cluster: Fail to reconnect to node | Open | A restarted replica is never reconnected; the cluster itself stays usable. | **Low**: node-level, not cluster-level. Partly addressed by [#2096](https://github.com/redis/ioredis/pull/2096). |
| [#2135](https://github.com/redis/ioredis/pull/2135) fix(cluster): recreate stale connection on circular MOVED | Merged | Added the `nodes.all[key] !== redis` guard in the pool's `end` handler and "remove before disconnect" in `recreate()`. | **Context**: closest existing guard against a stale `end`; does not cover nodes removed by `reset()`. |
| [#2204](https://github.com/redis/ioredis/pull/2204) fix: reset retry attempts when connect() is called after giving up | Merged | Manual `connect()` from `end` resets `retryAttempts`. | **Context**: confirms a manual `connect()` is a supported way out, as our watchdog does from `close`. |
| [#2131](https://github.com/redis/ioredis/pull/2131) Prevent timed-out offline commands from replaying | PR open | Offline queue and `commandTimeout` semantics. | **Low**: offline queue behaviour, not the stuck state. |

No ticket describes this exact sequence (late `end` during the DNS lookup → aborted `connect()` →
stuck in `close`).

## Fix directions (to be decided on this branch)

- **A.** In `connect()`, when the status changed during the lookup, hand over to `handleCloseEvent()`
  instead of returning silently, so a reconnection is scheduled (or `end` reached and the queue
  flushed).
- **B.** In `ConnectionPool`, ignore the `end` of a node that is no longer in the pool (or detach its
  listener in `reset()`/`removeNode()`), so no stray `drain` is emitted. Close to #1864.
- **C.** Register the `close` listeners before the DNS lookup.

A alone guarantees the client cannot stay stuck whatever emits the stray `close`; B removes the
known source. Both may be worth doing.
