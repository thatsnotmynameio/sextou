import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { i18n } from '@lingui/core';
import { compileMessage } from '@lingui/message-utils/compileMessage';
import { afterEach } from 'vitest';

// The same English setup as the Storybook preview and the desktop renderer.
i18n.setMessagesCompiler(compileMessage);
i18n.loadAndActivate({ locale: 'en', messages: {} });

afterEach(cleanup);
