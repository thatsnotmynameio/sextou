---
title: Composable Framework - Plan
type: feat
date: 2026-10-21
topic: composable-framework
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Composable Framework - Plan

## Goal Capsule

- **Objective:** sextou has a web app and a remote server built on the stack it chose, proven by a health check that crosses every layer of that stack on its read path, so the first real feature builds on a working stack and adds only what reading doesn't need: migrations with its first table, and writes.
- **Means:** Rewrite `apps/web` and `apps/server` from scratch on Vite, TanStack Router, TanStack Query, Hono, tRPC, zod and drizzle on Turso, with health as their only feature, and move `packages/tasks`' input checks to zod.
- **Product authority:** This brainstorm's dialogue of 2026-10-21, in draft PR #56; no issue yet.
- **Open blockers:** None.

---

## Product Contract

### Summary

The web app and the server are rebuilt from nothing on the chosen stack, and the only thing they do is health. A page of the web app, routed by TanStack Router, fetches the server's health through TanStack Query and the tRPC client. The server answers from a tRPC procedure whose output a zod schema validates, after asking its database, a SQLite file opened through Turso and queried through drizzle, whether it answers. Separately, `packages/tasks` validates its operations' inputs with zod instead of its hand-written checks.

### Problem Frame

The current `apps/web` and `apps/server` were built for a server that runs on the user's machine, and neither does real work: the web app shows a counter stand-in, and the server answers one health route. That direction is dropped. The server runs remotely, and the web app talks to the one server whose URL it was built with. Using a server started locally means running or building the web app with that server's URL.

No library for routing, data fetching or a typed client is installed, and the web app has no way to find a server: it has no server URL setting, and its Content Security Policy allows connections only to its own origin. Building the first feature on this base would mean choosing and wiring the stack inside that feature.

A study in an earlier session chose the libraries for each layer. This work assembles them and proves they hold together before any feature depends on them.

### Key Decisions

- **Web and server are rewritten from scratch, with health as their only feature.** (session-settled: user-directed — chosen over a first real feature end to end, a skeleton over the current code and a decisions-only document: the current code is not a reference.) Governs R1, R4.
- **Health crosses every layer, the database included.** (session-settled: user-approved — chosen over leaving the database out and over a server-only check, so each library of the stack is used at least once.) Governs R4, R5, R6.
- **The typed client is tRPC.** (session-settled: user-directed — chosen over oRPC contract-first and over fetch functions validated with zod: in a monorepo the web importing the server router's type is tRPC's standard shape, and tRPC is the most mature of the three.) Governs R3, R7.
- **Validation is zod.** (session-settled: user-directed — chosen over valibot; tRPC reads either through Standard Schema.) Governs R5, R13.
- **The database is SQLite through Turso, for now.** (session-settled: user-directed — chosen over Postgres and over another SQLite driver; sextou will support more than one database engine later.) Governs R2, R6.
- **drizzle is the 1.0 release candidate, not 0.45.4.** Turso's drizzle driver exists only in the 1.0 pre-releases. Governs R2.
- **The server is remote; a local server is one the user starts.** (session-settled: user-directed — replaces the earlier decision that the server runs on the user's machine.) Governs R10, R12.
- **The tRPC router lives in the server, and `packages/contract`, `packages/core` and `packages/data` go away.** (session-settled: user-approved — proposed in the scoping synthesis and accepted.) Governs R7, R8.
- **The web app keeps Lingui, Tailwind and `@sextou/ui`.** (session-settled: user-approved — proposed in the scoping synthesis and accepted; they sit outside the study's table and already serve the web app.) Governs R1.
- **`packages/tasks` takes zod and nothing else from the stack.** (session-settled: user-directed — zod replaces its hand-written checks; drizzle stays out because its Turso driver runs transactions that don't hold the connection, which would let two of the task graph's writes interleave.) Governs R13, R14, R15.

### Requirements

**Stack**

- R1. `apps/web` and `apps/server` are rebuilt on Vite, TanStack Router, TanStack Query, Hono, tRPC, zod and drizzle, with no code carried over from their current versions except the web app's Lingui and Tailwind setup and its use of `@sextou/ui`.
- R2. The versions are those of the earlier study, with drizzle-orm on the 1.0 release candidate: Vite 8.3.5, TanStack Router 1.170.45, TanStack Query 5.104.5, Hono 4.13.13, tRPC 11.19, zod 4.6.7, drizzle-orm 1.0.0-rc.4. drizzle-kit, on the same release candidate, arrives with the first table.
- R3. The server serves its tRPC router through Hono.

**Health, end to end**

- R4. Health is the only procedure the server offers and the only page the web app has.
- R5. The health procedure's output is validated by a zod schema before the server sends it.
- R6. Health reports the server's version and whether its database answers a query made through drizzle on Turso. The server starts and serves health even when its database can't be opened, and health then reports the database as down.
- R7. The web app gets the server's types only by importing the type of the server's router, and no server code reaches the web app's bundle.
- R8. The server holds its router and its database access itself, with no separate contract, domain or data package.
- R9. The health page shows the server's version and its database state, and says so plainly when the server can't be reached or answers with an error.

**Reaching the server**

- R10. The web app reads the server's URL from an environment variable at build time, which in development points at a server running locally.
- R11. The server accepts requests from the web app's origin, and the web app's Content Security Policy allows connections to the server's URL.
- R12. Neither the web app nor the desktop app starts a server.

**Task graph**

- R13. `packages/tasks` validates its operations' inputs with zod schemas, which it exports.
- R14. An input `packages/tasks` rejects is still a refusal with the reason `invalid`, and every other behavior of the task graph is unchanged.
- R15. `packages/tasks` keeps Turso with raw SQL and its own migrations in `PRAGMA user_version`, with no drizzle.

**Project rules**

- R16. AGENTS.md and CONCEPTS.md describe the new web app and server, and drop what they say about the removed packages and the server running on the user's machine.
- R17. Every call that waits on the network or on another process has a timeout, including the web app's requests to the server and the server's database queries.

### Acceptance Examples

- AE1. **Covers R6, R9.** Given the server is up and its database answers, when the health page loads, it shows the server's version and that the database is up.
- AE2. **Covers R6, R9.** Given the server is up but its database doesn't answer, when the health page loads, it shows the server's version and that the database is down.
- AE3. **Covers R9, R17.** Given no server answers at the URL the web app was built with, whether the connection is refused or never answered, when the health page loads, it says the server can't be reached within a few seconds instead of staying blank or loading.
- AE4. **Covers R5.** Given the health procedure returns a value its output schema rejects, the server answers with an error instead of the value.
- AE5. **Covers R13, R14.** Given a task created with priority 7, `packages/tasks` refuses it with the reason `invalid` and writes nothing, as it does today.
- AE6. **Covers R9.** Given the server answers the health request with an error, when the health page loads, it says the server answered with an error and couldn't report its health, distinct from the unreachable message, and shows no version or database state.

### Success Criteria

- `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass, with every source file of the rewritten packages at the 90% coverage AGENTS.md requires in each suite.
- A web app built against a locally started server shows AE1, and shows AE2 when that server is started with a database path it can't open.

### Scope Boundaries

- Authentication and any notion of who is calling the server.
- Deploying the remote server, and its hosting, domain and production URL.
- How a remote server keeps user data private from its operator.
- Every feature beyond health, including any route that reaches the task graph; the server doesn't open the task graph.
- Database engines other than Turso, and any layer for swapping engines.
- drizzle in `packages/tasks`.
- Choosing the server from inside an already-built web app.
- Serving the API as plain REST or OpenAPI for agents and scripts.
- Changes to `apps/desktop` and `packages/ui`.

<!-- ce-section: work-relationships -->

### How This Work Fits Together

This plan covers the rewrite of the web app and the server and the move of `packages/tasks` to zod. This breakdown is the current understanding, not a committed roadmap.

- The move of `packages/tasks` to zod (R13–R15) can proceed independently of the rewrite (R1–R12): the server doesn't open the task graph, and no procedure uses its schemas yet.
- PR #55, beneath this one in the stack, already implements test levels, per-file coverage and StrykerJS mutation checks in every current package. This work deletes `packages/contract`, `packages/core` and `packages/data` with their suites and checks, and the rewritten `apps/web` and `apps/server` meet #55's test levels and checks.
- The first feature that adds a table to the server's database brings migrations: its schema for drizzle-kit and applying the generated migrations on start.
- The first feature that writes to the server's database depends on handling drizzle's Turso transactions, which don't hold the connection (see Dependencies / Assumptions).

### Dependencies / Assumptions

- drizzle 1.0.0-rc.4's Turso driver runs a transaction through Turso's older `transaction()` and ignores the configuration that would make it immediate (`node_modules/drizzle-orm/tursodatabase/session.js:64`), so concurrent statements can interleave into it. Health only reads, so this work isn't affected.
- "More than one database" is read as other database engines later, not more database files now. If it means something else, the Turso decision may need revisiting.
- Turso refuses a second process on the same file, so the remote server runs as one instance on one machine.
- The web app trusts the router's types and doesn't validate responses at runtime, since R7 and R8 keep the schemas in the server. A web build can call a server of another version, so a procedure's input and output stay backward compatible once released.

### Outstanding Questions

**Deferred to Planning**

- The name of the server-URL environment variable, and how the server's own settings (host, port, data directory, database path) are read.
- Whether TanStack Router's routes are file-based or declared in code.
- Where the server's version comes from, and the shape of the server's build output.

### Sources / Research

- tRPC validators, Standard Schema and output validation: https://trpc.io/docs/server/validators
- drizzle with Turso, available only in the 1.0 pre-releases: https://orm.drizzle.team/docs/connect-turso-database
- Version skew is the same for any separately deployed client, and the shared fix is keeping endpoints backward compatible: https://dev.to/hirodeath/sharing-trpc-v11-types-between-nextjs-and-expo-a-real-world-indie-web-ios-setup-3067
- Why `packages/tasks` has no drizzle: `.compound-engineering/artifacts/plans/2026-10-20-1830-feat-sqlite-task-graph-plan.md` (KTD3) and `.compound-engineering/artifacts/plans/2026-10-21-0140-refactor-turso-database-plan.md` (drizzle's Turso transactions).
- Turso's differences from SQLite: `.compound-engineering/artifacts/solutions/best-practices/turso-behaves-differently-from-sqlite.md`
- The web app's current Content Security Policy: `apps/web/content-security-policy.ts`
