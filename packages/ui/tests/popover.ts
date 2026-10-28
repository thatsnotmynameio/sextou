import { afterEach, beforeEach } from 'vitest';

// jsdom hides a closed popover but has no API to open or hide one. Called at
// the top of a test file, this shows every popover, as if open, and makes
// hiding one do nothing.
export function stubPopovers() {
  let shown: HTMLStyleElement;
  beforeEach(() => {
    HTMLElement.prototype.hidePopover = () => {};
    shown = document.createElement('style');
    // jsdom's own rule outranks an author's that isn't important.
    shown.textContent = '[popover] { display: block !important; }';
    document.head.append(shown);
  });
  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'hidePopover');
    shown.remove();
  });
}

// The popover a pill opens, which it names by id.
export function popoverOf(pill: HTMLElement) {
  const popover = document.getElementById(
    pill.getAttribute('popovertarget') ?? '',
  );
  if (!popover) {
    throw new Error('the pill names no popover');
  }
  return popover;
}

// A popover's toggle, or the one before it, to the given state, as the browser fires them.
export function toggleEvent(
  type: 'toggle' | 'beforetoggle',
  newState: 'open' | 'closed',
) {
  return Object.assign(new Event(type), {
    newState,
    oldState: newState === 'open' ? 'closed' : 'open',
  });
}
