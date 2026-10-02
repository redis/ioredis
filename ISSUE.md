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
| [#1864](https://github.com/redis/ioredis/pull/1864) fix: Improve cluster connection pool logic when disconnecting | PR closed by stale bot, **not merged**, never reviewed. The same fix was merged in the Valkey fork: [iovalkey#5](https://github.com/valkey-io/iovalkey/pull/5) (June 2024) | Stray `drain` events from nodes removed by `reset()` set the status to `close` during a later `connect()` → `Connection is aborted`. Fix: remove node listeners when a node leaves the pool, add new nodes before removing old ones. Reproduced with `quit()` + `connect()` (Bull); that scenario no longer reproduces on `main` with `MockServer` (20 cycles pass). | **Very high**: same root cause (step 5), different trigger. Its listener cleanup would likely prevent the stray `drain`, but not the "abort without reconnecting" in step 6. |
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

## A sibling bug: `disconnect()` or `quit()` during the lookup

The same branch of `connect()` has a second consequence, found while testing the fix directions.
If the user calls `disconnect()` or `quit()` while `connect()` resolves the startup nodes:

- the status becomes `disconnecting`;
- the pool is empty (nothing was connected yet, or the previous nodes were removed synchronously),
  so no node will ever emit `end`, hence no `drain`, hence no `close`;
- `connect()` sees `status !== "connecting"` and gives up.

The cluster stays in `disconnecting` forever: it never emits `end`, and commands queued before the
call never settle. Reproduced on `main` with a deferred `dnsLookup`:
[test/functional/cluster/dnsLookup.ts](test/functional/cluster/dnsLookup.ts), "ends when
disconnect()/quit() is called while resolving the startup nodes" (both time out on `main`).

## Fix directions

The code relies on one rule: **every `close` is followed by `handleCloseEvent()`**, which either
schedules a reconnection or ends the client and flushes the queues. The three direct
`setStatus("close")` calls in `lib/cluster/index.ts` are each immediately followed by
`handleCloseEvent()`. The only exception is the pool's `drain`
([index.ts:252-254](https://github.com/redis/ioredis/blob/a8378bd9a6d44823b2c1813f258a179313d4a23f/lib/cluster/index.ts#L252-L254)),
which relies on the `once("close")` listener set by `connect()`, and that listener does not exist
during the lookup. The "Connection is aborted" guard dates back to the introduction of the lookup
(#723, 2018), to give up when the user closes the client meanwhile; it did not anticipate an internal
`drain`, nor that nothing would finish the user's `disconnect()`.

Each direction was tried as a minimal throwaway patch, against the cluster tests
(`test/unit/clusters`, `test/functional/cluster`, with the global helpers and Redis on 6379 as in CI;
184 passing on `main`), the reproduction, and the `disconnect()`-during-lookup scenario:

| Direction | Size | Cluster tests | Late `end` (this bug) | `disconnect()` during lookup |
|---|---|---|---|---|
| **A.** On abort in `close`, call `handleCloseEvent()` | 1 line | ✅ no failure | ✅ | ❌ |
| **A+.** A, and on abort in `disconnecting` with an empty pool, go to `close` first | ~10 lines | ✅ no failure | ✅ | ✅ `end`, queue rejected |
| **B.** In `ConnectionPool`, ignore the `end` of a node no longer in the pool | 1 line | ❌ **22 failures** | ❌ | ❌ |
| **C.** Register the `close` → `handleCloseEvent()` listener before the lookup | 2 lines | ❌ **4 failures** | ✅ | ❌ |

- **A / A+** restore the rule at the one place that breaks it. They go through the user's
  `clusterRetryStrategy`: if it gives up, the client ends and its queue is rejected instead of
  growing. They cover any cause of a status change during the lookup, not only the stray `drain`.
  Limits: the stray `drain` still happens (one extra `close` event and one extra reconnection
  cycle), and a direct `connect()` caller still gets "Connection is aborted" although the client then
  recovers.
- **B** targets the root cause, but `drain` on node `end` is also what completes `disconnect()`:
  `reset([])` removes the nodes at once, and the `drain` of their late `end` moves the cluster to
  `close`, then `end`. Ignoring those `end` events means `disconnect()` never ends (22 failures,
  e.g. "should stop reconnecting when disconnected", "should clear all timers on disconnect"). Doing
  it properly means emitting `-node`/`drain` when a node leaves the pool, as #1864 does: it changes
  when public events (`-node`, `close`, `end`) fire and affects `ClusterSubscriber`. It would not
  cover the `disconnect()`-during-lookup case either.
- **C** breaks the rule the other way: the `catch` of `connect()` already calls `handleCloseEvent()`
  after a lookup failure, so it runs twice, the second time without a reason (the 4 failures in
  `dnsLookup.ts`), and schedules two reconnection timers. Making it work requires removing the
  listener on every abort path, for no gain over A.

Maintainers' stance on scope: #2204 (a small `connect()` fix with a focused test) was merged as is,
while #2197 was closed because it "affects several reconnect and shutdown paths" and falls outside the
"small, isolated bug fix" exception of the contribution guidelines.

## Chosen fix

**A+**, in `Cluster.connect()`: when it gives up because the status changed during the lookup, it
calls a new private `handleAbortedConnect()`:

- `disconnecting` with an empty pool → `setStatus("close")`;
- then, if the status is `close` → `handleCloseEvent()`.

Any other status is left alone: `reconnecting` (a reconnection is already scheduled), `end`, or
`disconnecting` with nodes left (their `drain` will close the cluster).

Tests:

- [test/functional/cluster/lateNodeEnd.ts](test/functional/cluster/lateNodeEnd.ts): the cluster
  reconnects and the queued `get` resolves;
- [test/functional/cluster/dnsLookup.ts](test/functional/cluster/dnsLookup.ts): `disconnect()` and
  `quit()` during the lookup end the cluster and reject the queued `get` with "None of startup nodes
  is available".

All three fail on `main` and pass with the fix.

B remains worth an issue of its own (referring to #1864 and iovalkey#5) to remove the stray `drain`
and the extra reconnection cycle, with a maintainer's go-ahead first.
