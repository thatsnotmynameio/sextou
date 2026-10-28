import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Bot, GitBranch } from 'lucide-react';
import { expect, test, vi } from 'vitest';
import { popoverOf as popoverOfPill, stubPopovers } from '../../popover';
import { renderWithI18n } from '../../render';
import {
  CreateTaskActions,
  CreateTaskForm,
  type CreateTaskFormProps,
} from '../../../src/CreateTaskForm/CreateTaskForm';

stubPopovers();

const props: CreateTaskFormProps = {
  id: 'create-task',
  workflows: [
    {
      uses: 'acme/flows/checkout/Taskfile.yml@1111111111111111111111111111111111111111',
      name: 'checkout',
      description: 'Clones a repository.',
      icon: GitBranch,
      steps: [
        {
          id: 'checkout',
          name: 'Checkout',
          detail: 'Clones it',
          executor: 'script',
        },
      ],
    },
    {
      uses: 'acme/flows/agent/Taskfile.yml@2222222222222222222222222222222222222222',
      name: 'agent',
      description: 'Runs an agent.',
      icon: Bot,
      steps: [
        {
          id: 'checkout',
          name: 'Checkout',
          detail: 'Clones it',
          executor: 'script',
        },
        { id: 'agent', name: 'Agent', detail: 'Runs it', executor: 'llm' },
      ],
    },
  ],
  assignees: ['runner-dev', 'matheus'],
  kinds: ['feature', 'bug'],
  onSubmit: () => {},
};

// The form with its actions beside it, as a page puts them in its header.
function renderForm(overrides: Partial<CreateTaskFormProps> = {}) {
  const onSubmit = vi.fn();
  renderWithI18n(
    <>
      <CreateTaskActions form="create-task" cancelHref="/tasks" />
      <CreateTaskForm {...props} onSubmit={onSubmit} {...overrides} />
    </>,
  );
  return onSubmit;
}

function pill(name: RegExp) {
  return screen.getByRole('button', { name });
}

// The popover a pill opens; jsdom shows every popover, so it is reached by the pill's popovertarget.
function popoverOf(button: HTMLElement) {
  return within(popoverOfPill(button));
}

async function choose(name: RegExp, option: RegExp | string) {
  await userEvent.click(
    popoverOf(pill(name)).getByRole('button', { name: option }),
  );
}

async function fill() {
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Title' }),
    ' A title ',
  );
  await choose(/^Assignee/, 'runner-dev');
  await choose(/^Kind/, 'bug');
}

const submit = () =>
  userEvent.click(screen.getByRole('button', { name: 'Create task' }));

test('CreateTaskForm opens on the first workflow and the normal priority, with no assignee or kind', () => {
  renderForm();
  expect(pill(/^Workflow/)).toHaveAccessibleName('Workflow checkout');
  expect(pill(/^Priority/)).toHaveAccessibleName('Priority P2 · Normal');
  expect(pill(/^Assignee/)).toHaveAccessibleName('Assignee');
  expect(pill(/^Kind/)).toHaveAccessibleName('Kind');
  expect(
    screen.getByRole('region', { name: 'Workflow steps' }),
  ).toHaveTextContent('1 step');
  expect(
    screen.getByRole('textbox', { name: 'Description · optional' }),
  ).toHaveAttribute(
    'placeholder',
    "What is done when the task ends, and what the runner's agent needs to know.",
  );
  const title = screen.getByRole('textbox', { name: 'Title' });
  expect(title).toHaveAttribute(
    'placeholder',
    "Show the runner's state in the footer",
  );
  expect(title).toHaveClass('border-line');
  expect(title).not.toHaveClass('input-error');
  expect(
    popoverOf(pill(/^Kind/)).getByRole('textbox', { name: 'Kind' }),
  ).toHaveAttribute('placeholder', "The task's kind");
  expect(
    popoverOf(pill(/^Assignee/)).getByRole('textbox', { name: 'Assignee' }),
  ).toHaveAttribute('placeholder', 'Who takes the task');
});

test('CreateTaskForm offers every priority, from P0 to P4', () => {
  renderForm();
  expect(
    popoverOf(pill(/^Priority/))
      .getAllByRole('button')
      .map((option) => option.textContent),
  ).toEqual([
    'P0 · Critical',
    'P1 · Urgent',
    'P2 · Normal',
    'P3 · Low',
    'P4 · Whenever',
  ]);
});

test('CreateTaskForm hands over the values tasks.create takes, trimmed, once it has a title, an assignee and a kind', async () => {
  const onSubmit = renderForm();
  await fill();
  await choose(/^Priority/, 'P0 · Critical');
  await choose(/^Workflow/, /^agent/);
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Description · optional' }),
    ' Notes. ',
  );

  await submit();

  expect(onSubmit.mock.calls).toEqual([
    [
      {
        title: 'A title',
        description: 'Notes.',
        priority: 0,
        assignee: 'runner-dev',
        kind: 'bug',
        uses: props.workflows[1]?.uses,
      },
    ],
  ]);
});

test('CreateTaskForm leaves out a blank description', async () => {
  const onSubmit = renderForm();
  await fill();
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Description · optional' }),
    '   ',
  );

  await submit();

  expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('description');
});

test('CreateTaskForm with no workflow hands over no uses and shows no steps', async () => {
  const onSubmit = renderForm({ workflows: [] });
  expect(pill(/^Workflow/)).toHaveAccessibleName('Workflow');
  expect(
    screen.getByText('Choose a workflow to see its steps.'),
  ).toBeInTheDocument();
  await fill();

  await submit();

  expect(onSubmit.mock.calls).toEqual([
    [{ title: 'A title', priority: 2, assignee: 'runner-dev', kind: 'bug' }],
  ]);
});

test('CreateTaskForm shows the steps of the workflow chosen', async () => {
  renderForm();

  await choose(/^Workflow/, /^agent/);

  expect(
    within(screen.getByRole('region', { name: 'Workflow steps' }))
      .getAllByRole('listitem')
      .map((step) => step.textContent),
  ).toEqual(['CheckoutClones itScript', 'AgentRuns itLLM']);
});

test('CreateTaskForm submitted empty says what is missing, marks it and moves focus to the title', async () => {
  const onSubmit = renderForm();

  await submit();

  expect(onSubmit).not.toHaveBeenCalled();
  expect(
    screen.getByText('Missing the title, the assignee, and the kind.'),
  ).toBeInTheDocument();
  const title = screen.getByRole('textbox', { name: 'Title' });
  expect(title).toHaveFocus();
  expect(title).toHaveAttribute('aria-invalid', 'true');
  expect(title).toHaveAccessibleDescription('Give the task a title.');
  expect(title).toHaveClass('input-error');
  expect(pill(/^Assignee/)).toHaveAccessibleName('Assignee missing');
  expect(pill(/^Kind/)).toHaveAccessibleName('Kind missing');
});

test('CreateTaskForm takes a title of spaces as missing', async () => {
  const onSubmit = renderForm();
  await fill();
  const title = screen.getByRole('textbox', { name: 'Title' });
  await userEvent.clear(title);
  await userEvent.type(title, '   ');

  await submit();

  expect(onSubmit).not.toHaveBeenCalled();
  expect(screen.getByText('Missing the title.')).toBeInTheDocument();
});

test('CreateTaskForm moves focus to the assignee when it is the first thing missing', async () => {
  renderForm();
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Title' }),
    'A title',
  );

  await submit();

  expect(pill(/^Assignee/)).toHaveFocus();
  expect(
    screen.getByText('Missing the assignee and the kind.'),
  ).toBeInTheDocument();
});

test('CreateTaskForm moves focus to the kind when it is all that is missing', async () => {
  renderForm();
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Title' }),
    'A title',
  );
  await choose(/^Assignee/, 'matheus');

  await submit();

  expect(pill(/^Kind/)).toHaveFocus();
  expect(pill(/^Assignee/)).toHaveAccessibleName('Assignee matheus');
  expect(screen.getByText('Missing the kind.')).toBeInTheDocument();
});

test('CreateTaskForm drops the message once nothing is missing', async () => {
  renderForm();
  await submit();

  await fill();

  expect(screen.queryByText(/^Missing/)).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Title' })).toHaveAttribute(
    'aria-invalid',
    'false',
  );
});

test('CreateTaskForm says nothing is missing before a submit', () => {
  renderForm();
  expect(screen.queryByText(/^Missing/)).not.toBeInTheDocument();
  expect(pill(/^Assignee/)).toHaveAccessibleName('Assignee');
  expect(screen.getByRole('textbox', { name: 'Title' })).not.toHaveAttribute(
    'aria-describedby',
  );
});

test('CreateTaskForm says the title is missing once it is left empty', async () => {
  renderForm();
  await userEvent.click(screen.getByRole('textbox', { name: 'Title' }));

  await userEvent.tab();

  expect(screen.getByText('Give the task a title.')).toBeInTheDocument();
  expect(screen.queryByText(/^Missing/)).not.toBeInTheDocument();
});

test.each([
  ['Ctrl', '{Control>}{Enter}{/Control}', 'Description · optional'],
  ['Cmd', '{Meta>}{Enter}{/Meta}', 'Description · optional'],
  ['Ctrl', '{Control>}{Enter}{/Control}', 'Title'],
])(
  'CreateTaskForm submits on %s and Enter in the field %s',
  async (_, keys, field) => {
    const onSubmit = renderForm();
    await fill();
    const typed = screen.getByRole('textbox', { name: field });
    const before = (typed as HTMLInputElement).value;
    await userEvent.click(typed);

    await userEvent.keyboard(keys);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    // The Enter goes to the shortcut, not into the field.
    expect(typed).toHaveValue(before);
  },
);

test('CreateTaskForm takes Ctrl and another key in a field as typing', async () => {
  const onSubmit = renderForm();
  await fill();
  await userEvent.click(screen.getByRole('textbox', { name: 'Title' }));

  await userEvent.keyboard('{Control>}a{/Control}');

  expect(onSubmit).not.toHaveBeenCalled();
});

test.each([
  ['the shortcut in the title', 'Title'],
  ['the shortcut in the description', 'Description · optional'],
])(
  'CreateTaskForm submits nothing while pending, from %s',
  async (_, field) => {
    const onSubmit = renderForm({ pending: true });
    await fill();
    await userEvent.click(screen.getByRole('textbox', { name: field }));

    await userEvent.keyboard('{Control>}{Enter}{/Control}');

    expect(onSubmit).not.toHaveBeenCalled();
  },
);

test('CreateTaskForm says nothing is missing for a submit while pending', async () => {
  renderForm({ pending: true });
  await userEvent.click(screen.getByRole('textbox', { name: 'Title' }));

  await userEvent.keyboard('{Control>}{Enter}{/Control}');

  expect(screen.queryByText(/^Missing/)).not.toBeInTheDocument();
  expect(pill(/^Assignee/)).toHaveAccessibleName('Assignee');
});

test('CreateTaskForm keeps Enter alone in the description for a new line', async () => {
  const onSubmit = renderForm();
  await fill();
  const description = screen.getByRole('textbox', {
    name: 'Description · optional',
  });

  await userEvent.type(description, 'one{Enter}two');

  expect(onSubmit).not.toHaveBeenCalled();
  expect(description).toHaveValue('one\ntwo');
});

test('CreateTaskActions links Cancel back and submits the form it names', () => {
  renderWithI18n(<CreateTaskActions form="create-task" cancelHref="/tasks" />);
  expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
    'href',
    '/tasks',
  );
  const create = screen.getByRole('button', { name: 'Create task' });
  expect(create).toHaveAttribute('form', 'create-task');
  expect(create).toBeEnabled();
});

test('CreateTaskActions waits while the task is being created', () => {
  renderWithI18n(
    <CreateTaskActions form="create-task" cancelHref="/tasks" pending />,
  );
  expect(screen.getByRole('button', { name: 'Creating' })).toBeDisabled();
});
