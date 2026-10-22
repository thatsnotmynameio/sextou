# AGENTS.md

Guidance for coding agents working in this repository. Claude Code reads it as `CLAUDE.md`, a symlink to this file.

sextou is a web app, the Electron desktop app that loads it, and the remote server they talk to: React and TypeScript, in a pnpm monorepo.

Write every report, summary, or handoff to the user through the `ce-noslop` skill. This applies when you are the top-level agent writing to the user, not when you are a subagent reporting to its caller. Do not apply it to code, config, verbatim quotes, or text the user asked to post as written.

After a solved, verified problem, automatically invoke the `ce-compound` skill with `mode:non-interactive` at the completion checkpoint only when the work produced durable project reasoning that is not readily recoverable from the final code, tests, types, comments, or existing documentation, and losing it would plausibly cause recurrence, material risk, or substantial rediscovery. Apply this counterfactual: if the learning document disappeared, would a future engineer reading the final implementation still be likely to repeat the mistake or redo substantial investigation? If not, do not invoke it. Completion, effort, and diff size alone are not enough. Capture at the checkpoint so a qualifying learning can ship in the PR that produced it, and only where the repository treats captured learnings as tracked, committed knowledge.

## Commands

Run every command from the repository root. Use pnpm, never npm.

```sh
pnpm install
pnpm lint             # oxlint, then oxfmt --check
pnpm lint:fix         # both, fixing what they can
pnpm typecheck        # tsc --noEmit in each package
pnpm test:unit        # every unit suite, with coverage
pnpm test:integration # every integration suite, with coverage
pnpm test:component   # packages/ui's stories in Chromium (Playwright), with coverage
pnpm test             # each package's levels in turn: unit, integration, component
pnpm --filter <package> test:<level>   # one level of one package, such as @sextou/tasks test:integration
pnpm --filter <package> test           # every level of one package
pnpm --filter <package> test:mutation  # Stryker over the package's unit and integration suites; fails below 80% of mutants killed
pnpm exec vitest run --project '<pkg>/*' <path> # one module's unit and integration tests, such as 'server/*' modules/health, with no coverage verdict
pnpm build            # electron-forge package, the web app, storybook build, then the server's bundle
pnpm start            # the web dev server and the desktop app, in development
pnpm storybook        # Storybook at http://localhost:6006
pnpm --filter @sextou/server dev # the server from source, at http://127.0.0.1:4310
```

`pnpm start`, `pnpm storybook` and the server's `dev` start long-running processes: leave them to the user. Neither `pnpm start` nor the desktop app starts the server: the web app talks to the one at `SEXTOU_WEB_SERVER_URL`. Each app reads its settings from environment variables with defaults, listed in its `.env.example`; a `.env` beside it changes them in development.

## Architecture

- `apps/web` (`@sextou/web`): the React app, built by its own Vite config into `apps/web/dist`. It talks to the server through the tRPC client, at the URL it was built with (`SEXTOU_WEB_SERVER_URL`), and takes nothing from the server but its router's type. It reaches native features only through web APIs, which Electron maps to native ones in the desktop window, and through what the preload exposes. Lint fails on an `electron` import in `apps/web` or `packages/ui`.
- `apps/desktop/src/main`: Electron's main process. Bundled by Vite into `.vite/build/main.cjs`.
- `apps/desktop/src/preload`: the preload script, the only bridge between main and the web app (`contextBridge`).
- `packages/ui` (`@sextou/ui`): shared React components, each in `src/<Name>/` with `<Name>.tsx` and `<Name>.stories.tsx`, its test in `tests/unit/<Name>/<Name>.test.tsx`, exported from `src/index.ts`. It ships sources, not a build: each app's Vite compiles it. Components take data and callbacks as props and never touch Electron, so they render in Storybook and in any app.
- The desktop loads the hosted web app by URL instead of bundling its build, from `SEXTOU_WEB_URL`, which `vite.main.config.mts` reads: in development from the environment or `apps/desktop/.env`, `apps/web`'s dev server (`http://localhost:5173`) by default; in production the deployed URL, from the environment at package time. When the URL can't load, the window shows the error page in `src/main/error-page.ts`, bundled into `main.cjs`. A web deploy reaches desktop users on their next reload; only shell changes (Electron, preload, native features) need a desktop release.
- Forge's Vite plugin packages only `.vite/`: everything the shell runs (main, preload, the error page) must be bundled.
- The backend is two packages, and dependencies point one way: `@sextou/server` imports nothing from `@sextou/tasks` yet, the web app imports the server's router type, and `@sextou/tasks` imports no other sextou package. CI's knip fails on an import a package doesn't declare.
  - `apps/server` (`@sextou/server`): the HTTP server, its own process, which runs remotely; a local server is one a developer starts. Hono serves its tRPC router at `/trpc`, and CORS lets only the web app's origin (`SEXTOU_SERVER_WEB_ORIGIN`) read the answers. Each procedure's output is checked against its zod schema before it is sent. Its database is a SQLite file, or `:memory:`, through drizzle (`drizzle-orm`, pinned to a release candidate, the only one with a Turso driver) and Turso's async API (`@tursodatabase/database`, pinned, as the task graph's), with no layer for swapping databases. Turso connects on the first query, so the server starts whatever the file's state, and health reports the database down when it can't open it. `src/config.ts` reads every setting from the environment, and `main.ts` creates the database's folder, then listens; it exits with 1 without listening when a variable is invalid. It logs through one Pino logger, `src/logger.ts`, which writes one JSON record per line to stdout at the level `SEXTOU_SERVER_LOG_LEVEL` sets, or readable lines through pino-pretty when `SEXTOU_SERVER_DEV` is `true`; a process that starts the server reads the URL from the record whose `msg` is `listening`. On SIGINT or SIGTERM it stops listening, then closes the database. Turso refuses a second process on the same file, so the server runs as one instance per database. It doesn't open a task graph yet. Vite bundles it into `apps/server/dist/server.mjs`, with every dependency inlined but Turso, a native addon, and Pino with pino-pretty, which load files at run time: the bundle runs with Node and those packages installed, Turso's for its platform. Turso publishes it for Linux x64 and arm64 with glibc, macOS on Apple silicon and Windows x64, so the server doesn't run on an Intel Mac or on musl Linux (Alpine).
  - `packages/tasks` (`@sextou/tasks`): the task graph, written as a library sextou imports: it knows tasks and their `blocked_by` links, never an organization, and imports no sextou package; Turso (`@tursodatabase/database`, pinned) and zod are its runtime dependencies. Each operation checks its input against a zod schema it exports (`src/schemas.ts`), and refuses an input the schema rejects with the reason `invalid`. `openTasks(path, { logger })` opens the SQLite file its caller names in WAL mode, through Turso's async API with raw SQL and no drizzle (the cycle check is a recursive query drizzle's builder can't write), and applies the schema steps in `src/migrations.ts` the file lacks, counted in `PRAGMA user_version`: it rejects, leaving the file unchanged, when the file has more steps than this version ships. Never edit or remove a merged step. Its caller injects the `logger`, any object with Pino's six level methods (the package's `Logger` type), so the package depends on no logging library; nothing in it logs yet. Every operation returns a promise. Every write is one immediate `transactionAsync`, which holds the connection until it commits or rolls back, so another call waits for it; the write keeps each task's count of the blockers that still hold it (open, running or failed) in step, so the ready list reads one partial index (`task_ready`) and the cycle check walks only open tasks. A refusal is a result with a reason; an error from Turso or the file system rejects.
  - Table names, in either database, are plural (`tasks`). A table whose rows exist only for another table's rows starts with that table's name in the singular: `task_links`, `task_status_changes`, `task_executions`.
  - The server and the web app group code by feature, under the same `src/modules/<feature>/` name: Structure, below, draws both trees, and Building a feature lists the steps.
- `.compound-engineering/artifacts/solutions/`: documented solutions to past problems (bugs, best practices, workflow patterns), organized by category with YAML frontmatter (`module`, `tags`, `problem_type`). `ce-compound` creates it with the first one.
- `CONCEPTS.md`: the project's shared domain vocabulary (organization, workspace, task graph, data directory), relevant when orienting to the codebase or discussing domain concepts.

## Structure

```text
apps/server/
  .env.example                 every variable the server reads, with its default
  src/
    main.ts                    reads the config, creates the database, listens, shuts down
    config.ts                  every setting, parsed from the environment main.ts passes
    data-directory.ts          the data directory's default on each platform
    database.ts                drizzle on Turso, and the ping health asks
    logger.ts                  the Pino logger: JSON lines on stdout, readable in dev
    timeout.ts                 withTimeout, for a call that has no timeout of its own
    server.ts                  starts @hono/node-server; resolves once listening
    app.ts                     the Hono app: CORS, then tRPC at /trpc
    trpc.ts                    the tRPC instance and the context every procedure gets
    router.ts                  each module's router under its name; exports type AppRouter
    modules/
      health/
        index.ts               the module's entry point
        health.router.ts       its procedures
        health.schema.ts       their zod schemas
  tests/
    unit/                      mirrors src/: modules/health/health.router.test.ts
    integration/               mirrors src/: database.test.ts, main.test.ts, server.test.ts
apps/web/
  .env.example                 every variable the web app reads, with its default
  vite.config.ts               loads the variables, the router plugin, the CSP
  settings.ts                  parses the variables, with their defaults
  content-security-policy.ts   the CSP plugin, given the server's URL
  src/
    main.tsx                   activates Lingui and mounts the router
    router.tsx                 the router, its context and the providers around it
    trpc.ts                    the tRPC client, its timeout fetch, the QueryClient
    routeTree.gen.ts           generated from src/routes/ by the router plugin, committed
    routes/
      __root.tsx               the layout every page shares
      index.tsx                wires / to the health module
    modules/
      health/
        index.ts               the module's entry point
        health-page.tsx        the page
  tests/
    unit/                      mirrors src/, and settings.test.ts, content-security-policy.test.ts
    integration/               mirrors src/: modules/health/health-page.test.tsx
```

- `apps/server/src/`, at the top: what every feature shares. The process (`main.ts`, `config.ts`, `server.ts`), the HTTP app (`app.ts`, `trpc.ts`, `router.ts`) and the resources procedures reach through the context (`database.ts`, `timeout.ts`). `main.ts`, `config.ts`, `data-directory.ts`, `server.ts`, `database.ts` and `logger.ts` may use Node; the web app's typecheck follows `AppRouter` into `router.ts`, `trpc.ts` and the modules, so nothing they import may need Node's types.
- `apps/server/src/modules/<feature>/`: one feature's procedures and their schemas.
- `apps/web/`, beside `vite.config.ts`: the build's own code, which runs in Node when Vite does and never reaches the bundle.
- `apps/web/src/`, at the top: what every page shares, the client and the router.
- `apps/web/src/routes/`: one file per URL, which only wires the URL to a module. The router plugin generates `src/routeTree.gen.ts` from it whenever Vite runs (dev, build or a test run); commit the file with the route. Lint and the formatter skip it.
- `apps/web/src/modules/<feature>/`: one feature's components.

Other code reaches a module only through its `index.ts`, the shared code at the top of `src/` and the route files included.

## Building a feature

A feature is a module of the server and a module of the web app under the same name, wired together by the router's type. In order:

1. **Schemas.** In the server's `src/modules/<feature>/<feature>.schema.ts`, a zod schema for each procedure's input and output.
2. **Procedures.** In `<feature>.router.ts`, `router({ <procedure>: procedure.input(…).output(…).query(…) })` (or `.mutation(…)`). The server checks the output against its schema before it sends it. A procedure takes what it needs from outside (the database, the version, a clock) from its context, never from `process` or a Node module: what it needs that the context lacks goes into `Context` in `trpc.ts`, and `main.ts` builds it. A procedure logs through `ctx.logger`, never `console`: a child of the server's logger, bound to the request's `requestId` (the `X-Request-Id` it carries, or a new one). Once released, a procedure's input and output stay backward compatible, since a web build may call a server of another version.
3. **Entry point.** `index.ts` exports the router, and whatever another module needs.
4. **Registration.** `src/router.ts` adds the module's router under the feature's name, so the procedure is `<feature>.<procedure>`, at `/trpc/<feature>.<procedure>`.
5. **The web module.** In the web's `src/modules/<feature>/`, the components, which call the procedure through TanStack Query: `useQuery(trpc.<feature>.<procedure>.queryOptions(…))`, or `mutationOptions` for a mutation. The component handles each way the request can end: the data, an error the server sent (a `TRPCClientError` with `data`), no answer from the server (a `TRPCClientError` without `data`: the connection failed, the request timed out, or something else answered) and still pending. Shown text goes through Lingui, colors and fonts come from `theme.css`'s tokens, and `@sextou/ui`'s components take data and callbacks as props.
6. **The route.** A file in the web's `src/routes/` for each URL, `createFileRoute('<path>')({ component })`, whose component passes the client from `Route.useRouteContext()` to the module's component.
7. **Settings.** Each new setting is an environment variable with a default: the server's are `SEXTOU_SERVER_*`, read in `config.ts` with a parse that names the variable on an invalid value; the web's are `SEXTOU_WEB_*`, parsed in `settings.ts` and written into the bundle by `vite.config.ts`'s `define`. List each in its app's `.env.example` with its default, and say there which settings must agree with another app's. Every web variable is public, since the bundle carries it: a secret is read only by the server's `config.ts`, has no default in code, and appears in `.env.example` with an empty value.
8. **Timeouts.** Every call that waits on the network or on another process has a timeout, which is a setting too. The web's requests get the client's (`SEXTOU_WEB_REQUEST_TIMEOUT_MS`), the server's database queries the database's (`SEXTOU_SERVER_DATABASE_TIMEOUT_MS`), and anything else `withTimeout` from `src/timeout.ts`. A timeout on the server stays below the web's request timeout, so the server answers before the web app gives up.
9. **Tables.** The first feature that adds a table to the server's database brings drizzle-kit, on drizzle-orm's release candidate, with the schema and the migrations the server applies on start. A transaction runs through Turso's `transactionAsync` on drizzle's `$client`, never drizzle's `db.transaction()`, which doesn't hold the connection on rc.4 (issue #59, and `.compound-engineering/artifacts/solutions/best-practices/turso-behaves-differently-from-sqlite.md`).
10. **Tests**, at the levels the Tests section defines:
    - A procedure: unit, through `createCallerFactory(<feature>Router)` with a context the test builds.
    - What only HTTP shows (the status, CORS, the error's shape): unit, through `createApp(…).request(…)`.
    - Code that reaches the disk, a listening port or a child process: integration, its file listed in `integrationOnly` with the reason.
    - A page: unit, rendering `createAppRouter({ serverUrl, requestTimeoutMs, history: createMemoryHistory(…) })` in a `RouterProvider`, with `fetch` stubbed (`vi.stubGlobal`) for each way the request can end.
    - A page against the real server: integration, with the server started as a child process, as `tests/integration/modules/health/health-page.test.tsx` does.
11. **Imports.** Lint enforces three rules, in `.ts` and `.tsx` files alike: a module reaches another module only through its `index.ts`, in the server and in the web app; the web app imports from the server only types, written as a whole `import type` statement from `@sextou/server/router` (lint refuses `import { type … }` everywhere, since it can leave a side-effect import behind); and nothing in `apps/web` or `packages/ui` imports `electron`.

## Desktop security

The window runs remote content, so a script injected into the web app, or a compromised deploy, must not get past it. Each item of [Electron's security checklist](https://www.electronjs.org/docs/latest/tutorial/security), and where it stands:

- **Secure content only:** packaging fails when `SEXTOU_WEB_URL` is set and isn't https (`vite.main.config.mts`). Development loads `SEXTOU_WEB_URL`, `http://localhost:5173` by default.
- **No Node integration, context isolation, sandbox:** stated in the window's `webPreferences` (`src/main/main.ts`), though they are Electron's defaults.
- **Permission handler:** `setPermissionRequestHandler` and `setPermissionCheckHandler` deny every permission on the default session, without a prompt. A feature that needs one allows only that one.
- **`webSecurity`, `allowRunningInsecureContent`, experimental features, `enableBlinkFeatures`:** left at Electron's safe defaults; never set them.
- **Content Security Policy:** a meta tag that `apps/web/content-security-policy.ts` adds to the built page, so browsers get it too. The page connects only to its own origin and to the server's (`SEXTOU_WEB_SERVER_URL`). Not in development, where the dev server needs inline scripts and styles. A meta tag can't set `frame-ancestors`; that waits for the hosting headers.
- **Navigation and new windows:** `src/main/link-policy.ts` decides every URL, applied by `will-navigate`, `will-redirect` and `setWindowOpenHandler`. The window stays on the web app's origin, links to other sites open in the default browser, and the app never opens a second window.
- **`shell.openExternal`:** it gets only `http`, `https` and `mailto` URLs, through the link policy. Other schemes, which would launch local files or other apps, open nothing.
- **`<webview>` (`allowpopups`, verifying its options):** the tag is off by default and unused.
- **Current Electron:** a standing practice. Upgrade Electron when a release lands.
- **IPC sender validation:** there is no IPC yet. Validate the sender in the first handler that lands.
- **`file://`:** unused; the window loads the web app by URL and the error page as a `data:` URL.
- **Fuses:** set in `forge.config.mts`.
- **Electron APIs exposed to web content:** the preload exposes nothing. Expose only narrow functions through `contextBridge`, never Electron modules.

## Tests

Tests are organized by package, then by level. Each package has only the levels its code needs, and each pair of package and level runs on its own.

**Where they live.** Out of `src/`, in the package's `tests/<level>/`, which mirrors `src/`: the unit test of `src/modules/health/health.router.ts` is `tests/unit/modules/health/health.router.test.ts`, the integration test of `src/database.ts` is `tests/integration/database.test.ts`. The folder names the level, so every test ends in `.test.ts(x)`. The web's tests of its build modules, beside `vite.config.ts`, sit at the top of `tests/unit/`. A helper that tests share sits at the top of `tests/` (`packages/ui`'s `render.tsx`). The stories stay beside their component in `src/`, since Storybook shows them too.

**Levels.** Decide a new test's level by what it reaches:

- **unit** (`tests/unit/`): one unit of a package through its public API, in one process, touching neither the disk nor the network. Real in-memory collaborators are fine, an in-memory SQLite database (`':memory:'`) included. Runs in Node, or in jsdom for `apps/web` and `packages/ui`.
- **integration** (`tests/integration/`): real parts working together: the package with a real resource (a file on disk, a server listening on localhost, a child process), or two or more sextou packages used for real, whether the test imports the other package or the code under test does.
- **component** (the stories, `*.stories.tsx`): a UI component rendered in a real browser, Chromium through Playwright; each story must pass its `play` function, which checks what needs a real browser (layout, focus, truncation). Only `packages/ui` has one.
- **e2e**: a flow the way a person uses sextou, the web app in a browser or the desktop window talking to a real server process, acting only through the interface and replacing no part with a test double. None exists yet; the first one must meet this.

Every package has a unit suite, an integration suite wherever its code reaches a real resource or another sextou package, and a component suite only where it has UI to render. Today `apps/server`, `apps/web` and `packages/tasks` have an integration suite, and `packages/ui` a component suite. `apps/web`'s integration suite renders the health page against the server started as a child process, and answers for no file: its unit suite already reaches each one at the floor.

**Suites.** Each suite is its own Vitest config, because Vitest reads coverage only from the config at the root of a run: `vitest.config.ts` is the unit suite, beside `vitest.integration.config.ts` and, in `packages/ui`, `vitest.component.config.ts` (`.mts` in `apps/desktop` and `apps/server`). Each Vitest project is named `<pkg>/<level>` (`tasks/unit`, `ui/component`). The root `vitest.config.ts` runs every unit and integration suite, never the component suite, and sets no coverage.

**Coverage.** Each suite must reach 90% (lines, branches, functions, statements) in every source file it answers for, on its own: each `test:<level>` run fails below it. A package's unit config lists, in `integrationOnly`, the files its integration suite answers for; the unit suite answers for every other file, so a new file belongs to it until it is listed. Some files have no unit test on purpose, each with a comment beside the `integrationOnly` list saying why:

- `packages/tasks`'s `open-tasks.ts` and `apps/server`'s `database.ts` take `':memory:'` or a path, and neither kind of case alone reaches the floor, so their in-memory cases sit in the integration test beside the cases on a file, with the same comment at the top of that test.
- `packages/tasks`'s `owner-only.ts` sets the modes of files on disk.
- `apps/server`'s `server.ts` listens on a port, and its `main.ts` creates folders on disk and opens the database.

The desktop suite covers the main process's pure modules in Node; `main.ts` imports Electron and stays out of it. The web's suites cover `src/` and the build's own modules beside `vite.config.ts`, and leave out `src/main.tsx`, which only mounts what the tests render, and the generated `src/routeTree.gen.ts`.

**Running part of it.** `pnpm --filter <package> test:<level>` runs one level of one package and `pnpm test:<level>` that level everywhere. To run one module, filter by its path through the root config: `pnpm exec vitest run --project 'server/*' modules/health`. It reports the tests and never fails on coverage, which only the full run of a level judges; a path passed to `test:<level>` fails on every file it leaves out. A component filter runs inside `packages/ui` with `pnpm exec vitest run --config vitest.component.config.ts <path>`. Install Chromium once per machine with `pnpm --filter @sextou/ui exec playwright install chromium`.

**Mutation.** StrykerJS changes the code one mutant at a time and runs the package's unit and integration suites against each. `stryker.parent.conf.json` at the root holds what every package shares, and each package's `stryker.config.mjs` adds only its own: the Vitest config it runs (`vitest.mutation.config.ts` gathers both suites where a package has two) and the files it leaves out. Stryker fails the run when the package's score is below 80% (`thresholds.break`); it has no threshold per file. A mutant that changes no behavior gets `// Stryker disable next-line <mutator>: <reason>`, never a lower floor. Code excluded from coverage is excluded from `mutate` too. Three things to know:

- Tests sit at the top level of their file, with no `describe`. Stryker 10.0.0's Vitest runner names a test inside a `describe` the way Vitest 4 did, so under Vitest 5 that test runs for no mutant and every mutant only it would kill survives (issue #54 brings `describe` back once a release fixes it). The file groups its tests; `test.each` runs one test over several values, `test.skipIf` skips one on a platform, and a helper the test calls sets up what only some tests need.
- Stryker runs the tests in worker threads, where `os.homedir()` ignores a changed `HOME`: mock `homedir` from `node:os` instead, as `apps/server`'s `tests/integration/main.test.ts` does.
- `stryker.parent.conf.json` names a `tsconfigFile` that doesn't exist: Stryker rewrites `tsconfig.json` in its sandbox through TypeScript 6's API, which TypeScript 7 lacks (stryker-js#6111).

**Writing tests.** For people and agents alike:

- Before writing tests, read the source file, its tests under `tests/` and the package's Vitest configs, and follow their conventions.
- Test the contract: inputs, return values, side effects and errors, through the public API. A test that breaks when the internals change but the result stays the same tests implementation.
- One behavior per test, with a name that states its subject and the behavior (`openTasks refuses a file a newer version migrated`); an "and" in the name means two tests.
- Arrange, act, assert.
- Every assertion checks a real result. A test that only checks that nothing throws, that something is defined, or what a mock received does not count: Stryker reports the mutants it lets through as survived.
- Cover the boundaries, the error paths and every side of each condition: empty input, `null` and `undefined`, limits, failed requests, empty lists. If a real caller can trigger it, test it.
- Prefer real implementations when they are fast and reliable. Mock only what is slow, flaky or has side effects the test can't control, never the thing under test. Use fake timers for time.
- Each test sets up its own state and passes in any order; mocks are restored after each test.
- Use Vitest's APIs (`vi.fn`, `vi.mock`), with the typed form `vi.mock(import('./module'))`.
- A bug fix starts with a failing test that reproduces the bug, so the fix changes the code, not the test.
- Run tests with `vitest run`, never in watch mode, and read the coverage and mutation results before finishing.
- Property-based tests are an option for functions with wide input ranges.

## Git hooks

`pnpm install` sets up husky's hooks, in `.husky/`. Never skip or disable them: no `--no-verify`, no `HUSKY=0`. When a hook fails, fix what it reports.

- `pre-commit`: gitleaks scans the staged changes for secrets, then lint-staged runs `oxlint --fix` and `oxfmt` on the staged files and stages their fixes. Install gitleaks once per machine.
- `commit-msg`: the subject must be a Conventional Commit, `type(scope): description`.
- `pre-push`: every pushed branch must contain the remote's latest `main` (rebase onto it otherwise), then `pnpm typecheck` and `pnpm test:unit` run.
- `post-merge`: runs `pnpm install` when a pull changes `pnpm-lock.yaml`.

## CI

- On pull requests, the organization's ruleset runs `typescript.yml` (thatsnotmynameio/github-actions) as `tnmn.io: typescript`; `.github/workflows/ci.yml` runs it on `main`, pinned by SHA with the version as a comment. It installs under the organization's pnpm policy (versions at least a day old, no trust downgrade), checks every tracked `tsconfig.json` with `strict` on, runs oxfmt, oxlint (type-aware, TypeScript 7) and knip, then `pnpm run build`.
- `.github/workflows/tests.yml` runs on pull requests and on `main`: one check per pair of package and level (`tasks / unit`, `ui / component`), each judging its files at 90%, and one per package for mutation (`tasks / mutation`), failing below 80% of the package's mutants killed. Only `ui / component` installs Chromium. None is required in the ruleset yet. Mutation runs every mutant on each push to `main` and, on a pull request, only what changed since the newest result in the Actions cache, the pull request's own or else `main`'s; Dependabot's pull requests always start from `main`'s. A dependency's change doesn't rerun a package's mutants on the pull request, only after the merge, so a mutation check that turns red on `main` turns that package red on every pull request until the next one fixes it. The organization's `typescript.yml` still runs the unit and integration suites through the root config, so they run twice per pull request until this moves there.
- `.github/workflows/lint.yml` runs on pull requests and on `main`: `lint / gates` runs oxlint with `.oxlintrc.gates.json`, 38 rules that most large open-source TypeScript and React projects enforce, each at `error`, and fails on any finding. One of them, `eslint/no-console`, refuses `console` everywhere but test files (`*.test.ts`, `*.test.tsx`): code logs through a logger. The organization's `typescript.yml` doesn't read that file. Not required in the ruleset yet. To run it locally: `pnpm exec oxlint -c .oxlintrc.gates.json .`.
- `.github/workflows/security.yml` runs CodeQL on pull requests (`codeql / javascript-typescript`, `codeql / actions`, required by thatsnotmynameio/admin's `.github/repos/sextou.yml`): keep the job named `codeql`. `security-main.yml` runs grype and zizmor on `main`.
- Its settings come from the base commit: `.oxlintrc.json`, `.oxfmtrc.json`, `knip.json`, the root `tsconfig.json` and `pnpm-workspace.yaml`'s exceptions (`allowBuilds`, `trustPolicyExclude`, …) apply once they merge.
- `main` takes changes only through pull requests, merged by squash. No force push.
