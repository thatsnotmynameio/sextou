# sextou

A desktop app built with Electron, React and TypeScript.

The desktop app loads the hosted web app by URL, so a web deploy reaches desktop users without a desktop release.

## Layout

| Path           | What it is                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| `apps/web`     | `@sextou/web`: the React app, with its own Vite build                                                          |
| `apps/desktop` | The Electron app (Electron Forge + Vite): `src/main` (main process), `src/preload` (the bridge to the web app) |
| `packages/ui`  | `@sextou/ui`: shared React components and their Storybook                                                      |

## Develop

Needs Node 24 (`.node-version`), pnpm and [gitleaks](https://github.com/gitleaks/gitleaks#installing), which the pre-commit hook runs.

```sh
pnpm install
pnpm start            # the web dev server and the desktop app, with hot reload
pnpm storybook        # the components, at http://localhost:6006
pnpm lint             # oxlint and oxfmt
pnpm typecheck        # tsc in each package
pnpm build            # the packaged app (apps/desktop/out/), the web app (apps/web/dist/) and the static Storybook
pnpm make             # the installers
```

`pnpm package` and `pnpm make` read the deployed web app's URL from `SEXTOU_WEB_URL`. Without it, the packaged app opens on its error page.
