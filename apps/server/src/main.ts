// The server's entry point: `pnpm --filter @sextou/server dev` runs it from
// source, dist/server.mjs is its build.
import packageJson from '../package.json';
import { createApp } from './app';
import { loadConfig } from './config';
import { startServer } from './server';

const config = loadConfig(process.env, process.argv.slice(2));
const app = createApp({
  version: packageJson.version,
  startedAt: new Date(),
  now: () => new Date(),
});
const { host, port } = await startServer(app, config);
// A URL needs an IPv6 address in brackets.
const urlHost = host.includes(':') ? `[${host}]` : host;
console.log(`listening on http://${urlHost}:${port}`);
