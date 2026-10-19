import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { platform } from './platform';

function renderApp() {
  return render(
    <I18nProvider i18n={i18n}>
      <App />
    </I18nProvider>,
  );
}

describe('App', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('clears the badge when it opens', () => {
    const setBadgeCount = vi.spyOn(platform, 'setBadgeCount');
    renderApp();
    expect(setBadgeCount).toHaveBeenLastCalledWith(0);
  });

  it('adds 1 to the badge for each Hello, and Reset clears it', async () => {
    const user = userEvent.setup();
    const setBadgeCount = vi.spyOn(platform, 'setBadgeCount');
    renderApp();

    await user.click(screen.getByRole('button', { name: 'Hello' }));
    expect(setBadgeCount).toHaveBeenLastCalledWith(1);
    await user.click(screen.getByRole('button', { name: 'Hello' }));
    expect(setBadgeCount).toHaveBeenLastCalledWith(2);

    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(setBadgeCount).toHaveBeenLastCalledWith(0);
  });
});
