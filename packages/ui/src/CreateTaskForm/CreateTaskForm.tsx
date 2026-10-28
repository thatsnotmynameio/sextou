import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  CircleAlert,
  SignalHigh,
  SignalLow,
  SignalMedium,
  SignalZero,
  Tag,
  User,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { PropertyInput } from '../PropertyInput/PropertyInput';
import {
  PropertyMenu,
  type PropertyOption,
} from '../PropertyMenu/PropertyMenu';
import {
  WorkflowSteps,
  type WorkflowStep,
} from '../WorkflowSteps/WorkflowSteps';

// A workflow the task can run: its uses, as tasks.create takes it, and what
// the person sees of it.
export type CreateTaskWorkflow = {
  uses: string;
  name: string;
  description: ReactNode;
  icon: LucideIcon;
  steps: WorkflowStep[];
};

// A task's priority, as tasks.create takes it: 0 is the most urgent.
export type CreateTaskPriority = 0 | 1 | 2 | 3 | 4;

// What the form hands its caller, under tasks.create's names.
export type CreateTaskValues = {
  title: string;
  description?: string;
  priority: CreateTaskPriority;
  assignee: string;
  kind: string;
  uses?: string;
};

export type CreateTaskFormProps = {
  // The form's id, which CreateTaskActions' submit button names.
  id: string;
  // The first one is chosen when the form opens.
  workflows: CreateTaskWorkflow[];
  assignees: string[];
  kinds: string[];
  onSubmit: (values: CreateTaskValues) => void;
  // While the task is being created, as CreateTaskActions is told: no submit goes through.
  pending?: boolean;
};

type Missing = 'title' | 'assignee' | 'kind';

// A new task: its properties as pills, its title and description, and the
// steps of the workflow it runs beside them. It hands the values to onSubmit
// only once it has a title, an assignee and a kind, and otherwise says what
// is missing and moves focus to the first of it. Ctrl or Cmd and Enter submit
// it from the title or the description. While pending, it submits nothing, so
// the shortcut cannot create the task twice.
// Stryker disable BlockStatement: emptying the body moves useLingui() out of the place Lingui's macro rewrites, so it would fail to compile, not to pass
export function CreateTaskForm({
  id,
  workflows,
  assignees,
  kinds,
  onSubmit,
  pending = false,
}: Readonly<CreateTaskFormProps>) {
  // Stryker restore BlockStatement
  const { t, i18n } = useLingui();
  const titleId = useId();
  const descriptionId = useId();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<CreateTaskPriority>(2);
  const [assignee, setAssignee] = useState('');
  const [kind, setKind] = useState('');
  const [uses, setUses] = useState(workflows[0]?.uses);
  // The title says it is missing once left empty; the rest, once a submit lacked them.
  const [titleLeft, setTitleLeft] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const titleField = useRef<HTMLInputElement>(null);
  const assigneePill = useRef<HTMLButtonElement>(null);
  const kindPill = useRef<HTMLButtonElement>(null);

  const priorities: PropertyOption<CreateTaskPriority>[] = [
    { value: 0, label: t`P0 · Critical`, icon: CircleAlert },
    { value: 1, label: t`P1 · Urgent`, icon: SignalHigh },
    { value: 2, label: t`P2 · Normal`, icon: SignalMedium },
    { value: 3, label: t`P3 · Low`, icon: SignalLow },
    { value: 4, label: t`P4 · Whenever`, icon: SignalZero },
  ];
  const workflowOptions = workflows.map((workflow) => ({
    value: workflow.uses,
    label: <span className="font-mono">{workflow.name}</span>,
    description: workflow.description,
    icon: workflow.icon,
  }));
  const chosen = workflows.find((workflow) => workflow.uses === uses);

  const missing: Missing[] = [];
  if (title.trim() === '') {
    missing.push('title');
  }
  if (assignee === '') {
    missing.push('assignee');
  }
  if (kind === '') {
    missing.push('kind');
  }
  const names: Record<Missing, string> = {
    title: t`the title`,
    assignee: t`the assignee`,
    kind: t`the kind`,
  };
  const titleMissing = (titleLeft || submitted) && missing.includes('title');
  const summary = submitted && missing.length > 0;
  const list = new Intl.ListFormat(i18n.locale, { type: 'conjunction' }).format(
    missing.map((name) => names[name]),
  );

  // Where focus goes for each thing missing.
  const focusFor: Record<Missing, RefObject<HTMLElement | null>> = {
    title: titleField,
    assignee: assigneePill,
    kind: kindPill,
  };

  const submit = () => {
    if (pending) {
      return;
    }
    setSubmitted(true);
    const first = missing[0];
    if (first !== undefined) {
      // Stryker disable next-line OptionalChaining: the form submits only while mounted, so the field and the pills are there
      focusFor[first].current?.focus();
    } else {
      const trimmed = description.trim();
      onSubmit({
        title: title.trim(),
        ...(trimmed === '' ? {} : { description: trimmed }),
        priority,
        assignee,
        kind,
        ...(uses === undefined ? {} : { uses }),
      });
    }
  };

  // Ctrl or Cmd and Enter, in a field the person types in.
  const shortcut = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      id={id}
      noValidate
      className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_300px]"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex min-w-0 flex-col gap-5 px-[14px] py-5 lg:px-6">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            <PropertyMenu
              name={t`Workflow`}
              icon={Workflow}
              options={workflowOptions}
              value={uses}
              onChange={setUses}
            />
            <PropertyMenu
              name={t`Priority`}
              icon={SignalMedium}
              options={priorities}
              value={priority}
              onChange={setPriority}
            />
            <PropertyInput
              ref={assigneePill}
              name={t`Assignee`}
              icon={User}
              value={assignee}
              suggestions={assignees}
              placeholder={t`Who takes the task`}
              hint={<Trans>Enter uses the name typed.</Trans>}
              onChange={setAssignee}
              invalid={submitted && assignee === ''}
            />
            <PropertyInput
              ref={kindPill}
              name={t`Kind`}
              icon={Tag}
              value={kind}
              suggestions={kinds}
              placeholder={t`The task's kind`}
              hint={<Trans>Enter uses the kind typed.</Trans>}
              onChange={setKind}
              invalid={submitted && kind === ''}
            />
          </div>
          <p
            aria-live="polite"
            className="flex items-center gap-1.5 text-[12px]"
          >
            {summary && (
              <>
                <CircleAlert
                  aria-hidden="true"
                  size={14}
                  className="text-error"
                />
                {t`Missing ${list}.`}
              </>
            )}
          </p>
        </div>

        {/* Title and description are drawn alike: a bordered field on the darker base, with its label above. */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={titleId} className="text-[11.5px] text-muted">
            <Trans>Title</Trans>
          </label>
          <input
            ref={titleField}
            id={titleId}
            type="text"
            required
            autoComplete="off"
            aria-invalid={titleMissing}
            aria-describedby={titleMissing ? `${titleId}-error` : undefined}
            placeholder={t`Show the runner's state in the footer`}
            className={
              titleMissing
                ? 'input input-error w-full bg-base-200 px-3 text-[15px] font-medium'
                : 'input w-full border-line bg-base-200 px-3 text-[15px] font-medium'
            }
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => setTitleLeft(true)}
            onKeyDown={shortcut}
          />
          {titleMissing && (
            <p
              id={`${titleId}-error`}
              className="flex items-center gap-1.5 text-[12px]"
            >
              <CircleAlert
                aria-hidden="true"
                size={14}
                className="text-error"
              />
              <Trans>Give the task a title.</Trans>
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={descriptionId} className="text-[11.5px] text-muted">
            <Trans>Description · optional</Trans>
          </label>
          <textarea
            id={descriptionId}
            rows={8}
            placeholder={t`What is done when the task ends, and what the runner's agent needs to know.`}
            className="textarea w-full border-line bg-base-200 px-3 py-2.5 text-[13px] leading-[1.5]"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            onKeyDown={shortcut}
          />
        </div>
      </div>

      <aside className="min-w-0 border-t border-line px-[14px] py-5 lg:border-t-0 lg:border-l lg:px-5">
        <WorkflowSteps steps={chosen?.steps ?? []} />
      </aside>
    </form>
  );
}

export type CreateTaskActionsProps = {
  // The id of the CreateTaskForm the button submits.
  form: string;
  cancelHref: string;
  pending?: boolean;
};

// The page header's actions for a CreateTaskForm: they sit outside the form,
// so they stay in sight however long the description gets.
export function CreateTaskActions({
  form,
  cancelHref,
  pending = false,
}: Readonly<CreateTaskActionsProps>) {
  return (
    <>
      <a
        href={cancelHref}
        className="btn btn-ghost btn-sm border-line text-[12.5px] font-medium"
      >
        <Trans>Cancel</Trans>
      </a>
      <button
        type="submit"
        form={form}
        disabled={pending}
        className="btn btn-primary btn-sm text-[12.5px] font-medium"
      >
        {pending ? (
          <>
            <span
              aria-hidden="true"
              className="loading loading-spinner loading-xs"
            />
            <Trans>Creating</Trans>
          </>
        ) : (
          <Trans>Create task</Trans>
        )}
      </button>
    </>
  );
}
