# sextou

A web app, the Electron desktop app that loads it, and the server they talk to, built with React and TypeScript.

The desktop app loads the hosted web app by URL, so a web deploy reaches desktop users without a desktop release. The server runs remotely; the web app talks to the server whose URL it was built with.

## Layout

| Path             | What it is                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `apps/web`       | `@sextou/web`: the React app, with its own Vite build                                                          |
| `apps/desktop`   | The Electron app (Electron Forge + Vite): `src/main` (main process), `src/preload` (the bridge to the web app) |
| `apps/server`    | `@sextou/server`: the HTTP server (Hono and tRPC), with its database (drizzle on Turso) and its tasks database |
| `packages/ui`    | `@sextou/ui`: shared React components and their Storybook                                                      |
| `packages/tasks` | `@sextou/tasks`: the task graph, in a SQLite file whose path its caller passes                                 |

The server and the web app group their code by feature under `src/modules/<feature>/`; AGENTS.md draws both trees and the steps that build a feature. The web app takes only the type of the server's router, never its code.

## Develop

Needs Node 24 (`.node-version`), pnpm, git and [gitleaks](https://github.com/gitleaks/gitleaks#installing), which the pre-commit hook runs.

```sh
pnpm install
pnpm --filter @sextou/server dev # the server, at http://127.0.0.1:4310
pnpm start            # the web dev server and the desktop app, with hot reload
pnpm storybook        # the components, at http://localhost:6006
pnpm lint             # oxlint and oxfmt
pnpm typecheck        # tsc in each package
pnpm build            # the packaged app (apps/desktop/out/), the web app (apps/web/dist/), the static Storybook and the server (apps/server/dist/server.mjs)
pnpm make             # the installers
```

Every setting is an environment variable with a default. Each app's `.env.example` lists its variables, with their defaults and the ones that must agree across apps; copy it to `.env` beside it to change one in development. Neither the web app nor the desktop app starts a server: start it yourself, and point the web app at it with `SEXTOU_WEB_SERVER_URL`.

The web app reads `SEXTOU_WEB_SERVER_URL` and `SEXTOU_WEB_REQUEST_TIMEOUT_MS` when it is built or served and writes them into the bundle, so everything in `apps/web/.env` is public. Its one page shows the server's version and whether the server's database answers, and says when the server can't be reached or answered with an error.

`pnpm package` and `pnpm make` read the deployed web app's URL from `SEXTOU_WEB_URL` in the environment, which must be https. Without it, the packaged app opens on its error page. In development, the desktop app loads `SEXTOU_WEB_URL` from the environment or `apps/desktop/.env`, and `http://localhost:5173` by default.

The server listens on `SEXTOU_SERVER_HOST` and `SEXTOU_SERVER_PORT`, `127.0.0.1:4310` by default; port `0` lets the system pick one. Its database is `SEXTOU_SERVER_DATABASE`, or `sextou.db` in its data folder: `SEXTOU_SERVER_DATA_DIR`, by default `sextou` in the user's data directory (`$XDG_DATA_HOME` or `~/.local/share` on Linux, `~/Library/Application Support` on macOS, `%LOCALAPPDATA%` on Windows). Its tasks database is `SEXTOU_SERVER_TASKS_DB`, or `tasks.db` in the same folder. `:memory:` opens either one so it lasts until the server stops. The server creates the folder and the files when they are missing, and starts even when it can't open them: `health.check`, at `/trpc/health.check`, then reports the database down, and a tasks database that doesn't open prints why. An invalid variable stops it with 1 before it listens. The bundle runs with `node apps/server/dist/server.mjs`, with Node and Turso's installed package for its platform: Linux x64 and arm64 with glibc, macOS on Apple silicon, Windows x64.
