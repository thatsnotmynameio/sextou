import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { WorkflowSteps } from './WorkflowSteps';

const meta = {
  component: WorkflowSteps,
  decorators: [
    (Story) => (
      <div className="w-[300px] p-5">
        <Story />
      </div>
    ),
  ],
  args: {
    steps: [
      {
        id: 'checkout',
        name: 'Checkout',
        detail: 'Clones the repository at the ref asked for, in the workspace',
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
} satisfies Meta<typeof WorkflowSteps>;

export default meta;
type Story = StoryObj<typeof meta>;

// Each step in order, with who runs it named beside it.
export const TwoSteps: Story = {
  play: async ({ canvas }) => {
    const section = canvas.getByRole('region', { name: 'Workflow steps' });
    await expect(section).toHaveTextContent('2 steps');
    const steps = within(section).getAllByRole('listitem');
    await expect(steps.map((step) => step.textContent)).toEqual([
      'CheckoutClones the repository at the ref asked for, in the workspaceScript',
      'ClaudeRuns claude -p in the checkout, with the promptLLM',
    ]);
  },
};

export const OneStep: Story = {
  args: {
    steps: [
      {
        id: 'hello',
        name: 'Hello',
        detail: 'Runs hello.py with python3',
        executor: 'script',
      },
    ],
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole('region', { name: 'Workflow steps' }),
    ).toHaveTextContent('1 step');
  },
};

// With no workflow chosen there are no steps to show.
export const None: Story = {
  args: { steps: [] },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole('list')).not.toBeInTheDocument();
    await expect(
      canvas.getByText('Choose a workflow to see its steps.'),
    ).toBeVisible();
  },
};
