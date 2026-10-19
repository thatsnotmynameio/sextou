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
pnpm build            # electron-forge package, then storybook build
pnpm start            # the app in development
pnpm storybook        # Storybook at http://localhost:6006
```

`pnpm start` and `pnpm storybook` start long-running processes: leave them to the user.

## Architecture

- `apps/desktop/src/main`: Electron's main process. Bundled by Vite into `.vite/build/main.cjs`.
- `apps/desktop/src/preload`: the preload script, the only bridge between main and the renderer (`contextBridge`).
- `apps/desktop/src/renderer`: the React app the window loads. It talks to Electron only through what the preload exposes.
- `packages/ui` (`@sextou/ui`): shared React components, each in `src/<Name>/` with `<Name>.tsx` and `<Name>.stories.tsx`, exported from `src/index.ts`. It ships sources, not a build: each app's Vite compiles it. Components take data and callbacks as props and never touch Electron, so they render in Storybook and in any app.
- Forge's Vite plugin packages only `.vite/`: everything the app runs must be bundled.

## CI

- `.github/workflows/ci.yml` calls the organization's `typescript.yml` (thatsnotmynameio/github-actions), pinned by SHA with the version as a comment. It installs under the organization's pnpm policy (versions at least a day old, no trust downgrade), checks every tracked `tsconfig.json` with `strict` on, runs oxfmt, oxlint (type-aware, TypeScript 7) and knip, then `pnpm run build`.
- Its settings come from the base commit: `.oxlintrc.json`, `.oxfmtrc.json`, `knip.json`, the root `tsconfig.json` and `pnpm-workspace.yaml`'s exceptions (`allowBuilds`, `trustPolicyExclude`, …) apply once they merge.
- `main` takes changes only through pull requests, merged by squash. No force push.
