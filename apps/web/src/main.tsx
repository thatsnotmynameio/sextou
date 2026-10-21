import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { i18n } from '@lingui/core';
import { compileMessage } from '@lingui/message-utils/compileMessage';
import { RouterProvider } from '@tanstack/react-router';
import { createAppRouter } from './router';
import './index.css';

// English is the source language and has no catalog: messages compile from their source text.
i18n.setMessagesCompiler(compileMessage);
i18n.loadAndActivate({ locale: 'en', messages: {} });

const router = createAppRouter({
  serverUrl: SEXTOU_WEB_SERVER_URL,
  requestTimeoutMs: SEXTOU_WEB_REQUEST_TIMEOUT_MS,
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
