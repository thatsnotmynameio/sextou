import { useLingui } from '@lingui/react/macro';
import { ChevronDownIcon, NewIssueIcon, SearchIcon } from '../Icon/Icon';

export type WorkspaceHeaderProps = {
  name: string;
  initial: string;
  onSwitchWorkspace?: () => void;
  onSearch?: () => void;
  onNewIssue?: () => void;
};

// Stryker disable BlockStatement: emptying the body moves useLingui() out of the place Lingui's macro rewrites, so it would fail to compile, not to pass
export function WorkspaceHeader({
  name,
  initial,
  onSwitchWorkspace,
  onSearch,
  onNewIssue,
}: WorkspaceHeaderProps) {
  const { t } = useLingui();
  // Stryker restore BlockStatement
  return (
    <div className="flex items-center gap-2 px-1.5 py-0.5">
      <button
        type="button"
        aria-label={t`Switch workspace`}
        onClick={onSwitchWorkspace}
        className="flex min-w-0 items-center gap-2 rounded-md text-muted outline-accent hover:text-strong focus-visible:outline-2"
      >
        <span className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-md bg-workspace text-[12px] font-bold text-strong">
          {initial}
        </span>
        <span className="truncate text-[14px] font-semibold text-strong">
          {name}
        </span>
        <ChevronDownIcon width={14} height={14} className="shrink-0" />
      </button>
      <span className="flex-1" />
      <button
        type="button"
        aria-label={t`Search`}
        onClick={onSearch}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-item outline-accent hover:text-strong focus-visible:outline-2"
      >
        <SearchIcon />
      </button>
      <button
        type="button"
        aria-label={t`New issue`}
        onClick={onNewIssue}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-raised text-item outline-accent hover:text-strong focus-visible:outline-2"
      >
        <NewIssueIcon />
      </button>
    </div>
  );
}
