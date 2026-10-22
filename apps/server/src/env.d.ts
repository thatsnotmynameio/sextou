// TypeScript 7 loads no @types package unless asked: this gives the server's
// sources Node's globals and node: modules, in this tsconfig and the root's.
/// <reference types="node" />

// The folder of @sextou/tasks' migrations, relative to the bundle: defined
// only by the production build (vite.config.mts), undeclared from source.
declare const __TASKS_MIGRATIONS__: string | undefined;
