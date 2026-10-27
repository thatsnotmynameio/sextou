---
title: Running StrykerJS 10 with Vitest 5 and TypeScript 7
date: 2026-10-21
category: developer-experience
module: stryker.parent.conf.json, each package's stryker.config.mjs
problem_type: developer_experience
component: testing_framework
severity: high
applies_when:
  - Adding a package's mutation run, or a test, a component or a config to a package Stryker already mutates
  - A Stryker dry run fails, or a package's mutation score drops with no code change that explains it
  - Upgrading @stryker-mutator/core, @stryker-mutator/vitest-runner, Vitest or TypeScript
  - Tempted to add a per-file mutation floor or a script around Stryker's report
retire_when: 'A @stryker-mutator/vitest-runner release past 10.0.0 names tests the Vitest 5 way (issue #54) and a @stryker-mutator/core release reads TypeScript 7 configs (stryker-js#6111): check both upstream issues and the release notes, then run the checks under "Removing a workaround"'
tags:
  [
    stryker,
    mutation-testing,
    vitest,
    typescript-7,
    lingui,
    worker-threads,
    sandbox,
  ]
---

# Running StrykerJS 10 with Vitest 5 and TypeScript 7

## Context

PR #55 added mutation testing with StrykerJS 10.0.0 and `@stryker-mutator/vitest-runner` 10.0.0, installed in each package, over Vitest 5.0.5 and TypeScript 7. Stryker copies one package into a sandbox, rewrites part of it, and runs that package's Vitest suites in worker threads once per mutant. Each of those steps broke something in this repo. Some failed loudly in the dry run. Others failed silently: the run passed and mutants survived that the tests should have killed. AGENTS.md (Tests > Mutation) states the resulting rules. This doc keeps the symptoms, the causes and the checks to run before removing a workaround, which the rules alone don't carry.

## Guidance

1. **A test inside `describe` kills no mutant.** Symptom: no error. The dry run passes, and a package's score drops because the mutants only that test would kill survive. Cause, per stryker-js #6210 and #6263: the 10.0.0 runner builds a test's full name the way Vitest 4 did, so under Vitest 5 it never matches a test nested in a `describe`, and runs that test for no mutant. Fix: tests sit at the top level of their file. `test.each` and helpers replace what `describe` grouped. Issue #54 tracks bringing `describe` back.

2. **`ts.parseConfigFileTextToJson is not a function`.** Stryker crashes before the dry run. Cause (stryker-js#6111): in the sandbox, Stryker rewrites `tsconfig.json` through TypeScript 6's API, which TypeScript 7 removed. Stryker documents no option that turns the rewrite off. Fix: `tsconfigFile` names a file that doesn't exist, so the rewrite has nothing to rewrite (`stryker.parent.conf.json:11-12`). The `_comment` key beside it explains why; Stryker ignores keys ending in `_comment`. The sandbox copy keeps the package's own `tsconfig.json`, which still extends the root one.

3. **The sandbox holds one package, so a relative path out of it breaks.** `apps/web/vite.config.ts` imported Lingui's plugin by a relative path into `packages/ui` (removed by this fix). In the sandbox that path leads nowhere, and the web dry run failed to load its Vite config. Fix: import by package name, `@sextou/ui/lingui-macros` (`apps/web/vite.config.ts:5`), which `packages/ui/package.json:10` exports and pnpm links into the sandbox's `node_modules`. The same applies to any config or test that reaches another package by a relative path: go through the package's name.

4. **`useLingui is not defined`.** The ui dry run fails. Cause: the BlockStatement mutator empties a component's body. Lingui's macro rewrites the `useLingui()` call where it sits in that body, so the mutated file uses `t` with no `useLingui` import left, and the code fails to compile instead of failing a test. Fix: disable BlockStatement on that function, with the reason in the comment. `// Stryker disable next-line BlockStatement` works when the signature fits on one line, so the function's opening brace sits on the next line (`packages/ui/src/Sidebar/Sidebar.tsx:19`). When the parameters span several lines the brace is further down and `next-line` misses it, so a `disable` / `restore` pair brackets the signature (`packages/ui/src/WorkspaceHeader/WorkspaceHeader.tsx:12` and `:21`). A new component that calls `useLingui()` needs the same comment.

5. **A stubbed `HOME` doesn't reach `os.homedir()` under Stryker.** Symptom: `apps/server`'s integration tests pass under `vitest run` but, under Stryker, write to the real `~/.local/share/sextou`. Cause, per this session's investigation: Stryker runs Vitest in worker threads, where `vi.stubEnv` changes the worker's own copy of `process.env` and `os.homedir()` still reads the real home. Fix: mock `homedir` from `node:os` (`apps/server/tests/integration/main.test.ts:22-26`). Also clear `LOCALAPPDATA` (`main.test.ts:98`): on Windows `data-directory.ts:12` uses it before the home directory, so a set `LOCALAPPDATA` sends the test to the developer's real data directory even with `homedir` mocked.

6. **Default concurrency can exhaust a 16 GB machine.** Stryker starts one worker per core minus one (one per core on 4 cores or fewer): 11 on a 12-core laptop, each loading Vitest, jsdom or Turso. A local run ran out of memory and the system killed it. Run locally with `--concurrency 4`, or lower: `pnpm --filter <package> exec stryker run --concurrency 4`. CI keeps the default: its runners have far fewer cores than a laptop.

7. **Stryker has no per-file threshold.** `thresholds.high`, `low` and `break` judge the score of the whole run, which here is one package (`stryker.parent.conf.json:6-10`). An earlier version of PR #55 added a script that read Stryker's JSON report and failed any file under a floor, plus a test that kept the script's config in step with the packages. Both were deleted: they were more code than the configuration they guarded, and Stryker's own project and documentation judge only the total. A mutant that changes no behavior gets a `// Stryker disable` comment with its reason; a weak file shows in the HTML report.

## Why This Matters

Items 1 and 5 fail silently. A `describe` costs a package its score with no message saying why, and the score then looks like weak tests. A worker-thread test that reaches the real data directory passes and leaves files behind on the developer's machine. Items 2 to 4 stop the run, but their messages name TypeScript or Lingui, not Stryker's sandbox, so the cause takes a while to find. Item 7 is the mistake most likely to come back: a per-file floor looks like a natural extension of coverage's `perFile`, and Stryker doesn't offer one.

## When to Apply

- Before writing a test in a package with a `test:mutation` script: no `describe`; mock `homedir` instead of stubbing `HOME`.
- Before adding a component that calls `useLingui()`, or a config that imports from another package.
- When a dry run fails with an error that names TypeScript, Lingui or a missing module.
- On an upgrade of Stryker, Vitest or TypeScript: run the checks below.

## Examples

### Removing a workaround

Each check runs in the package named, at full concurrency only on a machine with the memory for it.

- **`describe` (item 1):** wrap one test that kills mutants, such as one in `packages/tasks`, in a `describe`, and run `pnpm --filter @sextou/tasks test:mutation`. If the score holds, the runner names tests correctly; issue #54 then restores `describe` across the repo.
- **`tsconfigFile` (item 2):** delete the `tsconfigFile` and `tsconfigFile_comment` lines and run `pnpm --filter @sextou/tasks test:mutation`. If the run starts, the rewrite works under TypeScript 7.
- **BlockStatement (item 4):** remove the comment in `Sidebar.tsx` and run `pnpm --filter @sextou/ui exec stryker run --dryRunOnly`. The workaround stays until that dry run compiles.

## Related

- Issue #54: bring back `describe` once Stryker supports Vitest 5.
- stryker-js#6111 (TypeScript 7), #6210 and #6263 (test names under Vitest 5).
- AGENTS.md, Tests > Mutation: the rules this doc explains.
