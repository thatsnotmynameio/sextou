import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { User } from 'lucide-react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { PropertyInput, type PropertyInputProps } from './PropertyInput';

// The field keeps the value it was given; the story's own state lets the pill show the one set.
function Stateful(props: PropertyInputProps) {
  const [value, setValue] = useState(props.value);
  return (
    <PropertyInput
      {...props}
      value={value}
      onChange={(chosen) => {
        setValue(chosen);
        props.onChange(chosen);
      }}
    />
  );
}

const meta = {
  component: PropertyInput,
  render: (args) => <Stateful {...args} />,
  args: {
    name: 'Assignee',
    icon: User,
    value: '',
    suggestions: ['runner-dev', 'runner-01', 'matheus'],
    placeholder: 'Who takes the task',
    hint: 'Enter uses the name typed.',
    onChange: fn(),
  },
} satisfies Meta<typeof PropertyInput>;

export default meta;
type Story = StoryObj<typeof meta>;

// The pill's popover, which it names by id.
function popoverOf(pill: HTMLElement) {
  return pill.ownerDocument.getElementById(
    pill.getAttribute('popovertarget') ?? '',
  ) as HTMLElement;
}

// The field opens with focus and every suggestion; typing narrows them, and a
// suggestion sets the value and closes the field.
export const Suggestion: Story = {
  play: async ({ args, canvas }) => {
    const pill = canvas.getByRole('button', { name: 'Assignee' });
    const box = popoverOf(pill);
    await userEvent.click(pill);
    await waitFor(() => expect(box).toBeVisible());
    const field = within(box).getByRole('textbox', { name: 'Assignee' });
    await waitFor(() => expect(field).toHaveFocus());
    await expect(within(box).getAllByRole('button')).toHaveLength(3);

    await userEvent.type(field, 'RUNNER');
    await expect(
      within(box)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['runner-dev', 'runner-01']);

    await userEvent.click(
      within(box).getByRole('button', { name: 'runner-01' }),
    );

    await expect(args.onChange).toHaveBeenCalledWith('runner-01');
    await waitFor(() => expect(box).not.toBeVisible());
    await expect(
      canvas.getByRole('button', { name: 'Assignee runner-01' }),
    ).toBeInTheDocument();
  },
};

// Enter sets what was typed, trimmed, even when no suggestion has it; it
// reopens with the value set selected and every suggestion shown again.
export const Typed: Story = {
  play: async ({ args, canvas }) => {
    const pill = canvas.getByRole('button', { name: 'Assignee' });
    const box = popoverOf(pill);
    await userEvent.click(pill);
    const field = within(box).getByRole<HTMLInputElement>('textbox', {
      name: 'Assignee',
    });
    await waitFor(() => expect(field).toHaveFocus());

    await userEvent.type(field, '  runner-07 ');
    await expect(within(box).queryByRole('list')).not.toBeInTheDocument();
    await userEvent.keyboard('{Enter}');

    await expect(args.onChange).toHaveBeenCalledWith('runner-07');
    await waitFor(() => expect(box).not.toBeVisible());

    const set = canvas.getByRole('button', { name: 'Assignee runner-07' });
    await userEvent.click(set);
    await waitFor(() => expect(field).toHaveFocus());
    await expect(field).toHaveValue('runner-07');
    await expect([field.selectionStart, field.selectionEnd]).toEqual([0, 9]);
    await expect(within(box).getAllByRole('button')).toHaveLength(3);
  },
};

// Enter on a blank field sets nothing and leaves it open.
export const Blank: Story = {
  play: async ({ args, canvas }) => {
    const pill = canvas.getByRole('button', { name: 'Assignee' });
    const box = popoverOf(pill);
    await userEvent.click(pill);
    const field = within(box).getByRole('textbox', { name: 'Assignee' });
    await waitFor(() => expect(field).toHaveFocus());

    await userEvent.type(field, '   {Enter}');

    await expect(args.onChange).not.toHaveBeenCalled();
    await expect(box).toBeVisible();
  },
};

// A property a submit found missing says so on its pill; without a hint the field has none.
export const Invalid: Story = {
  args: { invalid: true, hint: undefined },
  play: async ({ canvas }) => {
    const pill = canvas.getByRole('button', { name: 'Assignee missing' });
    await expect(pill).toHaveClass('border-error');
    await expect(popoverOf(pill).querySelector('p')).toBeNull();
  },
};
