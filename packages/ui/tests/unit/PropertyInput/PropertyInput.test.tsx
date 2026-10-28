import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { User } from 'lucide-react';
import { expect, test, vi } from 'vitest';
import { popoverOf, stubPopovers, toggleEvent } from '../../popover';
import { renderWithI18n } from '../../render';
import {
  PropertyInput,
  type PropertyInputProps,
} from '../../../src/PropertyInput/PropertyInput';

stubPopovers();

const props: PropertyInputProps = {
  name: 'Assignee',
  icon: User,
  value: '',
  suggestions: ['runner-dev', 'runner-01', 'matheus'],
  placeholder: 'Who takes the task',
  hint: 'Enter uses the name typed.',
  onChange: () => {},
};

function suggestions() {
  return screen
    .queryAllByRole('button', { name: /^(?!Assignee)/ })
    .map((button) => button.textContent);
}

test('PropertyInput names only the property on its pill while it has no value', () => {
  renderWithI18n(<PropertyInput {...props} />);
  const pill = screen.getByRole('button', { name: 'Assignee' });
  // No empty value beside the name.
  expect(pill.querySelector('.font-medium')).toBeNull();
  const box = popoverOf(pill);
  expect(box).toHaveAttribute('popover', 'auto');
  expect(pill.style.getPropertyValue('anchor-name')).toBe(
    box.style.getPropertyValue('position-anchor'),
  );
  expect(
    within(box).getByRole('textbox', { name: 'Assignee' }),
  ).toHaveAttribute('placeholder', 'Who takes the task');
  expect(
    within(box).getByText('Enter uses the name typed.'),
  ).toBeInTheDocument();
});

test('PropertyInput names the property and its value on its pill', () => {
  renderWithI18n(<PropertyInput {...props} value="matheus" />);
  expect(
    screen.getByRole('button', { name: 'Assignee matheus' }),
  ).toBeInTheDocument();
});

test('PropertyInput lists every suggestion until the person types', () => {
  renderWithI18n(<PropertyInput {...props} value="matheus" />);
  expect(screen.getByRole('textbox')).toHaveValue('matheus');
  expect(suggestions()).toEqual(['runner-dev', 'runner-01', 'matheus']);
});

test('PropertyInput narrows the suggestions to those holding what was typed, whatever its case or spaces', async () => {
  renderWithI18n(<PropertyInput {...props} />);

  await userEvent.type(screen.getByRole('textbox'), ' RUNNER ');

  expect(suggestions()).toEqual(['runner-dev', 'runner-01']);
});

test('PropertyInput drops the list when no suggestion holds what was typed', async () => {
  renderWithI18n(<PropertyInput {...props} />);

  await userEvent.type(screen.getByRole('textbox'), 'runner-07');

  expect(screen.queryByRole('list')).not.toBeInTheDocument();
});

test('PropertyInput hands over the suggestion chosen', async () => {
  const onChange = vi.fn();
  renderWithI18n(<PropertyInput {...props} onChange={onChange} />);

  await userEvent.click(screen.getByRole('button', { name: 'runner-01' }));

  expect(onChange.mock.calls).toEqual([['runner-01']]);
});

test('PropertyInput hands over what was typed, trimmed, on Enter, without submitting the form around it', async () => {
  const onChange = vi.fn();
  const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
  renderWithI18n(
    <form onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}>
      <PropertyInput {...props} onChange={onChange} />
      <button type="submit">Submit</button>
    </form>,
  );

  await userEvent.type(screen.getByRole('textbox'), '  runner-07 {Enter}');

  expect(onChange.mock.calls).toEqual([['runner-07']]);
  expect(onSubmit).not.toHaveBeenCalled();
});

test('PropertyInput hands over nothing on Enter in a blank field', async () => {
  const onChange = vi.fn();
  renderWithI18n(<PropertyInput {...props} onChange={onChange} />);

  await userEvent.type(screen.getByRole('textbox'), '   {Enter}');

  expect(onChange).not.toHaveBeenCalled();
});

test('PropertyInput hands over nothing on another key', async () => {
  const onChange = vi.fn();
  renderWithI18n(<PropertyInput {...props} onChange={onChange} />);

  await userEvent.type(screen.getByRole('textbox'), 'runner-07{Tab}');

  expect(onChange).not.toHaveBeenCalled();
});

test('PropertyInput opens again with its value and every suggestion', async () => {
  renderWithI18n(<PropertyInput {...props} value="matheus" />);
  const field = screen.getByRole('textbox');
  await userEvent.clear(field);
  await userEvent.type(field, 'runner-0');

  fireEvent(
    popoverOf(screen.getByRole('button', { name: 'Assignee matheus' })),
    toggleEvent('beforetoggle', 'open'),
  );

  expect(field).toHaveValue('matheus');
  expect(suggestions()).toEqual(['runner-dev', 'runner-01', 'matheus']);
});

test('PropertyInput keeps what was typed as it closes', async () => {
  renderWithI18n(<PropertyInput {...props} value="matheus" />);
  const field = screen.getByRole('textbox');
  await userEvent.clear(field);
  await userEvent.type(field, 'runner-0');

  fireEvent(
    popoverOf(screen.getByRole('button', { name: 'Assignee matheus' })),
    toggleEvent('beforetoggle', 'closed'),
  );

  expect(field).toHaveValue('runner-0');
});

test('PropertyInput selects its text once open, and not as it closes', () => {
  renderWithI18n(<PropertyInput {...props} value="matheus" />);
  const field = screen.getByRole<HTMLInputElement>('textbox');
  const box = popoverOf(
    screen.getByRole('button', { name: 'Assignee matheus' }),
  );

  fireEvent(box, toggleEvent('toggle', 'closed'));
  expect(document.activeElement).not.toBe(field);

  fireEvent(box, toggleEvent('toggle', 'open'));
  expect(field).toHaveFocus();
  expect([field.selectionStart, field.selectionEnd]).toEqual([0, 7]);
});

test('PropertyInput without a hint shows none', () => {
  const { container } = renderWithI18n(
    <PropertyInput {...props} hint={undefined} />,
  );
  expect(container.ownerDocument.querySelector('p')).toBeNull();
});

test.each([
  [true, 'Assignee missing'],
  [false, 'Assignee'],
])(
  'PropertyInput says its property is missing only when told: %s',
  (invalid, name) => {
    renderWithI18n(<PropertyInput {...props} invalid={invalid} />);
    expect(
      screen.getByRole('button', { name: /^Assignee/ }),
    ).toHaveAccessibleName(name);
  },
);
