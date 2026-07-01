---
name: implement-command
description: Use when adding or updating Redis command support in ioredis, including command metadata checks, generator inputs under bin/, generated RedisCommander typings, return and argument overrides, functional command tests, optional tsd coverage, and validation.
---

# Implement Command

Use this skill when adding a missing Redis command, correcting an existing command signature, changing command return types, or adding coverage for command-specific Buffer, callback, pipeline, or transformer behavior.

## Command Support Map

- `@ioredis/commands`: upstream command metadata consumed by the generator.
- `bin/index.js`: generator entry point for `lib/utils/RedisCommander.ts`.
- `bin/returnTypes.js`: command return type map. Most new commands need an entry here.
- `bin/argumentTypes.js`: command-specific argument shape overrides when metadata or global mapping is insufficient.
- `bin/typeMaps.js`: global Redis argument category to TypeScript type mapping.
- `bin/overrides.js`: manual overloads for signatures the generator cannot express cleanly.
- `bin/sortArguments.js`: argument reordering for commands whose generated order is wrong.
- `lib/utils/RedisCommander.ts`: generated declarations. Regenerate it; do not hand-edit it.
- `lib/Command.ts`: command argument and reply transformer registry. Touch only when transformer behavior is needed.
- `test/functional/commands/<command>.ts`: runtime command coverage.
- `test/functional/transformer.ts`: transformer runtime coverage.
- `test/typing/commands.test-d.ts`: public command typing coverage.
- `test/typing/transformers.test-d.ts`: transformer typing coverage.

## Workflow

1. Establish command scope.
   - Normalize command keys to lowercase, matching `bin/returnTypes.js`.
   - Resolve command aliases or subcommands before editing.
   - Confirm the command exists in `@ioredis/commands`. If it is missing there, stop and report that the metadata package must be updated before ioredis can generate typed command support.
   - Identify the minimum Redis server version needed and whether functional tests must be version-gated.

2. Inspect current support.
   - Search `lib/utils/RedisCommander.ts`, `bin/`, `test/functional/commands/`, and `test/typing/` for the command and related aliases.
   - Inspect nearby command families before choosing types, for example hash expiration commands, sorted-set commands, stream commands, or pub/sub commands.
   - Check existing argument and reply transformers before adding new ones.

3. Update generator inputs.
   - Prefer `bin/returnTypes.js` for return type corrections.
   - Use a string return type for simple fixed replies.
   - Use a function return type when replies depend on subcommands, options, or tokens.
   - Reuse `hasToken` and `matchSubcommand` in `bin/returnTypes.js` when they fit.
   - Use `bin/argumentTypes.js` only for command-specific argument overrides.
   - Use `bin/typeMaps.js` only for broad metadata category fixes that should affect multiple commands.
   - Use `bin/overrides.js` only when generated overloads cannot express the supported API cleanly.
   - Keep command names lowercase in generator maps unless the surrounding file uses another established convention.

4. Regenerate declarations.
   - In this repo, use `node bin/index.js` unless `package.json` later adds an explicit generation script.
   - Review the generated diff in `lib/utils/RedisCommander.ts`.
   - Check the normal method, callback overload, pipeline/transaction shape, and Buffer variant when the command returns strings, arrays, nullable bulk replies, or transformed objects.
   - If generation changes unrelated commands, inspect the generator input and do not accept surprising churn without an explanation.

5. Add focused runtime coverage.
   - Put command tests in `test/functional/commands/<lowercase-command>.ts`.
   - Use `import Redis from "../../../lib/Redis";` and `import { expect } from "chai";`.
   - Prefer `let redis: Redis`, `beforeEach(() => { redis = new Redis(); })`, and `afterEach(() => { redis.disconnect(); })`.
   - For version-gated command tests under `test/functional/commands/`, import `isRedisVersionLowerThan` from `../../helpers/util`, and use `before(async function () { ... this.skip(); })`; use function syntax when calling `this.skip()`.
   - Use unique keys such as `${command}_${caseName}_${Date.now()}`.
   - Test the ioredis command surface: accepted argument shapes, option ordering, callback behavior, Buffer variants, and reply shape.
   - Keep assertions focused on what ioredis sends and returns. Do not test Redis server internals beyond the smallest deterministic setup needed.
   - Assert exact replies when stable; otherwise assert primitive type, nullable behavior, array/object shape, or Buffer conversion.

6. Add typing coverage when useful.
   - Add cases to `test/typing/commands.test-d.ts` when the command has nontrivial overloads, return types, Buffer variants, callback typing, or option-dependent replies.
   - Cover `expectType<Promise<...>>(redis.command(...))`.
   - Add Buffer variant expectations when the command has one.
   - Add callback typing for nontrivial return types.
   - Use `expectError` only for meaningful invalid signatures.
   - Update `test/typing/transformers.test-d.ts` only when transformer APIs are affected.

7. Consider documentation.
   - Use the repo `docs-sync` skill when command support changes public signatures, return mapping, examples, or documented command behavior.
   - Usually command support is documented through generated declarations and typing tests; update README/docs only when existing prose or examples cover the affected command family or users need version/topology caveats.

8. Validate.
   - Run `node bin/index.js` after generator input changes.
   - Run the focused functional command test when Redis support is available, using the repo's Mocha pattern with `test/helpers/*.ts`.
   - Run `npm run build` when generated declarations, public TypeScript, or generator output changed.
   - If typing tests changed, run `npx tsd --files test/typing/commands.test-d.ts` after building.
   - Use the repo `code-change-verification` skill before handoff to choose any additional validation.
   - If Redis access is blocked by sandboxing, ask for permission to access the local Redis server rather than assuming it is unavailable.

## Completion Report

Report:

- Commands added or updated.
- Metadata/generator inputs changed.
- Generated files changed.
- Functional tests added or updated.
- Typing tests added or updated.
- Documentation decision.
- Validation commands run and results.
- Skipped validation with the concrete reason, including Redis version or local environment limits.
