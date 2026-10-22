// The only way into @sextou/tasks: no other server code imports it. Only
// main.ts imports this module, since the library needs Node, and router.ts
// and trpc.ts, which the web app's typecheck follows, must not.
export { initTasks } from './init';
