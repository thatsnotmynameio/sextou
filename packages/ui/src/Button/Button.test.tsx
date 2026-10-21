import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Button } from './Button';

test('Button is a primary button that does not submit forms by default', () => {
  render(<Button>Save</Button>);
  const button = screen.getByRole('button', { name: 'Save' });
  expect(button).toHaveAttribute('type', 'button');
  expect(button).toHaveAttribute('data-variant', 'primary');
});

test('Button takes the secondary variant and calls onClick', async () => {
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
