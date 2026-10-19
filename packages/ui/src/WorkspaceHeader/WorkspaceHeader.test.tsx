import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithI18n } from '../test/render';
import { WorkspaceHeader } from './WorkspaceHeader';

function setup() {
  const callbacks = {
    onSwitchWorkspace: vi.fn(),
    onSearch: vi.fn(),
    onNewIssue: vi.fn(),
  };
  renderWithI18n(<WorkspaceHeader name="Tatu" initial="T" {...callbacks} />);
  return callbacks;
}

describe('WorkspaceHeader', () => {
  it('shows the workspace badge and name, and three labeled buttons', () => {
    setup();
    expect(screen.getByText('T')).toBeInTheDocument();
    expect(screen.getByText('Tatu')).toBeInTheDocument();
    for (const name of ['Switch workspace', 'Search', 'New issue']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute(
        'type',
        'button',
      );
    }
  });

  it('reports each click to its callback', async () => {
    const { onSwitchWorkspace, onSearch, onNewIssue } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.click(screen.getByRole('button', { name: 'New issue' }));
    await userEvent.click(screen.getByText('Tatu'));
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onNewIssue).toHaveBeenCalledTimes(1);
    expect(onSwitchWorkspace).toHaveBeenCalledTimes(1);
  });
});
