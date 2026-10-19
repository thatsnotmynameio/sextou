# AGENTS.md

Guidance for coding agents working in this repository. Claude Code reads it as `CLAUDE.md`, a symlink to this file.

sextou is a desktop app: Electron, React and TypeScript, in a pnpm monorepo.

## Commands

Run every command from the repository root. Use pnpm, never npm.

```sh
pnpm install
pnpm lint             # oxlint, then oxfmt --check
pnpm lint:fix         # both, fixing what they can
pnpm typecheck        # tsc --noEmit in each package
pnpm test:unit        # unit tests in jsdom, fast, with coverage
pnpm test:integration # every story in Chromium (Playwright), with coverage
pnpm test             # both suites, one after the other
pnpm build            # electron-forge package, then storybook build
pnpm start            # the app in development
pnpm storybook        # Storybook at http://localhost:6006
```

`pnpm start` and `pnpm storybook` start long-running processes: leave them to the user.

## Architecture

- `apps/desktop/src/main`: Electron's main process. Bundled by Vite into `.vite/build/main.cjs`.
- `apps/desktop/src/preload`: the preload script, the only bridge between main and the renderer (`contextBridge`).
- `apps/desktop/src/renderer`: the React app the window loads. It talks to Electron only through what the preload exposes.
- `packages/ui` (`@sextou/ui`): shared React components, each in `src/<Name>/` with `<Name>.tsx`, `<Name>.test.tsx` and `<Name>.stories.tsx`, exported from `src/index.ts`. It ships sources, not a build: each app's Vite compiles it. Components take data and callbacks as props and never touch Electron, so they render in Storybook and in any app.
- Forge's Vite plugin packages only `.vite/`: everything the app runs must be bundled.

## Tests

- Two suites, split by weight. Unit tests (`*.test.tsx`) run in jsdom and check behavior and structure. Integration tests are the stories: each one renders in Chromium and must pass its `play` function, which checks what needs a real browser (layout, focus, truncation).
- Coverage must stay at 90% or more (lines, branches, functions, statements) in every source file, in each suite on its own: each run fails below it.
- In `packages/ui`, `vitest.config.ts` is the unit suite and `vitest.integration.config.ts` the integration suite. The root `vitest.config.ts` points a root `vitest run` at the unit suites.
- CI's `tnmn.io: vitest` job runs `vitest run` at the root, so it runs the unit suite (with its own coverage settings, and no floor until `.github/typescript.yml` sets one). The integration suite needs Playwright's Chromium, which CI doesn't install: run `pnpm test` before opening a pull request. Install Chromium once per machine with `pnpm --filter @sextou/ui exec playwright install chromium`.

## CI

- On pull requests, the organization's ruleset runs `typescript.yml` (thatsnotmynameio/github-actions) as `tnmn.io: typescript`; `.github/workflows/ci.yml` runs it on `main`, pinned by SHA with the version as a comment. It installs under the organization's pnpm policy (versions at least a day old, no trust downgrade), checks every tracked `tsconfig.json` with `strict` on, runs oxfmt, oxlint (type-aware, TypeScript 7) and knip, then `pnpm run build`.
- `.github/workflows/security.yml` runs CodeQL on pull requests (`codeql / javascript-typescript`, `codeql / actions`, required by thatsnotmynameio/admin's `.github/repos/sextou.yml`): keep the job named `codeql`. `security-main.yml` runs grype and zizmor on `main`.
- Its settings come from the base commit: `.oxlintrc.json`, `.oxfmtrc.json`, `knip.json`, the root `tsconfig.json` and `pnpm-workspace.yaml`'s exceptions (`allowBuilds`, `trustPolicyExclude`, …) apply once they merge.
- `main` takes changes only through pull requests, merged by squash. No force push.
