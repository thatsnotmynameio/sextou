# AGENTS.md

Guidance for coding agents working in this repository. Claude Code reads it as `CLAUDE.md`, a symlink to this file.

sextou is a web app, the Electron desktop app that loads it, and the server they will talk to: React and TypeScript, in a pnpm monorepo.

Write every report, summary, or handoff to the user through the `ce-noslop` skill. This applies when you are the top-level agent writing to the user, not when you are a subagent reporting to its caller. Do not apply it to code, config, verbatim quotes, or text the user asked to post as written.

After a solved, verified problem, automatically invoke the `ce-compound` skill with `mode:non-interactive` at the completion checkpoint only when the work produced durable project reasoning that is not readily recoverable from the final code, tests, types, comments, or existing documentation, and losing it would plausibly cause recurrence, material risk, or substantial rediscovery. Apply this counterfactual: if the learning document disappeared, would a future engineer reading the final implementation still be likely to repeat the mistake or redo substantial investigation? If not, do not invoke it. Completion, effort, and diff size alone are not enough. Capture at the checkpoint so a qualifying learning can ship in the PR that produced it, and only where the repository treats captured learnings as tracked, committed knowledge.

## Commands

Run every command from the repository root. Use pnpm, never npm.

```sh
pnpm install
pnpm lint             # oxlint, then oxfmt --check
pnpm lint:fix         # both, fixing what they can
pnpm typecheck        # tsc --noEmit in each package
pnpm test:unit        # unit tests in jsdom (Node for the server's packages), fast, with coverage
pnpm test:integration # every story in Chromium (Playwright), with coverage
pnpm test             # both suites, one after the other
pnpm build            # electron-forge package, the web app, storybook build, then the server's bundle
pnpm start            # the web dev server and the desktop app, in development
pnpm storybook        # Storybook at http://localhost:6006
pnpm --filter @sextou/server dev # the server from source, at http://127.0.0.1:4310
pnpm --filter @sextou/data migration --name <change> # a migration from src/schema.ts, then src/migration.gen.ts
```

`pnpm start`, `pnpm storybook` and the server's `dev` start long-running processes: leave them to the user.

## Architecture

- `apps/web` (`@sextou/web`): the React app, built by its own Vite config into `apps/web/dist`. It reaches native features (the app badge) only through `src/platform.ts`. That module uses web APIs, which Electron maps to native ones in the desktop window; anything Electron doesn't map goes through what the preload exposes. Lint fails on an `electron` import in `apps/web` or `packages/ui`.
- `apps/desktop/src/main`: Electron's main process. Bundled by Vite into `.vite/build/main.cjs`.
- `apps/desktop/src/preload`: the preload script, the only bridge between main and the web app (`contextBridge`).
- `packages/ui` (`@sextou/ui`): shared React components, each in `src/<Name>/` with `<Name>.tsx`, `<Name>.test.tsx` and `<Name>.stories.tsx`, exported from `src/index.ts`. It ships sources, not a build: each app's Vite compiles it. Components take data and callbacks as props and never touch Electron, so they render in Storybook and in any app.
- The desktop loads the hosted web app by URL instead of bundling its build: `apps/web`'s dev server (port 5173) in development, the deployed URL in production, which `vite.main.config.mts` reads from `SEXTOU_WEB_URL` at package time. When the URL can't load, the window shows the error page in `src/main/error-page.ts`, bundled into `main.cjs`. A web deploy reaches desktop users on their next reload; only shell changes (Electron, preload, native features) need a desktop release.
- Forge's Vite plugin packages only `.vite/`: everything the shell runs (main, preload, the error page) must be bundled.
- The backend is five packages. Dependencies point one way: `@sextou/server` imports `@sextou/core`, `@sextou/contract`, `@sextou/data` and `@sextou/tasks`, the web app may import `@sextou/contract`, and none of `@sextou/core`, `@sextou/data` and `@sextou/tasks` imports another sextou package. CI's knip fails on an import a package doesn't declare, so `@sextou/core`, which declares no dependencies, can't reach an HTTP framework, the database or another sextou package.
  - `apps/server` (`@sextou/server`): the HTTP server (Hono on Node), its own process, the same on the user's machine and on a remote one. It holds no business rules: a route validates its input against the contract, calls the core and answers in the contract's shape. `src/main.ts`, `config.ts` (host and port from `SEXTOU_SERVER_HOST`/`SEXTOU_SERVER_PORT` or `--host`/`--port`, `127.0.0.1:4310` by default; the data directory from `SEXTOU_SERVER_DATA_DIR` or `--data-dir`, `sextou` in the user's data directory by default, from `data-directory.ts`; the database path from `SEXTOU_SERVER_DATABASE` or `--database`, `sextou.db` in the data directory by default; the default organization's task graph, always `default.tasks.db` in the data directory), `app.ts` and `server.ts` sit at the top of `src/`. `main.ts` opens the database, then the task graph, then listens; it exits with 1 without listening when either fails to open. On SIGINT or SIGTERM it stops listening, closes the task graph and closes the database. No route reaches the task graph yet. Vite bundles it into `apps/server/dist/server.mjs`, which needs only Node.
  - `packages/core` (`@sextou/core`): the domain, with no HTTP. It reads no clock or process state the server can pass in.
  - `packages/contract` (`@sextou/contract`): the API's request and response schemas (zod) and their types. The web app's bundle may import it, so it uses no Node or DOM globals.
  - `packages/data` (`@sextou/data`): sextou's database, SQLite through Node's `node:sqlite` and drizzle (`drizzle-orm` and `drizzle-kit`, both pinned to the same release candidate), with no layer for swapping databases. `openDatabase(path)` takes the path from the server, reads no environment, and applies the migrations the database doesn't have yet, in one transaction: it throws, leaving the database as it was, when one fails or when the database records a migration this server doesn't ship (a newer sextou wrote it).
    - Tables are declared in `src/schema.ts`. After changing it, run `pnpm --filter @sextou/data migration --name <change>`: drizzle-kit generates `migration/<time>_<change>/migration.sql`, and the script renders every migration into `src/migration.gen.ts`, which the server and its bundle import. Commit both. After editing a generated `migration.sql` before it merges, run the command without `--name` to render it again. A unit test fails when the schema has a change with no migration, and another when `src/migration.gen.ts` doesn't match `migration/`.
    - Never rename, delete or edit a merged migration folder. Its name is its id: a database that records an id the server doesn't ship stops the server, and an edit never runs on a database that already applied the migration.
    - Migrations run with foreign keys on, inside a transaction where `PRAGMA foreign_keys` does nothing. When drizzle-kit rebuilds a table that other tables reference, dropping the old table acts on their rows: `ON DELETE CASCADE` deletes them, `SET NULL` and `SET DEFAULT` overwrite their reference, and `NO ACTION` or `RESTRICT` with any row fails the migration, which stops the server. Before such a migration, add foreign-key handling to the runner in `src/migration.ts`.
  - `packages/tasks` (`@sextou/tasks`): the task graph, written as a library sextou imports: it knows tasks and their `blocked_by` links, never an organization, and imports no sextou package and no runtime dependency. `openTasks(path)` opens the SQLite file its caller names, through `node:sqlite` with raw SQL and no drizzle (the cycle check is a recursive query drizzle's builder can't write), and applies the schema steps in `src/migrations.ts` the file lacks, counted in `PRAGMA user_version`: it throws, leaving the file unchanged, when the file has more steps than this version ships. Never edit or remove a merged step. Every write is one `BEGIN IMMEDIATE` transaction that keeps each task's count of the blockers that still hold it (open, running or failed) in step, so the ready list reads one partial index (`task_ready`) and the cycle check walks only open tasks. A refusal is a result with a reason; an error from SQLite or the file system is thrown.
  - The server, the core and the contract group code by feature, under the same `src/modules/<feature>/` name: `health.schema.ts` in the contract, `health.service.ts` in the core, `health.routes.ts` in the server, each test beside its file. Code shared across features sits at the top of the package's `src/`.
- `.compound-engineering/artifacts/solutions/`: documented solutions to past problems (bugs, best practices, workflow patterns), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). `ce-compound` creates it with the first one.
- `CONCEPTS.md`: the project's shared domain vocabulary (organization, workspace, task graph, data directory), relevant when orienting to the codebase or discussing domain concepts.

## Desktop security

The window runs remote content, so a script injected into the web app, or a compromised deploy, must not get past it. Each item of [Electron's security checklist](https://www.electronjs.org/docs/latest/tutorial/security), and where it stands:

- **Secure content only:** packaging fails when `SEXTOU_WEB_URL` is set and isn't https (`vite.main.config.mts`). Development loads `http://localhost:5173`.
- **No Node integration, context isolation, sandbox:** stated in the window's `webPreferences` (`src/main/main.ts`), though they are Electron's defaults.
- **Permission handler:** `setPermissionRequestHandler` and `setPermissionCheckHandler` deny every permission on the default session, without a prompt. A feature that needs one allows only that one.
- **`webSecurity`, `allowRunningInsecureContent`, experimental features, `enableBlinkFeatures`:** left at Electron's safe defaults; never set them.
- **Content Security Policy:** a meta tag that `apps/web/content-security-policy.ts` adds to the built page, so browsers get it too. Not in development, where the dev server needs inline scripts and styles. A meta tag can't set `frame-ancestors`; that waits for the hosting headers.
- **Navigation and new windows:** `src/main/link-policy.ts` decides every URL, applied by `will-navigate`, `will-redirect` and `setWindowOpenHandler`. The window stays on the web app's origin, links to other sites open in the default browser, and the app never opens a second window.
- **`shell.openExternal`:** it gets only `http`, `https` and `mailto` URLs, through the link policy. Other schemes, which would launch local files or other apps, open nothing.
- **`<webview>` (`allowpopups`, verifying its options):** the tag is off by default and unused.
- **Current Electron:** a standing practice. Upgrade Electron when a release lands.
- **IPC sender validation:** there is no IPC yet. Validate the sender in the first handler that lands.
- **`file://`:** unused; the window loads the web app by URL and the error page as a `data:` URL.
- **Fuses:** set in `forge.config.mts`.
- **Electron APIs exposed to web content:** the preload exposes nothing. Expose only narrow functions through `contextBridge`, never Electron modules.

## Tests

- Two suites, split by weight. Unit tests (`*.test.ts(x)`) run in jsdom, or in Node for the server's packages, and check behavior and structure. Integration tests are the stories: each one renders in Chromium and must pass its `play` function, which checks what needs a real browser (layout, focus, truncation).
- Coverage must stay at 90% or more (lines, branches, functions, statements) in every source file, in each suite on its own: each run fails below it.
- In `packages/ui`, `vitest.config.ts` is the unit suite and `vitest.integration.config.ts` the integration suite. `apps/web`, `apps/desktop`, `apps/server`, `packages/core`, `packages/contract`, `packages/data` and `packages/tasks` have a unit suite only, in their `vitest.config.ts` (`.mts` in `apps/desktop` and `apps/server`), each with its own project name. The desktop suite covers the main process's pure modules in Node; `main.ts` imports Electron and stays out of it. The root `vitest.config.ts` points a root `vitest run` at every unit suite.
- CI's `tnmn.io: vitest` job runs `vitest run` at the root, so it runs the unit suite (with its own coverage settings, and no floor until `.github/typescript.yml` sets one). The integration suite needs Playwright's Chromium, which CI doesn't install: run `pnpm test` before opening a pull request. Install Chromium once per machine with `pnpm --filter @sextou/ui exec playwright install chromium`.

## Git hooks

`pnpm install` sets up husky's hooks, in `.husky/`. Never skip or disable them: no `--no-verify`, no `HUSKY=0`. When a hook fails, fix what it reports.

- `pre-commit`: gitleaks scans the staged changes for secrets, then lint-staged runs `oxlint --fix` and `oxfmt` on the staged files and stages their fixes. Install gitleaks once per machine.
- `commit-msg`: the subject must be a Conventional Commit, `type(scope): description`.
- `pre-push`: every pushed branch must contain the remote's latest `main` (rebase onto it otherwise), then `pnpm typecheck` and `pnpm test:unit` run.
- `post-merge`: runs `pnpm install` when a pull changes `pnpm-lock.yaml`.

## CI

- On pull requests, the organization's ruleset runs `typescript.yml` (thatsnotmynameio/github-actions) as `tnmn.io: typescript`; `.github/workflows/ci.yml` runs it on `main`, pinned by SHA with the version as a comment. It installs under the organization's pnpm policy (versions at least a day old, no trust downgrade), checks every tracked `tsconfig.json` with `strict` on, runs oxfmt, oxlint (type-aware, TypeScript 7) and knip, then `pnpm run build`.
- `.github/workflows/security.yml` runs CodeQL on pull requests (`codeql / javascript-typescript`, `codeql / actions`, required by thatsnotmynameio/admin's `.github/repos/sextou.yml`): keep the job named `codeql`. `security-main.yml` runs grype and zizmor on `main`.
- Its settings come from the base commit: `.oxlintrc.json`, `.oxfmtrc.json`, `knip.json`, the root `tsconfig.json` and `pnpm-workspace.yaml`'s exceptions (`allowBuilds`, `trustPolicyExclude`, …) apply once they merge.
- `main` takes changes only through pull requests, merged by squash. No force push.
