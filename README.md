# sextou

A desktop app built with Electron, React and TypeScript, and the server it will talk to.

The desktop app loads the hosted web app by URL, so a web deploy reaches desktop users without a desktop release.

## Layout

| Path                | What it is                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `apps/web`          | `@sextou/web`: the React app, with its own Vite build                                                          |
| `apps/desktop`      | The Electron app (Electron Forge + Vite): `src/main` (main process), `src/preload` (the bridge to the web app) |
| `packages/ui`       | `@sextou/ui`: shared React components and their Storybook                                                      |
| `apps/server`       | `@sextou/server`: the HTTP server, its own process, which exposes the core                                     |
| `packages/core`     | `@sextou/core`: the domain, with no HTTP                                                                       |
| `packages/contract` | `@sextou/contract`: the API's schemas, for the server and the web app                                          |

Each backend package groups its code by feature under `src/modules/<feature>/`. The server imports the core and the contract; the core imports neither.

## Develop

Needs Node 24 (`.node-version`), pnpm and [gitleaks](https://github.com/gitleaks/gitleaks#installing), which the pre-commit hook runs.

```sh
pnpm install
pnpm start            # the web dev server and the desktop app, with hot reload
pnpm storybook        # the components, at http://localhost:6006
pnpm --filter @sextou/server dev # the server, at http://127.0.0.1:4310/health
pnpm lint             # oxlint and oxfmt
pnpm typecheck        # tsc in each package
pnpm build            # the packaged app (apps/desktop/out/), the web app (apps/web/dist/), the static Storybook and the server (apps/server/dist/server.mjs)
pnpm make             # the installers
```

`pnpm package` and `pnpm make` read the deployed web app's URL from `SEXTOU_WEB_URL`, which must be https. Without it, the packaged app opens on its error page.

The server reads its host and port from `SEXTOU_SERVER_HOST` and `SEXTOU_SERVER_PORT`, or from `--host` and `--port`, which win. It listens on `127.0.0.1:4310` by default; port `0` lets the system pick one. The bundle runs with `node apps/server/dist/server.mjs`.
