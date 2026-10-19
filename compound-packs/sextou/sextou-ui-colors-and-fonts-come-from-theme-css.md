---
title: 'Colors and fonts come from tokens defined once in theme.css'
applies_when:
  - styling a component in packages/ui
  - a design needs a color or font that is not a token yet
  - adding CSS that @sextou/ui ships to the apps
tags: [ui, tailwind, design-tokens]
---

Every color and font family a component uses is a token in the `@theme` block of `packages/ui/src/theme.css`, used through its Tailwind utility (`bg-sidebar`, `text-muted`, `font-sans`). Never write a color as a literal in a component, neither `bg-[#14110e]` nor a `style` prop. When the design has a new color, add a token named for its role, not its hue, then use it. Sizes and spacing may use Tailwind's scale or arbitrary values. The shared CSS sets no `body` or global element styles: a component that needs a background, text color or font draws them on its own root element, so it looks the same in Storybook and in any app.
