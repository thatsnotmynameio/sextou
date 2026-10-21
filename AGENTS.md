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
pnpm test:unit        # every unit suite, with coverage
pnpm test:integration # every integration suite, with coverage
pnpm test:component   # packages/ui's stories in Chromium (Playwright), with coverage
pnpm test             # each package's levels in turn: unit, integration, component
pnpm --filter <package> test:<level>   # one level of one package, such as @sextou/tasks test:integration
pnpm --filter <package> test           # every level of one package
pnpm --filter <package> test:mutation  # Stryker over the package's unit and integration suites; fails below 80% of mutants killed
pnpm exec vitest run --project '<pkg>/*' <path> # one module's unit and integration tests, such as 'server/*' apps/server/src/modules/health, with no coverage verdict
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
  - `apps/server` (`@sextou/server`): the HTTP server (Hono on Node), its own process, the same on the user's machine and on a remote one. It holds no business rules: a route validates its input against the contract, calls the core and answers in the contract's shape. `src/main.ts`, `config.ts` (host and port from `SEXTOU_SERVER_HOST`/`SEXTOU_SERVER_PORT` or `--host`/`--port`, `127.0.0.1:4310` by default; the data directory from `SEXTOU_SERVER_DATA_DIR` or `--data-dir`, `sextou` in the user's data directory by default, from `data-directory.ts`; the database path from `SEXTOU_SERVER_DATABASE` or `--database`, `sextou.db` in the data directory by default; the default organization's task graph, always `default.tasks.db` in the data directory), `app.ts` and `server.ts` sit at the top of `src/`. `main.ts` opens the database, then the task graph, then listens; it exits with 1 without listening when either fails to open, as a second server on the same data directory does: Turso refuses a second process that opens a file. On SIGINT or SIGTERM it stops listening, closes the task graph and closes the database. No route reaches the task graph yet. Vite bundles it into `apps/server/dist/server.mjs`, with every dependency inlined but Turso, a native addon: the bundle runs with Node and Turso's installed package for its platform. Turso publishes it for Linux x64 and arm64 with glibc, macOS on Apple silicon and Windows x64, so the server doesn't run on an Intel Mac or on musl Linux (Alpine).
  - `packages/core` (`@sextou/core`): the domain, with no HTTP. It reads no clock or process state the server can pass in.
  - `packages/contract` (`@sextou/contract`): the API's request and response schemas (zod) and their types. The web app's bundle may import it, so it uses no Node or DOM globals.
  - `packages/data` (`@sextou/data`): sextou's database, a SQLite file in WAL mode opened through Turso's async API (`@tursodatabase/database`, pinned, as the task graph's) and drizzle (`drizzle-orm` and `drizzle-kit`, both pinned to the same release candidate), with no layer for swapping databases. `openDatabase(path)` takes the path from the server, reads no environment, and applies the migrations the database doesn't have yet, in one transaction: it rejects, leaving the database as it was, when one fails or when the database records a migration this server doesn't ship (a newer sextou wrote it).
    - Tables are declared in `src/schema.ts`. After changing it, run `pnpm --filter @sextou/data migration --name <change>`: drizzle-kit generates `migration/<time>_<change>/migration.sql`, and the script renders every migration into `src/migration.gen.ts`, which the server and its bundle import. Commit both. After editing a generated `migration.sql` before it merges, run the command without `--name` to render it again. An integration test fails when the schema has a change with no migration, and another when `src/migration.gen.ts` doesn't match `migration/`.
    - Never rename, delete or edit a merged migration folder. Its name is its id: a database that records an id the server doesn't ship stops the server, and an edit never runs on a database that already applied the migration.
    - Migrations run in one transaction on a connection with foreign keys on. Turso, unlike SQLite, applies `PRAGMA foreign_keys` inside that transaction, so the `PRAGMA foreign_keys=OFF` and `=ON` drizzle-kit puts around a table rebuild take effect: dropping a table that other tables reference leaves their rows alone, and nothing checks that those rows still find their parent, since Turso 0.8.3's `PRAGMA foreign_key_check` reports nothing. Before a migration that rebuilds a referenced table, make the runner in `src/migration.ts` look for those orphaned rows before it commits and fail on any.
  - `packages/tasks` (`@sextou/tasks`): the task graph, written as a library sextou imports: it knows tasks and their `blocked_by` links, never an organization, and imports no sextou package; Turso (`@tursodatabase/database`, pinned) is its one runtime dependency. `openTasks(path)` opens the SQLite file its caller names in WAL mode, through Turso's async API with raw SQL and no drizzle (the cycle check is a recursive query drizzle's builder can't write), and applies the schema steps in `src/migrations.ts` the file lacks, counted in `PRAGMA user_version`: it rejects, leaving the file unchanged, when the file has more steps than this version ships. Never edit or remove a merged step. Every operation returns a promise. Every write is one immediate `transactionAsync`, which holds the connection until it commits or rolls back, so another call waits for it; the write keeps each task's count of the blockers that still hold it (open, running or failed) in step, so the ready list reads one partial index (`task_ready`) and the cycle check walks only open tasks. A refusal is a result with a reason; an error from Turso or the file system rejects.
  - Table names, in either database, are plural (`tasks`). A table whose rows exist only for another table's rows starts with that table's name in the singular: `task_links`, `task_status_changes`, `task_executions`.
  - The server, the core and the contract group code by feature, under the same `src/modules/<feature>/` name: `health.schema.ts` in the contract, `health.service.ts` in the core, `health.routes.ts` in the server, each test beside its file. Code shared across features sits at the top of the package's `src/`. A feature reaches another feature only through that feature's `index.ts`, created when another feature first needs it; lint fails on any other import from one feature into another.
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

Tests are organized by package, then by level. Each package has only the levels its code needs, and each pair of package and level runs on its own.

**Levels.** Decide a new test's level by what it reaches:

- **unit** (`*.test.ts(x)`): one unit of a package through its public API, in one process, touching neither the disk nor the network. Real in-memory collaborators are fine, an in-memory SQLite database (`':memory:'`) included. Runs in Node, or in jsdom for `apps/web` and `packages/ui`.
- **integration** (`*.integration.test.ts`): real parts working together: the package with a real resource (a file on disk, a server listening on localhost, a child process), or two or more sextou packages used for real, whether the test imports the other package or the code under test does.
- **component** (the stories, `*.stories.tsx`): a UI component rendered in a real browser, Chromium through Playwright; each story must pass its `play` function, which checks what needs a real browser (layout, focus, truncation). Only `packages/ui` has one.
- **e2e**: a flow the way a person uses sextou, the web app in a browser or the desktop window talking to a real server process, acting only through the interface and replacing no part with a test double. None exists yet; the first one must meet this.

Every package has a unit suite, an integration suite wherever its code reaches a real resource or another sextou package, and a component suite only where it has UI to render. Today `apps/server`, `packages/data` and `packages/tasks` have an integration suite, and `packages/ui` a component suite. `apps/web`'s `App.test.tsx` renders `@sextou/ui` for real and still sits in the unit suite: the one exception, until the web app has real work.

**Suites.** Each suite is its own Vitest config, because Vitest reads coverage only from the config at the root of a run: `vitest.config.ts` is the unit suite, beside `vitest.integration.config.ts` and, in `packages/ui`, `vitest.component.config.ts` (`.mts` in `apps/desktop` and `apps/server`). Each Vitest project is named `<pkg>/<level>` (`tasks/unit`, `ui/component`). The root `vitest.config.ts` runs every unit and integration suite, never the component suite, and sets no coverage.

**Coverage.** Each suite must reach 90% (lines, branches, functions, statements) in every source file it answers for, on its own: each `test:<level>` run fails below it. A package's unit config lists, in `integrationOnly`, the files its integration suite answers for; the unit suite answers for every other file, so a new file belongs to it until it is listed. Some files have no unit test on purpose, each with a comment beside the `integrationOnly` list saying why:

- `packages/tasks`'s `open-tasks.ts` and `packages/data`'s `database.ts` take `':memory:'` or a path, and neither kind of case alone reaches the floor, so their in-memory cases sit in the integration test beside the cases on a file, with the same comment at the top of that test.
- `packages/tasks`'s `owner-only.ts` sets the modes of files on disk, and `packages/data`'s `migration-files.ts` reads the migration folder from disk.
- `apps/server`'s unit suite answers only for `config.ts` and `data-directory.ts`: the app, the routes, the server and `main` each reach another sextou package, the disk or a listening server.

The desktop suite covers the main process's pure modules in Node; `main.ts` imports Electron and stays out of it.

**Running part of it.** `pnpm --filter <package> test:<level>` runs one level of one package and `pnpm test:<level>` that level everywhere. To run one module, filter by its path through the root config: `pnpm exec vitest run --project 'server/*' apps/server/src/modules/health`. It reports the tests and never fails on coverage, which only the full run of a level judges; a path passed to `test:<level>` fails on every file it leaves out. A component filter runs inside `packages/ui` with `pnpm exec vitest run --config vitest.component.config.ts <path>`. Install Chromium once per machine with `pnpm --filter @sextou/ui exec playwright install chromium`.

**Mutation.** StrykerJS changes the code one mutant at a time and runs the package's unit and integration suites against each. `stryker.parent.conf.json` at the root holds what every package shares, and each package's `stryker.config.mjs` adds only its own: the Vitest config it runs (`vitest.mutation.config.ts` gathers both suites where a package has two) and the files it leaves out. Stryker fails the run when the package's score is below 80% (`thresholds.break`); it has no threshold per file. A mutant that changes no behavior gets `// Stryker disable next-line <mutator>: <reason>`, never a lower floor. Code excluded from coverage is excluded from `mutate` too. Three things to know:

- Tests sit at the top level of their file, with no `describe`. Stryker 10.0.0's Vitest runner names a test inside a `describe` the way Vitest 4 did, so under Vitest 5 that test runs for no mutant and every mutant only it would kill survives (issue #54 brings `describe` back once a release fixes it). The file groups its tests; `test.each` runs one test over several values, `test.skipIf` skips one on a platform, and a helper the test calls sets up what only some tests need.
- Stryker runs the tests in worker threads, where `os.homedir()` ignores a changed `HOME`: mock `homedir` from `node:os` instead, as `main.integration.test.ts` does.
- `stryker.parent.conf.json` names a `tsconfigFile` that doesn't exist: Stryker rewrites `tsconfig.json` in its sandbox through TypeScript 6's API, which TypeScript 7 lacks (stryker-js#6111).

**Writing tests.** For people and agents alike:

- Before writing tests, read the source file, the tests beside it and the package's Vitest configs, and follow their conventions.
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
- `.github/workflows/security.yml` runs CodeQL on pull requests (`codeql / javascript-typescript`, `codeql / actions`, required by thatsnotmynameio/admin's `.github/repos/sextou.yml`): keep the job named `codeql`. `security-main.yml` runs grype and zizmor on `main`.
- Its settings come from the base commit: `.oxlintrc.json`, `.oxfmtrc.json`, `knip.json`, the root `tsconfig.json` and `pnpm-workspace.yaml`'s exceptions (`allowBuilds`, `trustPolicyExclude`, …) apply once they merge.
- `main` takes changes only through pull requests, merged by squash. No force push.
