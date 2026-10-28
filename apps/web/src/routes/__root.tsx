import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  createRootRouteWithContext,
  Outlet,
  useLocation,
  useMatches,
} from '@tanstack/react-router';
import { HeartPulse } from 'lucide-react';
import { AppShell } from '@sextou/ui';
import type { RouterContext } from '../router';

// The layout every page shares: the navigation, the header with the title the
// page's route declares, and the footer.
export const Route = createRootRouteWithContext<RouterContext>()({
  component: Root,
});

function Root() {
  const { i18n } = useLingui();
  const { serverUrl } = Route.useRouteContext();
  const { pathname } = useLocation();
  const title = useMatches({
    select: (matches) => matches.at(-1)?.staticData.title,
  });

  return (
    <AppShell
      brand="sextou"
      sections={[
        {
          id: 'main',
          links: [
            {
              label: <Trans>Server health</Trans>,
              href: '/',
              icon: HeartPulse,
              current: pathname === '/',
            },
          ],
        },
      ]}
      title={title ? i18n._(title) : 'sextou'}
      footer={
        <span>
          <Trans>
            Server <span className="font-mono">{serverUrl}</span>
          </Trans>
        </span>
      }
    >
      <Outlet />
    </AppShell>
  );
}
