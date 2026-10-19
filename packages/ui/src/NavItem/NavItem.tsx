import type { AnchorHTMLAttributes, ComponentType, ReactNode } from 'react';
import type { IconProps } from '../Icon/Icon';

// An item shows a highlighted badge (as on Inbox) or a plain count (as on Reviews), never both.
type Tally =
  | { badge?: number; count?: never }
  | { count?: number; badge?: never };

export type NavItemProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'children' | 'className'
> &
  Tally & {
    icon: ComponentType<IconProps>;
    label: ReactNode;
    active?: boolean;
  };

export function NavItem({
  icon: Icon,
  label,
  badge,
  count,
  active = false,
  ...props
}: NavItemProps) {
  return (
    <a
      aria-current={active ? 'page' : undefined}
      className={`flex h-8 items-center gap-2.5 rounded-md px-2 outline-accent hover:text-strong focus-visible:outline-2 ${active ? 'bg-active text-strong' : 'text-item'}`}
      {...props}
    >
      <Icon className={`shrink-0 ${active ? 'text-accent' : 'text-muted'}`} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge !== undefined && (
        <span className="inline-flex h-[18px] min-w-5 items-center justify-center rounded-[9px] bg-badge px-1.5 text-[11px] font-semibold text-badge-text">
          {badge}
        </span>
      )}
      {count !== undefined && (
        <span
          className={`text-[11px] ${active ? 'text-badge-text' : 'text-count'}`}
        >
          {count}
        </span>
      )}
    </a>
  );
}
