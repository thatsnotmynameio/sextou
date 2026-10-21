import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { i18n } from '@lingui/core';
import { compileMessage } from '@lingui/message-utils/compileMessage';
import { afterEach } from 'vitest';

// The same English setup as src/main.tsx.
i18n.setMessagesCompiler(compileMessage);
i18n.loadAndActivate({ locale: 'en', messages: {} });

// The router loads each route's code-split chunk on its first render, which
// takes longer than Testing Library's one second when every package's suite
// runs at once (`pnpm -r test:unit`, as the pre-push hook does).
configure({ asyncUtilTimeout: 5000 });

afterEach(cleanup);
