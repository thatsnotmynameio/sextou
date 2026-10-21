import { afterEach, expect, test, vi } from 'vitest';
import { platform } from './platform';

// jsdom has no Badging API: each test adds the methods it needs to navigator.
function stubBadging(
  setAppBadge: (contents?: number) => Promise<void> = vi.fn(() =>
    Promise.resolve(),
  ),
) {
  const clearAppBadge = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, 'setAppBadge', {
    configurable: true,
    value: setAppBadge,
  });
  Object.defineProperty(navigator, 'clearAppBadge', {
    configurable: true,
    value: clearAppBadge,
  });
  return { setAppBadge, clearAppBadge };
}

afterEach(() => {
  delete (navigator as Partial<Navigator>).setAppBadge;
  delete (navigator as Partial<Navigator>).clearAppBadge;
});

test('platform.setBadgeCount shows the count through the Badging API', () => {
  const { setAppBadge, clearAppBadge } = stubBadging();
  platform.setBadgeCount(3);
  expect(setAppBadge).toHaveBeenCalledWith(3);
  expect(clearAppBadge).not.toHaveBeenCalled();
});

test('platform.setBadgeCount clears the badge for 0', () => {
  const { setAppBadge, clearAppBadge } = stubBadging();
  platform.setBadgeCount(0);
  expect(clearAppBadge).toHaveBeenCalledOnce();
  expect(setAppBadge).not.toHaveBeenCalled();
});

test('platform.setBadgeCount does nothing where the browser has no Badging API', () => {
  expect('setAppBadge' in navigator).toBe(false);
  expect(() => platform.setBadgeCount(2)).not.toThrow();
});

// Vitest fails the run on an unhandled rejection, so this test fails if the
// rejection escapes. A plain function, not vi.fn: vi.fn subscribes to the
// promises it returns, which would mark the rejection handled.
test('platform.setBadgeCount ignores a call the browser rejects', async () => {
  let calledWith: number | undefined;
  stubBadging((contents?: number) => {
    calledWith = contents;
    return Promise.reject(new DOMException('Not installed', 'NotAllowedError'));
  });
  platform.setBadgeCount(1);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calledWith).toBe(1);
});
