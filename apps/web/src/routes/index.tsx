import { createFileRoute } from '@tanstack/react-router';
import { HealthPage } from '../modules/health/index';

export const Route = createFileRoute('/')({ component: Home });

function Home() {
  const { trpc } = Route.useRouteContext();
  return <HealthPage trpc={trpc} />;
}
