import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bot, GitBranch, GitPullRequest, Terminal } from 'lucide-react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { CreateTaskActions, CreateTaskForm } from './CreateTaskForm';

const sha = '6892bfe7d1a161b628f14fa89790d657d3e6332d';
const uses = (path: string) =>
  `thatsnotmynameio/sextou/packages/workflows/${path}/Taskfile.yml@${sha}`;

const meta = {
  component: CreateTaskForm,
  parameters: { layout: 'fullscreen' },
  // The page header the form's actions sit in, as AppShell's actions.
  decorators: [
    (Story, { args }) => (
      <div className="flex min-h-screen flex-col bg-base-100 font-sans text-[13px] leading-[1.4] text-base-content">
        <header className="flex items-center gap-2 border-b border-line px-[14px] py-[10px]">
          <h1 className="min-w-0 flex-1 text-[15px] font-semibold">New task</h1>
          <CreateTaskActions
            form="create-task"
            cancelHref="#tasks"
            pending={args.pending === true}
          />
        </header>
        <div className="flex-1">
          <Story />
        </div>
      </div>
    ),
  ],
  args: {
    id: 'create-task',
    workflows: [
      {
        uses: uses('sextou/development'),
        name: 'sextou/development',
        description:
          'Clones a repository and runs claude in it, once the checkout succeeded.',
        icon: GitPullRequest,
        steps: [
          {
            id: 'checkout',
            name: 'Checkout',
            detail:
              'Clones the repository at the ref asked for, in the workspace',
            executor: 'script',
          },
          {
            id: 'claude',
            name: 'Claude',
            detail: 'Runs claude -p in the checkout, with the prompt',
            executor: 'llm',
          },
        ],
      },
      {
        uses: uses('git/checkout'),
        name: 'git/checkout',
        description: 'Clones a repository at a ref, in the workspace.',
        icon: GitBranch,
        steps: [
          {
            id: 'checkout',
            name: 'Checkout',
            detail: 'A shallow fetch of the ref, checked out detached',
            executor: 'script',
          },
        ],
      },
      {
        uses: uses('harness/claude-headless'),
        name: 'harness/claude-headless',
        description: 'Runs claude -p in the workspace, with the prompt.',
        icon: Bot,
        steps: [
          {
            id: 'claude',
            name: 'Claude',
            detail: 'Runs claude -p at the path asked for',
            executor: 'llm',
          },
        ],
      },
      {
        uses: uses('hello-world'),
        name: 'hello-world',
        description: 'Prints hello world with Python.',
        icon: Terminal,
        steps: [
          {
            id: 'hello',
            name: 'Hello',
            detail: 'Runs hello.py with python3',
            executor: 'script',
          },
        ],
      },
    ],
    assignees: ['runner-dev', 'runner-01', 'matheus'],
    kinds: ['feature', 'bug', 'chore'],
    onSubmit: fn(),
  },
} satisfies Meta<typeof CreateTaskForm>;

export default meta;
type Story = StoryObj<typeof meta>;

// The pill's popover, which it names by id.
function popoverOf(pill: HTMLElement) {
  return pill.ownerDocument.getElementById(
    pill.getAttribute('popovertarget') ?? '',
  ) as HTMLElement;
}

// Opens the pill named `name` and picks `option` in its popover.
async function pick(
  canvas: ReturnType<typeof within>,
  name: RegExp,
  option: string | RegExp,
) {
  const pill = canvas.getByRole('button', { name });
  const box = popoverOf(pill);
  await userEvent.click(pill);
  await waitFor(() => expect(box).toBeVisible());
  await userEvent.click(within(box).getByRole('button', { name: option }));
  await waitFor(() => expect(box).not.toBeVisible());
}

// It opens on the first workflow, with its steps beside the fields, and the
// normal priority.
export const Empty: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole('button', { name: 'Workflow sextou/development' }),
    ).toBeVisible();
    await expect(
      canvas.getByRole('button', { name: 'Priority P2 · Normal' }),
    ).toBeVisible();
    await expect(
      canvas.getByRole('region', { name: 'Workflow steps' }),
    ).toHaveTextContent('2 steps');
    await expect(canvas.getByRole('textbox', { name: 'Title' })).toBeVisible();
  },
};

// Filled in and submitted from the header's button, it hands over the values
// tasks.create takes, trimmed, with the chosen workflow's uses.
export const Submit: Story = {
  play: async ({ args, canvas }) => {
    await pick(canvas, /^Workflow/, /^git\/checkout/);
    await expect(
      canvas.getByRole('region', { name: 'Workflow steps' }),
    ).toHaveTextContent('1 step');
    await pick(canvas, /^Priority/, 'P1 · Urgent');
    await pick(canvas, /^Assignee/, 'runner-dev');
    await pick(canvas, /^Kind/, 'feature');
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Title' }),
      ' Show the runner state in the footer ',
    );
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Description · optional' }),
      ' How many runners are connected. ',
    );

    await userEvent.click(canvas.getByRole('button', { name: 'Create task' }));

    await expect(args.onSubmit).toHaveBeenCalledWith({
      title: 'Show the runner state in the footer',
      description: 'How many runners are connected.',
      priority: 1,
      assignee: 'runner-dev',
      kind: 'feature',
      uses: uses('git/checkout'),
    });
  },
};

// Submitted empty, it says what is missing, marks each of it and moves focus
// to the title; the message shrinks as each is set.
export const Missing: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Create task' }));

    await expect(args.onSubmit).not.toHaveBeenCalled();
    await expect(
      canvas.getByText('Missing the title, the assignee, and the kind.'),
    ).toBeVisible();
    const title = canvas.getByRole('textbox', { name: 'Title' });
    await expect(title).toHaveFocus();
    await expect(title).toHaveAccessibleDescription('Give the task a title.');
    await expect(
      canvas.getByRole('button', { name: 'Assignee missing' }),
    ).toBeVisible();
    await expect(
      canvas.getByRole('button', { name: 'Kind missing' }),
    ).toBeVisible();

    await userEvent.type(title, 'A title');
    await expect(
      canvas.getByText('Missing the assignee and the kind.'),
    ).toBeVisible();
    await expect(title).not.toHaveAttribute('aria-describedby');
  },
};

// With the title there, focus goes to the first pill still missing: the
// assignee, then the kind. Ctrl and Enter submit it from the description.
export const MissingPill: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Title' }),
      'A title',
    );
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await expect(
      canvas.getByRole('button', { name: 'Assignee missing' }),
    ).toHaveFocus();

    await pick(canvas, /^Assignee/, 'matheus');
    await userEvent.click(
      canvas.getByRole('textbox', { name: 'Description · optional' }),
    );
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await expect(
      canvas.getByRole('button', { name: 'Kind missing' }),
    ).toHaveFocus();

    await pick(canvas, /^Kind/, 'chore');
    await userEvent.click(
      canvas.getByRole('textbox', { name: 'Description · optional' }),
    );
    await userEvent.keyboard('{Control>}{Enter}{/Control}');

    await expect(args.onSubmit).toHaveBeenCalledWith({
      title: 'A title',
      priority: 2,
      assignee: 'matheus',
      kind: 'chore',
      uses: uses('sextou/development'),
    });
  },
};

// A title left empty says so once the field loses focus, before any submit.
export const TitleLeftEmpty: Story = {
  play: async ({ canvas }) => {
    const title = canvas.getByRole('textbox', { name: 'Title' });
    await userEvent.click(title);
    await userEvent.tab();

    await expect(title).toHaveAttribute('aria-invalid', 'true');
    await expect(canvas.getByText('Give the task a title.')).toBeVisible();
    await expect(canvas.queryByText(/^Missing/)).not.toBeInTheDocument();
  },
};

// With no workflow to run, the task has no uses and no steps.
export const NoWorkflow: Story = {
  args: { workflows: [] },
  play: async ({ args, canvas }) => {
    await expect(
      canvas.getByRole('button', { name: 'Workflow' }),
    ).toBeVisible();
    await expect(
      canvas.getByText('Choose a workflow to see its steps.'),
    ).toBeVisible();
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Title' }),
      'A title',
    );
    await pick(canvas, /^Assignee/, 'runner-01');
    await pick(canvas, /^Kind/, 'bug');
    await userEvent.click(canvas.getByRole('button', { name: 'Create task' }));

    await expect(args.onSubmit).toHaveBeenCalledWith({
      title: 'A title',
      priority: 2,
      assignee: 'runner-01',
      kind: 'bug',
    });
  },
};

// On a phone the steps go below the fields.
export const Phone: Story = {
  globals: { viewport: { value: 'mobile1' } },
  play: async ({ canvas }) => {
    const title = canvas.getByRole('textbox', { name: 'Title' });
    const steps = canvas.getByRole('region', { name: 'Workflow steps' });
    await expect(steps.getBoundingClientRect().top).toBeGreaterThan(
      title.getBoundingClientRect().bottom,
    );
  },
};

// While the task is being created the submit button waits, and says so, and
// the shortcut submits nothing either.
export const Pending: Story = {
  args: { pending: true },
  play: async ({ args, canvas }) => {
    await expect(
      canvas.getByRole('button', { name: 'Creating' }),
    ).toBeDisabled();
    await expect(canvas.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
      'href',
      '#tasks',
    );
    await userEvent.type(
      canvas.getByRole('textbox', { name: 'Title' }),
      'A title',
    );
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await expect(args.onSubmit).not.toHaveBeenCalled();
    await expect(canvas.queryByText(/^Missing/)).not.toBeInTheDocument();
  },
};
