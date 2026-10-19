---
title: '@sextou/ui components take data and callbacks as props and never touch Electron'
applies_when:
  - adding or changing a component in packages/ui
  - a component needs data or an action that comes from Electron, the preload or the main process
tags: [ui, electron, storybook]
---

A component in `@sextou/ui` receives everything it shows as props and reports everything the user does through callback props. It never imports `electron`, never reads `window` globals the preload exposes, and never calls IPC. The app that renders it (apps/desktop's renderer, or the web app) fetches the data and wires the callbacks. This keeps every component renderable in Storybook, in jsdom tests and in any app. When a component needs something only Electron has, add a prop for it and let the app pass it in.

Layout reminder, delete once the rule is written: only top-level `.md` files with `title` and `applies_when` are discovered as rules; `README.md` is this pack's description, never a rule; subfolders are storage for the evidence and data a rule points at.
