import type { ReactNode } from 'react';
import { NavItem, type NavItemProps } from '../NavItem/NavItem';

export function NavList({ items }: { items: NavItemProps[] }) {
  return (
    <ul className="flex flex-col gap-px">
      {items.map((item, index) => (
        <li key={index}>
          <NavItem {...item} />
        </li>
      ))}
    </ul>
  );
}

export type NavSectionProps = {
  title: ReactNode;
  items: NavItemProps[];
};

export function NavSection({ title, items }: NavSectionProps) {
  return (
    <div className="flex flex-col gap-px">
      <p className="mb-1 px-2 text-[12px] font-medium text-muted">{title}</p>
      <NavList items={items} />
    </div>
  );
}
