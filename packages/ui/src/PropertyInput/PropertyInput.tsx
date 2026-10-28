import { useId, useRef, useState, type ReactNode, type Ref } from 'react';
import type { LucideIcon } from 'lucide-react';
import { PropertyPill } from '../PropertyMenu/PropertyPill';

export type PropertyInputProps = {
  name: string;
  icon: LucideIcon;
  // The value set, or '' while there is none.
  value: string;
  suggestions: string[];
  placeholder?: string;
  // Below the suggestions, such as what Enter does.
  hint?: ReactNode;
  onChange: (value: string) => void;
  invalid?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

// A property any text can set: the pill opens a field with suggestions, which
// narrow as the person types; a suggestion, or Enter on what was typed, sets it
// and closes the field.
export function PropertyInput({
  name,
  icon,
  value,
  suggestions,
  placeholder,
  hint,
  onChange,
  invalid = false,
  ref,
}: Readonly<PropertyInputProps>) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value);
  // The field opens with the current value, and every suggestion until the person types.
  const [typed, setTyped] = useState(false);
  const query = text.trim().toLowerCase();
  const shown = typed
    ? suggestions.filter((suggestion) =>
        suggestion.toLowerCase().includes(query),
      )
    : suggestions;

  const choose = (chosen: string) => {
    const trimmed = chosen.trim();
    if (trimmed === '') {
      return;
    }
    onChange(trimmed);
    // Stryker disable next-line OptionalChaining: the popover holds the field and the suggestions, so it is mounted whenever one of them chooses
    box.current?.hidePopover();
  };

  return (
    <>
      <PropertyPill
        ref={ref}
        target={id}
        name={name}
        icon={icon}
        value={value === '' ? undefined : value}
        invalid={invalid}
      />
      <div
        ref={box}
        id={id}
        popover="auto"
        style={{ positionAnchor: `--${id}` }}
        className="dropdown w-56 rounded-box border border-line bg-base-200 p-1 text-[13px] shadow-md"
        onBeforeToggle={(event) => {
          if (event.newState === 'open') {
            setText(value);
            setTyped(false);
          }
        }}
        onToggle={(event) => {
          if (event.newState === 'open') {
            // Stryker disable OptionalChaining: the popover holds the field, so it is mounted whenever the popover opens
            field.current?.focus();
            field.current?.select();
            // Stryker restore OptionalChaining
          }
        }}
      >
        <input
          ref={field}
          type="text"
          aria-label={name}
          placeholder={placeholder}
          autoComplete="off"
          className="input input-sm w-full text-[13px]"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setTyped(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              choose(text);
            }
          }}
        />
        {shown.length > 0 && (
          <ul className="menu menu-sm w-full px-0">
            {shown.map((suggestion) => (
              <li key={suggestion}>
                <button type="button" onClick={() => choose(suggestion)}>
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        )}
        {hint && <p className="px-2 py-1 text-[11.5px] text-muted">{hint}</p>}
      </div>
    </>
  );
}
