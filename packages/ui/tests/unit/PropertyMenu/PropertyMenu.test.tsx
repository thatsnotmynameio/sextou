import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CircleAlert, SignalHigh, SignalMedium } from 'lucide-react';
import { expect, test, vi } from 'vitest';
import { popoverOf, stubPopovers } from '../../popover';
import { renderWithI18n } from '../../render';
import {
  PropertyMenu,
  type PropertyMenuProps,
} from '../../../src/PropertyMenu/PropertyMenu';

stubPopovers();

const props: PropertyMenuProps<number> = {
  name: 'Priority',
  icon: SignalMedium,
  options: [
    { value: 0, label: 'P0 · Critical', icon: CircleAlert },
    { value: 1, label: 'P1 · Urgent', icon: SignalHigh },
  ],
  value: 1,
  onChange: () => {},
};

test('PropertyMenu names the property and the chosen option on its pill, which opens the list of options', () => {
  renderWithI18n(<PropertyMenu {...props} />);
  const pill = screen.getByRole('button', { name: 'Priority P1 · Urgent' });
  const menu = popoverOf(pill);
  expect(menu).toHaveAttribute('popover', 'auto');
  expect(menu).toHaveAccessibleName('Priority');
  expect(pill.style.getPropertyValue('anchor-name')).toBe(
    menu.style.getPropertyValue('position-anchor'),
  );
  expect(
    within(menu)
      .getAllByRole('button')
      .map((option) => option.textContent),
  ).toEqual(['P0 · Critical', 'P1 · Urgent']);
});

test('PropertyMenu without a value names only the property', () => {
  renderWithI18n(<PropertyMenu {...props} value={undefined} />);
  expect(screen.getByRole('button', { name: 'Priority' })).toBeInTheDocument();
});

test('PropertyMenu with a value no option has names only the property', () => {
  renderWithI18n(<PropertyMenu {...props} value={7} />);
  expect(screen.getByRole('button', { name: 'Priority' })).toBeInTheDocument();
});

test('PropertyMenu marks only the chosen option as current', () => {
  renderWithI18n(<PropertyMenu {...props} />);
  expect(screen.getByRole('button', { name: 'P1 · Urgent' })).toHaveAttribute(
    'aria-current',
    'true',
  );
  expect(
    screen.getByRole('button', { name: 'P0 · Critical' }),
  ).not.toHaveAttribute('aria-current');
});

test('PropertyMenu hands over the value of the option chosen', async () => {
  const onChange = vi.fn();
  renderWithI18n(<PropertyMenu {...props} onChange={onChange} />);

  await userEvent.click(screen.getByRole('button', { name: 'P0 · Critical' }));

  expect(onChange.mock.calls).toEqual([[0]]);
});

test('PropertyMenu shows each option description below its name, in a wider menu', () => {
  renderWithI18n(
    <PropertyMenu
      {...props}
      options={[
        {
          value: 0,
          label: 'P0 · Critical',
          description: 'Drop everything',
          icon: CircleAlert,
        },
        { value: 1, label: 'P1 · Urgent', icon: SignalHigh },
      ]}
    />,
  );
  const pill = screen.getByRole('button', { name: 'Priority P1 · Urgent' });
  expect(popoverOf(pill)).toHaveClass('w-80');
  expect(
    screen.getByRole('button', { name: /^P0 · Critical/ }),
  ).toHaveTextContent('P0 · CriticalDrop everything');
});

test('PropertyMenu without descriptions keeps the narrow menu', () => {
  renderWithI18n(<PropertyMenu {...props} />);
  const pill = screen.getByRole('button', { name: 'Priority P1 · Urgent' });
  expect(popoverOf(pill)).toHaveClass('w-48');
});

test.each([
  [true, 'Priority P1 · Urgent missing'],
  [false, 'Priority P1 · Urgent'],
])(
  'PropertyMenu says its property is missing only when told: %s',
  (invalid, name) => {
    renderWithI18n(<PropertyMenu {...props} invalid={invalid} />);
    expect(
      screen.getByRole('button', { name: /^Priority/ }),
    ).toHaveAccessibleName(name);
  },
);

test('PropertyMenu hands its ref the pill', () => {
  const ref = { current: null as HTMLButtonElement | null };
  renderWithI18n(<PropertyMenu {...props} ref={ref} />);
  expect(ref.current).toBe(
    screen.getByRole('button', { name: 'Priority P1 · Urgent' }),
  );
});
