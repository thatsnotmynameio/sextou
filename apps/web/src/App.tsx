import { useEffect, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { Button } from '@sextou/ui';
import { platform } from './platform';

export function App() {
  // A stand-in for the unread count until there is an inbox.
  const [count, setCount] = useState(0);

  useEffect(() => {
    platform.setBadgeCount(count);
  }, [count]);

  return (
    <main>
      <h1>sextou</h1>
      <Button onClick={() => setCount((n) => n + 1)}>
        <Trans>Hello</Trans>
      </Button>
      <Button onClick={() => setCount(0)}>
        <Trans>Reset</Trans>
      </Button>
    </main>
  );
}
