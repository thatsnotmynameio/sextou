# sextou

A desktop app built with Electron, React and TypeScript.

## Layout

| Path           | What it is                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop` | The Electron app (Electron Forge + Vite): `src/main` (main process), `src/preload` (the bridge to the renderer), `src/renderer` (the React UI) |
| `packages/ui`  | `@sextou/ui`: shared React components and their Storybook                                                                                      |

## Develop

Needs Node 24 (`.node-version`) and pnpm.

```sh
pnpm install
pnpm start            # the app, with hot reload
pnpm storybook        # the components, at http://localhost:6006
pnpm lint             # oxlint and oxfmt
pnpm typecheck        # tsc in each package
pnpm build            # the packaged app (apps/desktop/out/) and the static Storybook
pnpm make             # the installers
```

## CI

`.github/workflows/ci.yml` runs the organization's TypeScript checks ([thatsnotmynameio/github-actions](https://github.com/thatsnotmynameio/github-actions)) on every pull request and push to `main`. The organization's rulesets add actionlint, zizmor, grype and dependency review. Pull requests merge by squash.
