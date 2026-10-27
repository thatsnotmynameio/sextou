---
title: Parallel Vitest runs fail with ENOTEMPTY on the shared module cache
date: 2026-10-21
category: developer-experience
module: each package's vitest*.config.*
problem_type: test_failure
component: testing_framework
symptoms:
  - "pnpm test:unit, or the pre-push hook that runs it, fails in one package with a Startup Error: ENOTEMPTY: directory not empty, rmdir '<repo>/node_modules/.vitest-cache'"
  - The other packages then fail too, as pnpm -r stops the recursive run at the first failure
  - It happens right after a change to pnpm-lock.yaml, and running the same command again passes
root_cause: concurrency
resolution_type: config_change
severity: medium
framework_version: vitest 5.0.5
retire_when: 'A Vitest release past 5.0.5 stops clearing the shared fsModuleCache folder per process, or tolerates a concurrent clear: check the FileSystemModuleCache clearCache and ensureCacheIntegrity code in the release, then run the reproduction below without fsModuleCachePath'
tags: [vitest, cache, enotempty, pnpm, pre-push, race, flaky, fs-module-cache]
---

# Parallel Vitest runs fail with ENOTEMPTY on the shared module cache

## Problem

`pnpm test:unit` runs each package's `test:unit` script through `pnpm -r`, several at once. After any change to `pnpm-lock.yaml`, one of those runs could fail before running a test, and with it the pre-push hook (`.husky/pre-push:24`). A second run passed, so the failure looked like noise rather than a defect.

## Symptoms

- `apps/server test:unit: [Error: ENOTEMPTY: directory not empty, rmdir '.../node_modules/.vitest-cache']`, reported as a Vitest Startup Error, in whichever package lost the race.
- `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`, with every other package listed as `Failed`.
- In a reproduction against Vitest 5.0.5, 2 runs out of 9 failed this way; the rest passed.

## What Didn't Work

- Rerunning. It passes because the first run already rewrote the cache metadata, so the next run has nothing to clear. It hides the race until the next install.
- Reading every red run as this race. Under the same load, two tests timed out on their own (a thousand Turso writes in `packages/tasks`, and a web page test's first render of a code-split route): the run failed with no `ENOTEMPTY` in its log. Tell them apart by grepping the log for `ENOTEMPTY` before blaming the cache.
- A reproduction that edited `_metadata.json` with `s/"lockfileHash":"[^"]*"/…/` changed nothing: Vitest writes the file with a space after the colon (`"lockfileHash": "e07a445e"`), so the pattern has to allow it.

## Solution

Give each package its own module cache, in every Vitest config of the package (unit, integration, component and the Stryker mutation config), so no two processes ever clear the same folder:

```ts
export default defineConfig({
  test: {
    name: 'tasks/unit',
    // This package's own module cache. ...
    fsModuleCachePath: 'node_modules/.vitest-cache',
    // ...
  },
});
```

The path is relative to the config's root, the package's folder, so this is `packages/tasks/node_modules/.vitest-cache`; `node_modules/` is ignored at any depth. See `packages/tasks/vitest.config.ts:43` and the other configs beside it. The root `vitest.config.ts` needs nothing: it is one process, and its projects carry their own paths.

To reproduce, or to check a new config, stale every cache's lockfile hash and run the whole level at once, a few times:

```sh
for meta in node_modules/.vitest-cache/_metadata.json \
            apps/*/node_modules/.vitest-cache/_metadata.json \
            packages/*/node_modules/.vitest-cache/_metadata.json; do
  [ -f "$meta" ] && sed -i 's/"lockfileHash": *"[^"]*"/"lockfileHash": "stale"/' "$meta"
done
pnpm test:unit 2>&1 | grep -c ENOTEMPTY
```

With the per-package paths, 6 runs out of 6 passed with no `ENOTEMPTY`, and each package's folder emptied and refilled on its own (12 entries down to 4, then the real hash written back).

## Why This Works

By default every Vitest process puts its module cache in `node_modules/.vitest-cache` at the workspace root: `searchForWorkspaceRoot` finds the pnpm workspace, so all packages share one folder (`node_modules/vitest/dist/chunks/cli-api.De07GUeT.js:5598`, Vitest 5.0.5). Before running, each process compares the lockfile's hash with the one in that folder's `_metadata.json` and, when they differ, deletes the whole folder with `rm(dir, { recursive: true, force: true })` (`ensureCacheIntegrity` and `clearCache`, `cli-api.De07GUeT.js:5810` and `:5622`). Started together after an install, every package sees the stale hash, and one process's recursive delete runs while another is writing files into the folder: `rmdir` finds it non-empty again.

`fsModuleCachePath` replaces that root folder for the process that sets it, metadata file included, and Vitest resolves a relative value against the config's root (`node_modules/vitest/dist/chunks/index.1TqnEahn.js:9209`). One folder per package means each clear has one writer.

## Prevention

- A new package's Vitest configs set `fsModuleCachePath: 'node_modules/.vitest-cache'` like the others, the mutation config included; a config without it brings the race back the next time the lockfile changes.
- When a parallel test run fails once and passes on retry, grep its log for `ENOTEMPTY` before treating it as a flaky test.

## Related Issues

- `.compound-engineering/artifacts/solutions/developer-experience/stryker-10-with-vitest-5-and-typescript-7.md`: the other Vitest 5 behavior the test setup works around.
- Found and fixed while building the composable framework, in PR #56.
