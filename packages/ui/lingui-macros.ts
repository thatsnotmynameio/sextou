import type { Plugin } from 'vite';
import { transform } from '@lingui/native-tools';

// Compiles Lingui's macros with Lingui's native transform, for Storybook and
// the desktop renderer. @lingui/vite-plugin would do the same, but it pulls in
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
        const filename = id.replace(/\?.*$/, '');
        const result = await transform(code, filename, {
          macro: { descriptorFields: 'message' },
        });
        return { code: result.code, map: result.map };
      },
    },
  };
}
