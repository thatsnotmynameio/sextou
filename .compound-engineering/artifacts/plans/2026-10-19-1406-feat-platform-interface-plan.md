---
title: Platform Interface Between the Web App and Electron - Plan
type: feat
date: 2026-10-19
topic: platform-interface
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Platform Interface Between the Web App and Electron - Plan

## Goal Capsule

- **Objective:** The web app shows its unread count as the app badge, in the desktop app and in browsers that offer one, with no error anywhere. The web app and the shared UI can't import Electron.
- **Means:** One platform module in the web app, backed by the Badging API, which Electron 44 routes to the native badge (KTD1).
- **Product authority:** Issue #8, narrowed by the Key Decisions below. #6 (delivered in #7) has the desktop load the hosted web app by URL.
- **Stop conditions:** Stop and ask if `app.getBadgeCount()` stays unchanged after the clicks in the headless desktop check of the Verification Contract (see Risks): the fix would be the preload route this plan dropped.
- **Execution profile:** Lightweight, inline, one PR on `issue-8-platform`.
- **Open blockers:** None.

---

## Product Contract

Product Contract preservation: changed: R2, R9, AE2 and AE3 rewritten; R3, R4, R5 and AE3's original case moved to Scope Boundaries. Electron 44 routes `navigator.setAppBadge` to the native badge, so the badge needs no preload (user-directed, see Key Decisions).

### Summary

The web app gets a platform module, its one way to reach native features. The unread badge goes through it, driven by a counter on the placeholder Hello button, and uses the Badging API in the desktop app and in browsers alike. A lint rule stops `apps/web` and `packages/ui` from importing `electron`.

### Problem Frame

The web app has no single place for native features, and nothing stops it from importing `electron`. With `nodeLinker: hoisted`, `electron` sits in the root `node_modules`, so the import resolves and type-checks under `apps/web` and would only fail at runtime in a browser.

### Requirements

**Interface**

- R1. The web app reaches native features only through its platform module, never through Electron or preload globals directly.
- R2. The platform module's badge works the same way in the desktop app and in a browser, through the Badging API.

**Import guard**

- R6. Code under `apps/web` and `packages/ui` fails `pnpm lint` if it imports `electron` or `electron/*`, including type-only and dynamic imports.
- R7. `@sextou/ui` components stay unaware of the platform: the web app wires the platform module to them through props and callbacks. (pack: sextou, sextou-ui-components-never-touch-electron.md)

**Unread badge**

- R8. Each click on the Hello button adds 1 to the unread count, and a second button sets it back to 0.
- R9. In the desktop app, the count shows as the app's native badge, and 0 clears it.
- R10. In a browser, the count goes to the Badging API when the browser offers it, and does nothing otherwise, with no error.
- R11. The counter and both buttons live in the placeholder `App`, to be replaced when a real inbox exists.

### Acceptance Examples

- AE1. **Covers R2, R10.** **Given** the web app open in a browser tab, **when** the user clicks Hello three times, **then** no error appears in the console, and the badge reads 3 only if the browser offers the Badging API.
- AE2. **Covers R2, R9.** **Given** the web app inside the desktop app, **when** the user clicks Hello twice and then the reset button, **then** the app's badge count reads 2 and then 0.
- AE3. **Covers R10.** **Given** a browser where the Badging API exists but rejects the call (an uninstalled tab, no permission), **when** the user clicks Hello, **then** nothing errors.

### Key Decisions

- **The badge uses the Badging API everywhere, and the preload stays empty in #8.** Electron 44 routes `navigator.setAppBadge` to the same native call as `app.setBadgeCount`, so a preload route would duplicate it. Governs R2, R9. (session-settled: user-directed — chosen over sending the badge through the preload to `app.setBadgeCount`: redundant with what Electron already does)
- **The Hello button drives the count.** There is no unread data yet, and the counter is easy to test and easy to delete. Governs R8, R11. (session-settled: user-approved — chosen over rendering the Sidebar with sample data: that would add UI work to #8)
- **In the browser, use the Badging API or nothing.** Governs R10. (session-settled: user-approved — chosen over also prefixing the tab title with the count, and over no browser badge at all)
- **No Windows taskbar overlay.** Electron 44 documents the badge for macOS and for Linux docks that support the LauncherEntry D-Bus API. Governs R9. (session-settled: user-approved — chosen over drawing a Windows overlay icon: more work, and it can't be tested here)

### Scope Boundaries

**Deferred to Follow-Up Work**

- The preload API through `contextBridge`, the Electron implementation of the platform module, and detecting which features the running desktop app offers. They come with the first feature only the desktop can do (formerly R3, R4, R5).

**Non-goals**

- Window hardening (DevTools in production, `webPreferences`, navigation, CSP) belongs to #9.
- Exporting `@sextou/ui`'s Tailwind and Lingui setup belongs to #10.
- Other native features (notifications, deep links, window controls).
- Windows taskbar overlay badge.
- A real unread count from an inbox.
- Checking which page sets the badge. Electron lets any page in the window set it; a foreign page could only change a number, and #9 keeps the window on the app's origin.

### Dependencies / Assumptions

- On the user's Linux desktop (Hyprland) the badge does not show, so verification reads it back through Electron's `app.getBadgeCount()` in a headless run.
- On macOS, the badge needs a code-signed app with notification permission (Electron issue #22715), so it is checked by hand on a Mac, outside this PR.

### Sources / Research

- Issue #8 (scope and done-when), #9 and #10 (neighboring scope).
- Electron PR #27067 (`navigator.setAppBadge` routed to the native badge) and #52895 (Linux badge through LauncherEntry, in 44.0.0).
- `node_modules/electron/electron.d.ts` (44.9.0), `app.setBadgeCount`: `@platform linux,darwin`.
- `pnpm-workspace.yaml` (`nodeLinker: hoisted`), `.oxlintrc.json` (no import rules).

---

## Planning Contract

### Key Technical Decisions

- KTD1. **A plain module, `apps/web/src/platform.ts`, typed by a `Platform` interface with one implementation.** It feature-detects with `'setAppBadge' in navigator` (TypeScript's DOM lib declares the method as always present, so a truthiness check reads as always true), calls `clearAppBadge` for 0, and swallows the returned promise's rejection. Governs R1, R2, R10.
- KTD2. **R6 is enforced by oxlint, not by tsconfig.** With hoisted `node_modules`, `import 'electron'` type-checks under `apps/web`. The rule is `no-restricted-imports` at `error` (at `warn`, oxlint exits 0) in an `overrides` block of the root `.oxlintrc.json` for `apps/web/**` and `packages/ui/**`, with `paths` for `electron` and `patterns` for `electron/*`. CI reads `.oxlintrc.json` from the base commit, so CI enforces it only after merge; locally `pnpm lint` and the pre-commit hook enforce it at once.
- KTD3. **`desktopName` in `apps/desktop/package.json` matches the `.desktop` file the deb and rpm makers install.** Electron derives the LauncherEntry target from `productName` (`sextou.desktop`), while the makers name the file from the package name (`sextou-desktop.desktop`). Without the match, Linux docks ignore the badge. Governs R9.
- KTD4. **`apps/web` gets a jsdom unit suite that copies `packages/ui/vitest.config.ts`.** It merges over `vite.config.ts` so Lingui macros compile, includes `src/**/*.test.{ts,tsx}` (and excludes them from coverage), has a setup file that activates English and runs `cleanup`, and keeps the 90% per-file coverage thresholds. `src/main.tsx` is excluded from coverage, as `packages/ui` excludes its `index.ts`: it only mounts the app. The root `vitest.config.ts` lists `apps/web` in `projects`, so CI runs it.
- KTD5. **`App` calls the platform module from an effect on the count**, so the first render clears any badge left from an earlier session.

### Risks

- Electron skips its own `navigator.setAppBadge` tests on Linux. If the headless check shows `app.getBadgeCount()` unchanged after clicks, the Badging API route doesn't reach the native badge on Linux, and the stop condition applies.

---

## Implementation Units

### U1. Block `electron` imports in the web app and the shared UI

- **Goal:** `pnpm lint` fails when code under `apps/web` or `packages/ui` imports `electron`.
- **Requirements:** R6.
- **Dependencies:** None.
- **Files:** `.oxlintrc.json`.
- **Approach:** Add the `overrides` block per KTD2. The message names the platform module as the way to native features.
- **Test expectation:** none -- lint config. Verified by a throwaway import, below.
- **Verification:** A temporary `import { app } from 'electron'` in `apps/web/src` and an `import type` from `electron/renderer` in `packages/ui/src` each make `pnpm lint` exit non-zero. The same import in `apps/desktop/src` does not. `pnpm lint` passes on the clean tree.

### U2. Platform module and the web app's unit suite

- **Goal:** The web app has `platform.setBadgeCount(count)` and a test suite that CI runs.
- **Requirements:** R1, R2, R10; KTD1, KTD4.
- **Dependencies:** None.
- **Files:**
  - `apps/web/src/platform.ts` (new)
  - `apps/web/src/platform.test.ts` (new)
  - `apps/web/vitest.config.ts` (new)
  - `apps/web/vitest.setup.ts` (new)
  - `apps/web/package.json`: `test` and `test:unit` scripts, plus vitest, jsdom, `@vitest/coverage-v8`, Testing Library and jest-dom as devDependencies, at the versions `packages/ui` uses
  - `apps/web/tsconfig.json`: include the root-level vitest files if needed
  - `vitest.config.ts`: add `apps/web` to `projects`
  - `pnpm-lock.yaml`
- **Approach:** Per KTD1. `Platform` is the interface `App` depends on; the exported `platform` is its browser implementation.
- **Patterns to follow:** `packages/ui/vitest.config.ts`, `packages/ui/vitest.setup.ts`, the `test:unit` script in `packages/ui/package.json`.
- **Test scenarios:**
  - Covers AE1. With `navigator.setAppBadge` defined, `setBadgeCount(3)` calls it with 3.
  - With the API defined, `setBadgeCount(0)` calls `clearAppBadge` and not `setAppBadge`.
  - With the API absent from `navigator`, `setBadgeCount(2)` returns without throwing.
  - Covers AE3. When `setAppBadge` returns a rejected promise, the call produces no unhandled rejection.
- **Verification:** `pnpm test:unit` runs the new suite at 90% per file, and a root `vitest run` includes it.

### U3. Unread counter on the placeholder App

- **Goal:** Hello adds 1 to the badge and a reset button clears it.
- **Requirements:** R8, R11, R7; KTD5.
- **Dependencies:** U2.
- **Files:** `apps/web/src/App.tsx`, `apps/web/src/App.test.tsx` (new).
- **Approach:**
  1. Keep the count in `App` state. Hello increments it, and a second `Button` from `@sextou/ui` resets it.
  2. An effect sends the count to `platform.setBadgeCount` (KTD5).
  3. Both button labels go through `<Trans>`. (pack: sextou, sextou-ui-text-goes-through-lingui.md)
  4. Replace the `console.log` on Hello.
- **Test scenarios:**
  - On first render, the platform module receives 0.
  - Covers AE2. Clicking Hello twice sends 1, then 2, and clicking reset sends 0.
  - The Hello and reset buttons render with their English labels.
- **Verification:** The App tests pass with the platform module mocked, and the page in Chromium shows both buttons with no console errors.

### U4. Match the Linux desktop entry name

- **Goal:** Packaged Linux builds send the badge to the `.desktop` file the installers create.
- **Requirements:** R9; KTD3.
- **Dependencies:** None.
- **Files:** `apps/desktop/package.json`.
- **Approach:** Set `desktopName` to the file name the deb and rpm makers produce.
- **Test expectation:** none -- packaging metadata. No dock here can show the badge.
- **Verification:** The name matches what `electron-installer-debian` derives from the package name (its `sanitizename` helper).

### U5. Document the platform module and the web suite

- **Goal:** AGENTS.md says where native features go and that `apps/web` has a unit suite.
- **Requirements:** R1, R6.
- **Dependencies:** U1, U2.
- **Files:** `AGENTS.md`.
- **Approach:**
  1. In Architecture, the `apps/web` bullet names `src/platform.ts` as the only route to native features, and says lint blocks `electron` imports in `apps/web` and `packages/ui`.
  2. In Tests, say that `apps/web` has a unit suite and that the root `vitest.config.ts` lists both packages.
- **Test expectation:** none -- documentation.
- **Verification:** The text matches the code after U1 to U4.

---

## Verification Contract

| Check                                                                               | Proves                                                      |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm lint` (plus U1's throwaway imports)                                           | R6                                                          |
| `pnpm typecheck`                                                                    | Types across all packages                                   |
| `pnpm test`                                                                         | U2 and U3 scenarios; coverage at 90% per file in each suite |
| `pnpm build`                                                                        | Desktop package, web build and Storybook still build        |
| Web build in headless Chromium: click Hello three times and reset                   | AE1, no console errors                                      |
| Headless desktop check: read `app.getBadgeCount()` after two clicks and after reset | AE2 on Linux; expect 2, then 0                              |

The headless desktop check only proves anything when it runs this way:

- Serve the web build on `localhost`. The Badging API needs a secure context, so a LAN address hides it and the count stays 0 for the wrong reason.
- Build the desktop main with `SEXTOU_WEB_URL` set to that URL. Without it, a production build loads the error page.
- Launch `apps/desktop` with a plain Electron binary through Playwright's `_electron`, not the packaged app in `out/`. Its fuses block the inspector Playwright needs.

`pnpm start` stays with the user, per AGENTS.md.

---

## Definition of Done

- U1 to U5 are done, and every check in the Verification Contract passes, or a failure is reported with its output.
- The headless desktop check reads 2 and then 0. If it doesn't, the stop condition applies.
- No leftover throwaway imports, probes or abandoned code in the diff.
- The diff names no product outside this project.
