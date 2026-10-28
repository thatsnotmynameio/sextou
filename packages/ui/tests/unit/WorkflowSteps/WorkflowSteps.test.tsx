import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { renderWithI18n } from '../../render';
import {
  WorkflowSteps,
  type WorkflowStep,
} from '../../../src/WorkflowSteps/WorkflowSteps';

const checkout: WorkflowStep = {
  id: 'checkout',
  name: 'Checkout',
  detail: 'Clones the repository',
  executor: 'script',
};
const claude: WorkflowStep = {
  id: 'claude',
  name: 'Claude',
  detail: 'Runs claude -p',
  executor: 'llm',
};

test('WorkflowSteps lists the steps in order, each with its detail and who runs it', () => {
  renderWithI18n(<WorkflowSteps steps={[checkout, claude]} />);
  const section = screen.getByRole('region', { name: 'Workflow steps' });
  expect(
    within(section)
      .getAllByRole('listitem')
      .map((step) => step.textContent),
  ).toEqual(['CheckoutClones the repositoryScript', 'ClaudeRuns claude -pLLM']);
});

test.each([
  [[checkout], '1 step'],
  [[checkout, claude], '2 steps'],
])('WorkflowSteps counts its steps: %#', (steps, count) => {
  renderWithI18n(<WorkflowSteps steps={steps} />);
  expect(screen.getByText(count)).toBeInTheDocument();
});

test.each([
  [checkout, 'Script', 'text-success', 'status-success'],
  [claude, 'LLM', 'text-info', 'status-info'],
])(
  'WorkflowSteps colors the executor of %#, its label and its dot, by who it is',
  (step, name, text, dot) => {
    renderWithI18n(<WorkflowSteps steps={[step]} />);
    const label = screen.getByText(name);
    expect(label).toHaveClass(text);
    expect(label.querySelector('.status')).toHaveClass(dot);
  },
);

test('WorkflowSteps with no steps asks for a workflow instead of a list', () => {
  renderWithI18n(<WorkflowSteps steps={[]} />);
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
  expect(screen.getByText('0 steps')).toBeInTheDocument();
  expect(
    screen.getByText('Choose a workflow to see its steps.'),
  ).toBeInTheDocument();
});
