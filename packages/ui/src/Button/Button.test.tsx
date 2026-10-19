import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('is a primary button that does not submit forms by default', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('data-variant', 'primary');
  });

  it('takes the secondary variant and calls onClick', async () => {
    const onClick = vi.fn();
    render(
      <Button variant="secondary" onClick={onClick}>
        Cancel
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Cancel' });
    expect(button).toHaveAttribute('data-variant', 'secondary');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
