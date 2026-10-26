import type { Plugin } from 'vite';
import { transform } from '@lingui/native-tools';

// Compiles Lingui's macros with Lingui's native transform, for Storybook and
// the web app. @lingui/vite-plugin would do the same, but it pulls in
// @lingui/cli, which depends on braces (GHSA-vfj7-8cjw-p6xm, no fixed release).
// Each message keeps its source text in production builds: there are no
// compiled catalogs yet, so the runtime compiles the English text.
export function linguiMacros(): Plugin {
  return {
    name: 'lingui-macros',
    enforce: 'pre',
    transform: {
      filter: {
        id: /\.(?:[jt]sx?|[cm][jt]s)(?:$|\?)/,
        code: /@lingui\/[\w-]+\/macro/,
      },
      async handler(code, id) {
        // The id without its query, cut at the first ? rather than with
        // /\?.*$/, which backtracks from every ? in it.
        const query = id.indexOf('?');
        const filename = query === -1 ? id : id.slice(0, query);
        const result = await transform(code, filename, {
          macro: { descriptorFields: 'message' },
        });
        return { code: result.code, map: result.map };
      },
    },
  };
}
