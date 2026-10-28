import type { ReactNode, Ref } from 'react';
import { Trans } from '@lingui/react/macro';
import { CircleAlert, type LucideIcon } from 'lucide-react';

export type PropertyPillProps = {
  // The id of the popover the pill opens, which also names its anchor.
  target: string;
  name: string;
  icon: LucideIcon;
  value?: ReactNode;
  invalid: boolean;
  ref?: Ref<HTMLButtonElement>;
};

// The button that names a property and shows its value, or only its name while
// it has none, and opens the popover that sets it. A missing one gets the
// error's border and icon, and says so to a screen reader, since a button
// takes no aria-invalid; its text keeps the theme's, since business's error
// color reads too dark as text.
export function PropertyPill({
  target,
  name,
  icon: Icon,
  value,
  invalid,
  ref,
}: Readonly<PropertyPillProps>) {
  return (
    <button
      ref={ref}
      type="button"
      popoverTarget={target}
      style={{ anchorName: `--${target}` }}
      className={
        invalid
          ? 'btn btn-ghost btn-sm border-error text-[12.5px] font-normal'
          : 'btn btn-ghost btn-sm border-line text-[12.5px] font-normal'
      }
    >
      {invalid ? (
        <CircleAlert aria-hidden="true" size={14} className="text-error" />
      ) : (
        <Icon aria-hidden="true" size={14} className="text-muted" />
      )}
      <span className="text-muted">{name}</span>
      {/* The space keeps the name and the value apart in the button's accessible name. */}
      {value !== undefined && (
        <>
          {' '}
          <span className="font-medium">{value}</span>
        </>
      )}
      {invalid && (
        <>
          {' '}
          <span className="sr-only">
            <Trans>missing</Trans>
          </span>
        </>
      )}
    </button>
  );
}
