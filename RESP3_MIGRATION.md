# RESP3 Migration Notes

ioredis can now talk RESP3 by setting `protocol: 3`:

```js
const redis = new Redis({ protocol: 3 });
```

How RESP3-only reply types are surfaced in JavaScript is controlled by
`replyMapping`:

- `"legacy"` (**default**, even when `protocol: 3`): RESP3-only types are
  coerced toward their RESP2-compatible shapes. This is the closest thing to a
  drop-in default, **but it is best-effort, not a guarantee** — switching a
  connection to `protocol: 3` can still change what your application receives.
  See the known deltas below; you may need to adjust code even on `legacy`.
- `"resp3"`: RESP3-only types are surfaced natively (maps as objects, doubles
  as numbers, booleans as `true`/`false`).

> **Migrating to `protocol: 3` is not zero-touch.** Audit your handling of the
> commands listed below regardless of `replyMapping`.

```js
const redis = new Redis({ protocol: 3, replyMapping: "resp3" });
```

The legacy coercions are applied in the parser via a per-connection type map
(see `legacyTypeMapping` in `lib/DataHandler.ts`):

| RESP3 type    | `legacy` mapping        | `resp3` mapping     |
| ------------- | ----------------------- | ------------------- |
| Big number    | string                  | string              |
| Double        | string                  | number              |
| Boolean       | number (`1`/`0`)        | boolean             |
| Map           | flat array `[k, v, ...]`| plain object        |
| Set           | array                   | array               |
| Verbatim str  | buffer                  | buffer              |

---

## Booleans (`#t` / `#f`)

RESP2 has **no boolean type** — boolean-ish replies arrive as integers
(`:1` / `:0`). RESP3 added a native boolean (`#t` / `#f`), and a small set of
commands emit it. On Redis 8 the observed set is the **vector-set family**:
`VADD`, `VISMEMBER`, `VREM`, `VSETATTR`. (Classic commands such as `SISMEMBER`,
`HEXISTS`, `EXPIRE`, `SETNX` still return integers under RESP3.)

To preserve RESP2 parity, the `legacy` mapping coerces RESP3 booleans to
integers:

- `legacy` (default): `#t` → `1`, `#f` → `0` — matches RESP2.
- `resp3`: `#t` → `true`, `#f` → `false`.

This coercion only ever runs on a RESP3 connection — a RESP2 connection never
receives a `#` frame. The conversion lives in the decoder (`#decodeBoolean` in
`lib/resp/decoder.ts`), driven by the type map, mirroring how `DOUBLE` and `MAP`
are already coerced; it therefore applies at any nesting depth for free.

**The return value of these commands depends on `replyMapping`** — there is no
single "RESP3" answer your code can assume:

- `legacy`: `1` / `0` (numbers)
- `resp3`: `true` / `false` (booleans)

**Action required (both mappings):** do not assume RESP3-native booleans just
because you set `protocol: 3`. Under the default `legacy` mapping these commands
return `1` / `0`, so any code that does `if (reply === true)` (or relies on the
boolean type, e.g. in TypeScript) must handle the numeric form. If you opt into
`resp3`, do the opposite. Pick one mapping and match your code to it.

---

## Known discrepancy: `XREAD` / `XREADGROUP` reply shape

> Status: **not yet reconciled.** Tracked by a pending test in
> `test/functional/resp3.ts` (the `xreadgroup` parity case is marked
> `it.skip` with a `knownDiscrepancy` note).

In RESP3, `XREAD` / `XREADGROUP` return a **map** keyed by stream name:

```
{ "stream": [ ["id", ["field", "value"]] ] }
```

Under `legacy` mapping every RESP3 map is flattened to a flat
`[key, value, ...]` array. For a single stream that yields:

```js
["stream", [["id", ["field", "value"]]]]
```

But RESP2 returns these commands as an **array of `[stream, entries]` pairs**:

```js
[["stream", [["id", ["field", "value"]]]]]
```

So the legacy shape is missing the outer array wrapper — it is **not** RESP2
compatible for these two commands.

Why generic flattening can't fix it: most map-returning commands (e.g.
`CONFIG GET`) have a RESP2 form that already *is* a flat `[k, v, ...]` array, so
flattening is correct for them. `XREAD`/`XREADGROUP` are special because their
RESP2 form was already an array-of-pairs, not a flat map. Reconciling them needs
a **command-specific reply transform** (re-pair the flattened map into
`[[stream, entries], ...]`), not a change to the generic map mapping.

`XREAD` has the same latent issue; it currently only avoids it because a query
with no new entries returns `null`.

**Action required (until fixed):** if you read streams under `protocol: 3` with
`legacy` mapping, do not rely on the RESP2 outer-array shape for
`XREAD`/`XREADGROUP`. Either use `replyMapping: "resp3"` and read the map
directly, or normalize the reply yourself.
