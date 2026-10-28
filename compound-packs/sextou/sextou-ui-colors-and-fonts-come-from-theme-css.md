---
title: 'Colors come from the daisyUI theme and fonts from theme.css'
applies_when:
  - styling a component in packages/ui
  - a design needs a color or font that is not a token yet
  - adding CSS that @sextou/ui ships to the apps
tags: [ui, tailwind, daisyui, design-tokens]
---

`packages/ui/src/theme.css` is the one stylesheet an app imports: it brings Tailwind, daisyUI with its built-in `dim` as the only theme, and the font tokens (`font-sans`, Source Sans 3; `font-mono`, JetBrains Mono). A component takes every color from daisyUI's semantic names (`bg-base-100`, `text-base-content/70`, `border-base-300`, `btn-primary`), never a literal, neither `bg-[#14110e]` nor a `style` prop, and never Tailwind's palette (`bg-zinc-800`). A color the theme lacks means a theme of our own: copy `dim`'s values into a `@plugin "daisyui/theme"` block and add it there under its semantic name, so no component changes. Sizes and spacing may use Tailwind's scale or arbitrary values. theme.css sets no element styles of its own; daisyUI paints the root in `base-100`, so a component looks the same in Storybook and in any app.
