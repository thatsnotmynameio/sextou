// The web app's only route to native features. In the desktop app, Electron
// routes the Badging API to the native app badge, so one implementation
// serves both.
export interface Platform {
  // Shows count on the app badge; 0 clears it. Does nothing where the
  // browser has no app badge.
  setBadgeCount(count: number): void;
}

export const platform: Platform = {
  setBadgeCount(count) {
    // The DOM types declare setAppBadge as always present; Firefox lacks it.
    if (!('setAppBadge' in navigator)) return;
    const badge =
      count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge();
    // A tab that isn't an installed app, or has no permission, rejects: there
    // is no badge to show.
    badge.catch(() => undefined);
  },
};
