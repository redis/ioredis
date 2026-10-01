# Repository Import Patterns

Use this reference when a temporary probe script outside the repository needs to load code from the current branch.

## Why This Exists

When you run `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register /tmp/probe.ts` from the repository root, `ts-node` itself comes from this repository, but the probe file still lives under `/tmp`. Bare imports such as `ioredis` can resolve as if the script were its own package. That is often not what you want for "what does the current branch do right now?" investigations.

The safe default is to build an absolute path from `process.cwd()`, which should be the repository root, and a repository-relative path.

## Default Rule

- Use `lib/` imports when the question is about current-branch behavior.
- Use `built/` imports when the question is about packaged output after a build.
- Avoid bare package imports from `/tmp` unless the probe is explicitly testing published package resolution rather than branch-local source behavior.

## Quick Typecheck Loop

For disposable probes in `ioredis`, the default loop should stay outside the repository and avoid a full package build:

1. Create a temporary directory with `mktemp -d`.
2. Write `probe.ts` there.
3. Write a sibling `tsconfig.json` that extends the repository's `tsconfig.json`.
4. From the repository root, run `npx tsc --noEmit -p /tmp/.../tsconfig.json`.
5. If that passes, run `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register /tmp/.../probe.ts`.

Example temporary `tsconfig.json`:

```json
{
  "extends": "/absolute/path/to/ioredis/tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["node"],
    "typeRoots": ["/absolute/path/to/ioredis/node_modules/@types"]
  },
  "include": ["./probe.ts"]
}
```

This keeps TypeScript module resolution and strictness close to the repository defaults while limiting the check surface to the disposable probe file.

Do not convert this default loop into a checked-in benchmark, example, or package script unless the user explicitly asks for a reusable repository artifact.

## Recommended Helper

The disposable TypeScript scaffold exposes:

    const module = await importRepoModule("lib/index.ts");

Internally, the helper should be equivalent to:

    import { createRequire } from "module";
    import { resolve } from "path";

    const repoRequire = createRequire(resolve(process.cwd(), "package.json"));

    async function importRepoModule(repoRelativePath: string) {
      const absolutePath = resolve(process.cwd(), repoRelativePath);
      return Promise.resolve(repoRequire(absolutePath));
    }

This keeps the import anchored to the current checkout instead of the temporary script location.

## Choosing `lib/` Versus `built/`

Use `lib/` when:

- You are validating a bug fix or regression on the current branch.
- You want to know how the repository behaves before packaging.
- The question is about implementation details or internal helper behavior.

Use `built/` when:

- The question is specifically about what consumers load after `npm run build`.
- You need to validate export maps or emitted `.js` and `.d.ts` output.
- The bug only reproduces in generated output.

If the probe uses `built/`, record whether you ran a fresh build first. A stale `built/` directory can create false positives or false negatives.

Do not run `npm run build` only to typecheck or execute a `lib/`-based disposable probe. The fast path is temp `tsconfig` plus `npx tsc --noEmit`, then `TS_NODE_TRANSPILE_ONLY=true node -r ts-node/register`.

## Simple Smoke Targets

When you only need to prove the helper works, start with a simple target that has minimal side effects, for example:

- `lib/index.ts`
- `lib/Redis.ts`
- `lib/Command.ts`
- another file with obvious exported symbols and no environment requirement

If a chosen file pulls in more of the repo than expected, switch to a simpler target rather than weakening the import guidance.

## What To Record

When a probe imports repo code, report:

- The repo-relative path you imported.
- Whether it came from `lib/` or `built/`.
- The repository root used by `process.cwd()`.
- Any prerequisite step such as `npm run build`.
