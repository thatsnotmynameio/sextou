import { fc, test } from '@fast-check/vitest';
import { expect } from 'vitest';
import { linkAction } from '../../../src/main/link-policy';

// The experiment's properties of linkAction: the window stays only on the web
// app's origin, and the default browser or mail app gets only http, https and
// mailto URLs.

const authority = {
  withIPv4: true,
  withIPv6: true,
  withPort: true,
  withUserInfo: true,
};
const webUrl = fc.webUrl({
  validSchemes: ['http', 'https'],
  authoritySettings: authority,
  withQueryParameters: true,
  withFragments: true,
});
// Any text, URLs of every scheme, and tricky spellings of a web URL.
const target = fc.oneof(
  fc.string(),
  fc.webUrl({
    validSchemes: ['http', 'https', 'ftp', 'file', 'ws', 'wss', 'mailto'],
    authoritySettings: authority,
  }),
  fc
    .tuple(fc.stringMatching(/^[A-Za-z][A-Za-z0-9+.-]{0,10}$/), fc.string())
    .map(([scheme, rest]) => `${scheme}:${rest}`),
  fc
    .tuple(webUrl, fc.constantFrom('', '.', '..', '%2e', '\t', ' '))
    .map(([url, noise]) => url.replace('//', `//${noise}`)),
);

const runs = { numRuns: Number(process.env.LINK_PROPERTY_RUNS ?? 100) };

test.prop([webUrl, target], runs)(
  'linkAction hands nothing but an http, https or mailto URL past the window',
  (webApp, url) => {
    const action = linkAction(webApp, url);
    if (action !== 'block') {
      expect(['http:', 'https:', 'mailto:']).toContain(
        URL.parse(url)?.protocol,
      );
    }
  },
);

test.prop([webUrl, target], runs)(
  'linkAction keeps the window only on the web app origin',
  (webApp, url) => {
    if (linkAction(webApp, url) === 'allow') {
      expect(URL.parse(url)?.origin).toBe(URL.parse(webApp)?.origin);
    }
  },
);

test.prop(
  [
    webUrl,
    fc.webPath(),
    fc.webQueryParameters(),
    fc.webFragments(),
    fc.boolean(),
  ],
  runs,
)(
  'linkAction allows any page on the web app origin, whatever the case of its scheme and host',
  (webApp, path, query, fragment, shout) => {
    const origin = URL.parse(webApp)?.origin ?? '';
    const page = `${shout ? origin.toUpperCase() : origin}${path}?${query}#${fragment}`;
    expect(linkAction(webApp, page)).toBe('allow');
  },
);

test.prop([webUrl, webUrl], runs)(
  'linkAction opens an http or https URL of another origin externally',
  (webApp, url) => {
    fc.pre(URL.parse(webApp)?.origin !== URL.parse(url)?.origin);
    expect(linkAction(webApp, url)).toBe('external');
  },
);

test.prop(
  [
    webUrl,
    fc.domain(),
    fc.constantFrom('userinfo', 'suffix', 'port', 'trailing dot', 'scheme'),
  ],
  runs,
)(
  'linkAction opens externally a URL that only looks like the web app origin',
  (webApp, other, trick) => {
    const app = new URL(webApp);
    fc.pre(app.hostname !== '' && !app.hostname.endsWith('.'));
    const host = app.host;
    const looksAlike = {
      userinfo: `${app.protocol}//${host}@${other}/`,
      suffix: `${app.protocol}//${app.hostname}.${other}/`,
      port: `${app.protocol}//${app.hostname}:${app.port === '1' ? '2' : '1'}/`,
      'trailing dot': `${app.protocol}//${app.hostname}./`,
      scheme: `${app.protocol === 'https:' ? 'http:' : 'https:'}//${host}/`,
    }[trick];
    // A trick that leaves no URL (a suffix after an IPv6 address) is
    // blocked, and one that makes the host equal again is the same origin;
    // the property is about the URLs that parse to another origin.
    const parsed = URL.parse(looksAlike);
    fc.pre(parsed !== null && parsed.origin !== app.origin);
    expect(linkAction(webApp, looksAlike)).toBe('external');
  },
);

test.prop(
  [
    fc.oneof(
      fc.constant(''),
      fc.string().filter((text) => URL.parse(text) === null),
    ),
    target,
  ],
  runs,
)(
  'linkAction allows nothing when the web app URL does not parse',
  (webApp, url) => {
    expect(linkAction(webApp, url)).not.toBe('allow');
  },
);
