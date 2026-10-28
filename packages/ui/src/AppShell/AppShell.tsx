import { useId, useState, type ReactNode } from 'react';
import { useLingui } from '@lingui/react/macro';
import { Menu, type LucideIcon } from 'lucide-react';

export type AppShellLink = {
  label: ReactNode;
  href: string;
  icon: LucideIcon;
  current?: boolean;
};

// A group of links in the navigation, under its title when it has one.
export type AppShellSection = {
  title?: ReactNode;
  links: AppShellLink[];
};

export type AppShellProps = {
  brand: ReactNode;
  sections: AppShellSection[];
  title: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

// The frame every page shares: the navigation beside the page on large
// screens, and behind a button on small ones; the page's header, its content
// and the footer.
// Stryker disable BlockStatement: emptying the body moves useLingui() out of the place Lingui's macro rewrites, so it would fail to compile, not to pass
export function AppShell({
  brand,
  sections,
  title,
  actions,
  footer,
  children,
}: AppShellProps) {
  // Stryker restore BlockStatement
  const { t } = useLingui();
  const toggle = useId();
  const [open, setOpen] = useState(false);

  return (
    <div
      className="drawer min-h-screen bg-base-100 font-sans text-base-content lg:drawer-open"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setOpen(false);
        }
      }}
    >
      {/* daisyUI's drawer shows the navigation from this checkbox; the buttons, not the user, set it. */}
      <input
        id={toggle}
        type="checkbox"
        className="drawer-toggle"
        tabIndex={-1}
        aria-hidden="true"
        aria-label={t`Navigation open`}
        checked={open}
        readOnly
      />
      <div className="drawer-content flex min-h-screen min-w-0 flex-col">
        <header className="navbar min-h-14 gap-2 border-b border-base-300 px-4 lg:px-6">
          <button
            type="button"
            className="btn btn-square btn-ghost btn-sm drawer-button lg:hidden"
            aria-label={t`Open navigation`}
            aria-controls={`${toggle}-navigation`}
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Menu aria-hidden="true" size={18} />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">
            {title}
          </h1>
          {actions && (
            <div className="flex flex-none items-center gap-2">{actions}</div>
          )}
        </header>
        <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
        {footer && (
          <footer className="footer border-t border-base-300 px-4 py-2 text-sm text-base-content/70 lg:px-6">
            {/* daisyUI's footer stacks what each of its children holds; the status reads as one line. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {footer}
            </div>
          </footer>
        )}
      </div>
      <div className="drawer-side z-10">
        {/* Only where the navigation covers the page is there anything to close. */}
        <button
          type="button"
          className="drawer-overlay lg:hidden"
          aria-label={t`Close navigation`}
          tabIndex={-1}
          onClick={() => setOpen(false)}
        />
        <nav
          id={`${toggle}-navigation`}
          aria-label={t`Main navigation`}
          className="flex min-h-full w-60 flex-col border-r border-base-300 bg-base-200 p-2"
        >
          <div className="px-4 py-2 text-base font-semibold">{brand}</div>
          <ul className="menu w-full">
            {sections.map((section, index) =>
              section.title ? (
                <li key={index}>
                  <h2 className="menu-title">{section.title}</h2>
                  <ul>
                    {section.links.map((link) => (
                      <Link
                        key={link.href}
                        link={link}
                        onFollow={() => setOpen(false)}
                      />
                    ))}
                  </ul>
                </li>
              ) : (
                section.links.map((link) => (
                  <Link
                    key={link.href}
                    link={link}
                    onFollow={() => setOpen(false)}
                  />
                ))
              ),
            )}
          </ul>
        </nav>
      </div>
    </div>
  );
}

// Following a link closes the navigation, which matters where it covers the page.
function Link({
  link: { label, href, icon: Icon, current = false },
  onFollow,
}: {
  link: AppShellLink;
  onFollow: () => void;
}) {
  return (
    <li>
      <a
        href={href}
        aria-current={current ? 'page' : undefined}
        className={current ? 'menu-active' : undefined}
        onClick={onFollow}
      >
        <Icon aria-hidden="true" size={16} />
        {label}
      </a>
    </li>
  );
}
