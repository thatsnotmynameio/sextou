import { msg } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { HealthPage } from '../modules/health/index';

export const Route = createFileRoute('/')({
  component: Home,
  staticData: { title: msg`Server health` },
});

function Home() {
  const { trpc } = Route.useRouteContext();
  return <HealthPage trpc={trpc} />;
}
