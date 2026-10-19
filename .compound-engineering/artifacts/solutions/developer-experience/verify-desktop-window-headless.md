---
title: Verify the desktop window's behavior headless
date: 2026-10-19
category: developer-experience
module: apps/desktop
problem_type: developer_experience
component: testing_framework
severity: medium
applies_when:
  - Changing the window's navigation, new-window or permission handling in apps/desktop/src/main/main.ts
  - Checking a native feature (such as the app badge) in the real desktop window
  - Needing proof for main-process behavior the desktop unit suite excludes
tags: [electron, playwright, headless, desktop, verification, navigation]
---

# Verify the desktop window's behavior headless

## Context

`apps/desktop/src/main/main.ts` imports Electron, so the desktop unit suite leaves it out of coverage (`apps/desktop/vitest.config.mts`). The window's hooks are proven by running the app instead: `will-navigate`, `will-redirect`, `setWindowOpenHandler`, the permission handlers and the DevTools gate. Running it headless takes several steps that aren't obvious from the code. Each one below was hit while hardening the window (issue #9).

## Guidance

1. **Launch the plain Electron binary on `apps/desktop`, never the packaged app in `apps/desktop/out/`.** Use Playwright's `_electron.launch({ executablePath, args: ['--ozone-platform=headless', '<repo>/apps/desktop'] })`. The packaged app sets `FuseV1Options.EnableNodeCliInspectArguments` to `false` (`apps/desktop/forge.config.mts:49`), which blocks the inspector Playwright attaches through. Electron then loads `.vite/build/main.cjs`, the `main` of `apps/desktop/package.json`.
2. **Build main by packaging, with `SEXTOU_WEB_URL` set to the URL under test.** The URL is compiled into `main.cjs` at package time (`apps/desktop/vite.main.config.mts`). `SEXTOU_WEB_URL=https://localhost:8443/ pnpm package` both builds main and refreshes `.vite/build`. A scenario that needs another URL, such as a server redirect, needs another build. Run `pnpm build` (no URL) afterwards, so `.vite/build` doesn't keep the test URL.
3. **Serve `apps/web/dist` over https.** Packaging refuses a set URL that isn't https (`apps/desktop/vite.main.config.mts:17`). Use a throwaway self-signed certificate for `localhost` and a small Node `https` server. Pass `--ignore-certificate-errors` only on that launch. Keep the certificate and the server script out of the repo.
4. **Record external opens instead of opening them.** Before clicking, replace `shell.openExternal` in the main process. `main.ts` reads `shell.openExternal` at call time, so the recorder catches every hand-off:

   ```js
   await app.evaluate(({ shell }) => {
     globalThis.__opened = [];
     shell.openExternal = async (url) => {
       globalThis.__opened.push(url);
     };
   });
   ```

5. **Click through the DOM.** The headless window paints no frames, so don't rely on Playwright's pointer clicks. Create an anchor in the page (`href`, optional `target="_blank"`), call `.click()`, then read the recorder, `page.url()` and `BrowserWindow.getAllWindows().length`.
6. **Expect DevTools to open.** Under the plain binary `app.isPackaged` is false, so the `!app.isPackaged` gate (`apps/desktop/src/main/main.ts:82`) opens DevTools. Skip the `devtools://` window when picking the page. Checking that the packaged app doesn't open DevTools is a manual check.

If `node_modules/electron/dist` is missing, the Electron binary was never downloaded. pnpm runs install scripts only for packages in `pnpm-workspace.yaml`'s `allowBuilds`, and `electron` isn't listed there. Download it with `node node_modules/electron/install.js`.

## Why This Matters

The hooks fail silently. A dropped `will-navigate` handler, a reordered `loadURL`, or a permission handler set after the window opens all leave CI green. The headless run is the only proof the plan accepted for them. Rediscovering the fuse, the build-time URL and the https rule takes most of a session.

The run also confirmed the Electron 44 behavior the hooks rely on:

- `will-navigate` never fires for the app's own `loadURL` calls, so loading the web app and the error page passes untouched.
- A navigation cancelled in `will-redirect` emits no `did-fail-load`. That is why the first-load branch loads the error page itself (`apps/desktop/src/main/main.ts:44-56`).
- `webContents.getURL()` returns `''` until the first page commits, which is how that branch tells a first load from a later one.
- An in-place `mailto:` link fires `will-navigate`, so it reaches the link policy without a permission-handler fallback.

## When to Apply

- Before declaring a change to `main.ts`'s window wiring done.
- When a native feature's behavior in the window is in question and the unit suite can't reach it.

## Examples

The scenarios run for issue #9, with what each one checked:

| Scenario                                                 | Expected                                            |
| -------------------------------------------------------- | --------------------------------------------------- |
| In-place link to another origin                          | one recorded open, window URL unchanged, one window |
| `target="_blank"` link, other origin or same origin      | one recorded open, one window                       |
| `file:` or a custom scheme                               | nothing recorded                                    |
| Same-origin link to a path that redirects off-origin     | nothing recorded, window stays on the page          |
| Build whose URL redirects off-origin                     | the window shows the error page                     |
| Server stopped at launch, then started, then "Try again" | error page, then the app                            |
| `getUserMedia({ video: true })`                          | rejects with `NotAllowedError`                      |
| Hello, Hello, Reset                                      | `app.getBadgeCount()` reads 0, 1, 2, 0              |

## Related

- Issue #9 (window hardening) and its plan, `.compound-engineering/artifacts/plans/2026-10-19-1523-feat-window-hardening-plan.md`.
- `AGENTS.md`, "Desktop security": where each checklist item lives.
