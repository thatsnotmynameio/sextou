import type { ReactNode } from 'react';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render } from '@testing-library/react';

// Renders inside the English I18nProvider, as each app does.
export function renderWithI18n(ui: ReactNode) {
  return render(<I18nProvider i18n={i18n}>{ui}</I18nProvider>);
}
