---
title: 'The popover API with CSS anchor positioning'
date: 2026-10-28
input_shape: concept
subject: popover-and-anchor-positioning
---

# The popover API with CSS anchor positioning

**What it is.** An element with the `popover` attribute is hidden until something opens it, and then it renders in the browser's top layer, above everything else, with no `z-index`. A button with `popovertarget="<id>"` opens and closes it with no script. `popover="auto"` closes it on a click outside or on Escape ("light dismiss"), and opening one auto popover closes the others. CSS anchor positioning places it next to the button that opened it: the button names an anchor (`anchor-name: --x`) and the popover names the same one (`position-anchor: --x`). daisyUI's `dropdown` class builds on these two, placing the popover below its anchor and keeping it inside the viewport.

**Why here, and not a dropdown in React state.** `PropertyMenu` and `PropertyInput` would otherwise need state for open and closed, a listener for outside clicks, one for Escape, focus handling, and a z-index that beats the page. The browser already does each of these. The component keeps one job of its own: it closes the popover once a value is chosen (`hidePopover()`), and it resets and selects the field as it opens (`beforetoggle` and `toggle`, which React passes as `onBeforeToggle` and `onToggle`).

**An example from this PR.**

```tsx
const id = useId(); // also the anchor's name: React's ids are valid CSS idents
<button popoverTarget={id} style={{ anchorName: `--${id}` }}>Priority</button>
<ul id={id} popover="auto" className="dropdown menu" style={{ positionAnchor: `--${id}` }}>
  …
</ul>
```

**When not to use it.** Use something else when the content must stay in the page's flow, such as an inline expanding section, or when a browser without anchor positioning must still place it. jsdom implements neither: it hides a closed popover and has no `showPopover` or `hidePopover`. So the unit tests show every popover and stub `hidePopover` (`packages/ui/tests/popover.ts`), and the stories check the real behavior in Chromium.
