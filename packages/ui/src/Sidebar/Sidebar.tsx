import { useLingui } from '@lingui/react/macro';
import type { NavItemProps } from '../NavItem/NavItem';
import {
  NavList,
  NavSection,
  type NavSectionProps,
} from '../NavSection/NavSection';
import {
  WorkspaceHeader,
  type WorkspaceHeaderProps,
} from '../WorkspaceHeader/WorkspaceHeader';

export type SidebarProps = {
  workspace: WorkspaceHeaderProps;
  items: NavItemProps[];
  sections: NavSectionProps[];
};

export function Sidebar({ workspace, items, sections }: SidebarProps) {
  const { t } = useLingui();
  return (
    <nav
      aria-label={t`Main navigation`}
      className="flex w-[232px] flex-col gap-5 bg-sidebar px-2.5 py-3 font-sans text-[13px]/[1.4] text-text"
    >
      <WorkspaceHeader {...workspace} />
      <NavList items={items} />
      {sections.map((section, index) => (
        <NavSection key={index} {...section} />
      ))}
    </nav>
  );
}
