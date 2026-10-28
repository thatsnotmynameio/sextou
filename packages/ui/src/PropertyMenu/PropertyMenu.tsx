import { useId, useRef, type ReactNode, type Ref } from 'react';
import { Check, type LucideIcon } from 'lucide-react';
import { PropertyPill } from './PropertyPill';

export type PropertyOption<T extends string | number> = {
  value: T;
  label: ReactNode;
  icon: LucideIcon;
  description?: ReactNode;
};

export type PropertyMenuProps<T extends string | number> = {
  name: string;
  // Shown on the pill while no option is chosen.
  icon: LucideIcon;
  options: PropertyOption<T>[];
  value?: T;
  onChange: (value: T) => void;
  invalid?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

// A property set from a fixed list: the pill opens the list, and choosing an
// option closes it.
export function PropertyMenu<T extends string | number>({
  name,
  icon,
  options,
  value,
  onChange,
  invalid = false,
  ref,
}: Readonly<PropertyMenuProps<T>>) {
  const id = useId();
  const menu = useRef<HTMLUListElement>(null);
  const chosen = options.find((option) => option.value === value);
  // Options that explain themselves need the room for a line of text.
  const described = options.some((option) => option.description);

  return (
    <>
      <PropertyPill
        ref={ref}
        target={id}
        name={name}
        icon={chosen?.icon ?? icon}
        value={chosen?.label}
        invalid={invalid}
      />
      <ul
        ref={menu}
        id={id}
        popover="auto"
        aria-label={name}
        style={{ positionAnchor: `--${id}` }}
        className={
          described
            ? 'dropdown menu menu-sm w-80 rounded-box border border-line bg-base-200 p-1 text-[13px] shadow-md'
            : 'dropdown menu menu-sm w-48 rounded-box border border-line bg-base-200 p-1 text-[13px] shadow-md'
        }
      >
        {options.map((option) => {
          const current = option.value === value;
          return (
            <li key={option.value}>
              <button
                type="button"
                aria-current={current ? 'true' : undefined}
                className={option.description ? 'items-start' : undefined}
                onClick={() => {
                  onChange(option.value);
                  // Stryker disable next-line OptionalChaining: the option sits in the menu, so the menu is mounted whenever it is clicked
                  menu.current?.hidePopover();
                }}
              >
                <option.icon
                  aria-hidden="true"
                  size={14}
                  className={
                    option.description ? 'mt-0.5 shrink-0' : 'shrink-0'
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block">{option.label}</span>
                  {option.description && (
                    <span className="block text-[12px] text-muted">
                      {option.description}
                    </span>
                  )}
                </span>
                {current && (
                  <Check aria-hidden="true" size={14} className="shrink-0" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
