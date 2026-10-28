---
title: 'Colors come from the daisyUI theme and fonts from theme.css'
applies_when:
  - styling a component in packages/ui
  - a design needs a color or font that is not a token yet
  - adding CSS that @sextou/ui ships to the apps
tags: [ui, tailwind, daisyui, design-tokens]
---

`packages/ui/src/theme.css` is the one stylesheet an app imports: it brings Tailwind, daisyUI with its built-in `business` as the only theme, two colors of its own, and the font tokens (`font-sans`, Source Sans 3; `font-mono`, JetBrains Mono). The theme changed on 2026-10-28: it was `dim`, and `business` replaced it, so a note, story or screenshot that names `dim` predates the change. A component takes every color from daisyUI's semantic names (`bg-base-100`, `bg-base-200`, `btn-primary`, `text-error`) or from theme.css's own two, `line` for borders (`border-line`) and `muted` for secondary text (`text-muted`), never a literal, neither `bg-[#14110e]` nor a `style` prop, and never Tailwind's palette (`bg-zinc-800`). `line` and `muted` replace `border-base-300`, which is darker than the page, and `text-base-content/70`, which dims text unevenly. A color the theme lacks is mixed from the theme's own colors in theme.css's `@theme inline` block, as `line` and `muted` are, so it follows the theme and no component changes. That also changed on 2026-10-28: the earlier route, copying `dim`'s values into a `@plugin "daisyui/theme"` block, no longer applies. Sizes and spacing may use Tailwind's scale or arbitrary values. theme.css sets no element styles of its own; daisyUI paints the root in `base-100`, so a component looks the same in Storybook and in any app.
