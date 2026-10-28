import { useId, type ReactNode } from 'react';
import { Plural, Trans } from '@lingui/react/macro';

// Who does a step's work: a script, or a model.
export type WorkflowExecutor = 'script' | 'llm';

export type WorkflowStep = {
  id: string;
  name: ReactNode;
  detail: ReactNode;
  executor: WorkflowExecutor;
};

export type WorkflowStepsProps = {
  steps: WorkflowStep[];
};

// Each executor's dot and label, named as well as colored.
const executors = {
  script: {
    dot: 'status status-success',
    label:
      'inline-flex shrink-0 items-center gap-1.5 font-mono text-[12px] text-success',
    name: <Trans>Script</Trans>,
  },
  llm: {
    dot: 'status status-info',
    label:
      'inline-flex shrink-0 items-center gap-1.5 font-mono text-[12px] text-info',
    name: <Trans>LLM</Trans>,
  },
} satisfies Record<
  WorkflowExecutor,
  { dot: string; label: string; name: ReactNode }
>;

// The steps a workflow takes, in order, each with who runs it.
export function WorkflowSteps({ steps }: Readonly<WorkflowStepsProps>) {
  const heading = useId();
  return (
    <section aria-labelledby={heading} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-[11.5px] text-muted">
        <h2 id={heading}>
          <Trans>Workflow steps</Trans>
        </h2>
        <span>
          <Plural value={steps.length} one="# step" other="# steps" />
        </span>
      </div>
      {steps.length === 0 ? (
        <p className="text-[12px] text-muted">
          <Trans>Choose a workflow to see its steps.</Trans>
        </p>
      ) : (
        <ul className="steps steps-vertical">
          {steps.map((step) => {
            const executor = executors[step.executor];
            return (
              <li key={step.id} className="step">
                <div className="flex w-full items-start justify-between gap-3 py-1 text-start">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold">{step.name}</p>
                    <p className="text-[12px] text-muted">{step.detail}</p>
                  </div>
                  <span className={executor.label}>
                    <span aria-hidden="true" className={executor.dot} />
                    {executor.name}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
