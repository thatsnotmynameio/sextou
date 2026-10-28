import type { Preview } from '@storybook/react-vite';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { compileMessage } from '@lingui/message-utils/compileMessage';
import './storybook.css';

// English is the source language and has no catalog: messages compile from their source text.
i18n.setMessagesCompiler(compileMessage);
i18n.loadAndActivate({ locale: 'en', messages: {} });

// The page's background and colors come from the theme in theme.css, as in the apps.
const preview: Preview = {
  decorators: [
    (Story) => (
      <I18nProvider i18n={i18n}>
        <Story />
      </I18nProvider>
    ),
  ],
  parameters: {
    // axe checks every story; a violation fails the story's test in the component suite.
    a11y: { test: 'error' },
  },
};

export default preview;
