// What the window does with a URL it is asked to show or open: stay on it
// when it belongs to the web app, hand it to the default browser or mail app
// when it is another site, and drop anything else (file:, data:, other apps'
// schemes), which the operating system would otherwise launch.
export type LinkAction = 'allow' | 'external' | 'block';

export function linkAction(webAppURL: string, url: string): LinkAction {
  const target = URL.parse(url);
  if (!target) {
    return 'block';
  }
  if (target.protocol === 'mailto:') {
    return 'external';
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return 'block';
  }
  // An empty or unparseable web app URL matches nothing, so its pages can't
  // be confused with another site's.
  const webApp = URL.parse(webAppURL);
  return webApp?.origin === target.origin ? 'allow' : 'external';
}
