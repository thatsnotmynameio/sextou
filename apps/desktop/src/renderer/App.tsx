import { Button } from '@sextou/ui';

export function App() {
  return (
    <main>
      <h1>sextou</h1>
      <Button onClick={() => console.log('clicked')}>Hello</Button>
    </main>
  );
}
