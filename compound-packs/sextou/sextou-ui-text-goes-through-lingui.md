---
title: 'Text a component shows on its own goes through Lingui; text it receives comes translated'
applies_when:
  - adding or changing a component in packages/ui that shows text or has an accessible label
  - rendering a @sextou/ui component from a story or an app
tags: [ui, i18n, lingui]
---

A component's own strings (accessible labels, button text, placeholders) go through `const { t } = useLingui()` from `@lingui/react/macro`, as in ``aria-label={t`Main navigation`}``. Never import the global `t` from `@lingui/core/macro`: it is not reactive and misses locale changes. Content text (names, labels, titles, counts) comes in through props as already translated strings or nodes, and whoever renders the component translates it, as the stories do with `<Trans>`. Don't add an English default to a prop to skip translation. The app or Storybook mounts the single `I18nProvider`; a component never mounts its own.
