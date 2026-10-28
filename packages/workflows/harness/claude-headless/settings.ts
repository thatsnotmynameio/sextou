// claude -p's arguments for a context: -p first, each option as
// --name=value, so a value that starts with - is never read as another
// option. The prompt goes through claude's stdin, never as an argument.
export type ReadArgs =
  | { ok: true; args: string[] }
  | { ok: false; reason: string };

// How an option of claude's CLI reads its value from the context:
//
//   text    a string: --name=value
//   joined  a string, or a list of strings joined with commas
//   number  a finite number
//   list    a string, or a list of strings: one --name=item for each
//   json    an object, written as JSON, or a string: a file's path or JSON
//   jsons   one json, or a list of them: one --name=item for each
//
// An empty list, which would pass no argument and leave claude's default as
// it is, is refused: tools: [] would give claude every tool. An empty
// string is what says none, as claude's --tools "".
//   flag    true adds --name, false leaves it out
type Kind = 'text' | 'joined' | 'number' | 'list' | 'json' | 'jsons' | 'flag';

// The options of claude's CLI a context may set, each under the option's
// name in camelCase (allowedTools for --allowed-tools), in the order they
// reach claude. The value is checked only for its type: claude refuses a
// value it doesn't take, so a value a newer claude adds needs no change
// here. Left out: the options of an interactive session (--chrome, --ide,
// --tmux and the like), those that resume a conversation the runner doesn't
// have (--continue, --resume), those that would read the prompt otherwise
// (--input-format), and --debug and --debug-file, claude's diagnostics, not
// the run's output.
const options: Record<string, Kind> = {
  model: 'text',
  fallbackModel: 'joined',
  effort: 'text',
  agent: 'text',
  agents: 'json',
  systemPrompt: 'text',
  appendSystemPrompt: 'text',
  permissionMode: 'text',
  permissionPrompts: 'text',
  dangerouslySkipPermissions: 'flag',
  allowDangerouslySkipPermissions: 'flag',
  tools: 'list',
  allowedTools: 'list',
  disallowedTools: 'list',
  addDir: 'list',
  settings: 'json',
  settingSources: 'joined',
  mcpConfig: 'jsons',
  strictMcpConfig: 'flag',
  pluginDir: 'list',
  pluginUrl: 'list',
  bare: 'flag',
  safeMode: 'flag',
  restricted: 'flag',
  disableSlashCommands: 'flag',
  excludeDynamicSystemPromptSections: 'flag',
  jsonSchema: 'json',
  maxBudgetUsd: 'number',
  autocompact: 'text',
  betas: 'list',
  name: 'text',
  sessionId: 'text',
  noSessionPersistence: 'flag',
  outputFormat: 'text',
  verbose: 'flag',
  includePartialMessages: 'flag',
  includeHookEvents: 'flag',
  forwardSubagentText: 'flag',
};

// What each kind takes, said in a refusal.
const expected: Record<Kind, string> = {
  text: 'a string',
  joined: 'a string or a list of strings',
  number: 'a number',
  list: 'a string or a non-empty list of strings',
  json: 'an object or a string',
  jsons: 'an object, a string or a non-empty list of them',
  flag: 'true or false',
};

// A worktree's name: letters, digits, _, . and -, not starting with -.
const worktreeName = /^[\w.][\w.-]*$/;

// Reads claude's arguments from the fields of the task's context, which the
// agnostic core already read the prompt and the path from:
//
//   worktree  true, or a name: claude works in a new git worktree of the
//             repository at path, which it creates
//
// and the options `options` lists. Every other key is left for the core or
// the other steps of the run, such as a checkout before it.
export function readArgs(fields: Record<string, unknown>): ReadArgs {
  const { worktree } = fields;
  const args = ['-p'];
  if (worktree === true) {
    args.push('--worktree');
  } else if (
    typeof worktree === 'string' &&
    worktreeName.test(worktree) &&
    worktree !== '.' &&
    worktree !== '..'
  ) {
    args.push(`--worktree=${worktree}`);
  } else if (worktree !== undefined && worktree !== false) {
    return refuse('worktree is true, false or a name');
  }

  for (const [key, kind] of Object.entries(options)) {
    const value = fields[key];
    if (value === undefined) {
      continue;
    }
    const values = readers[kind](value);
    if (values === undefined) {
      return refuse(`${key} is ${expected[kind]}`);
    }
    const flag = `--${kebabCase(key)}`;
    args.push(
      ...values.map((item) => (item === true ? flag : `${flag}=${item}`)),
    );
  }

  return { ok: true, args };
}

// allowedTools as allowed-tools.
function kebabCase(name: string) {
  return name.replaceAll(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

// The values each kind reads from a context value, each one argument, true
// for the option alone; undefined when it isn't what the kind takes.
const readers: Record<
  Kind,
  (value: unknown) => (string | number | true)[] | undefined
> = {
  text: (value) => (text(value) ? [value] : undefined),
  joined: (value) => {
    const items = text(value) ? [value] : value;
    return texts(items) ? [items.join(',')] : undefined;
  },
  // Only a number is finite: not a string of one.
  number: (value) => (Number.isFinite(value) ? [value as number] : undefined),
  list: (value) => {
    const items = text(value) ? [value] : value;
    return texts(items) && items.length > 0 ? items : undefined;
  },
  json,
  jsons: (value) => {
    const items = (Array.isArray(value) ? value : [value]).map(json);
    return items.length > 0 &&
      items.every((item): item is [string] => item !== undefined)
      ? items.flat()
      : undefined;
  },
  flag: (value) => {
    if (typeof value !== 'boolean') {
      return undefined;
    }
    return value ? [true] : [];
  },
};

// A string an argument can carry: spawn throws on a NUL.
function text(value: unknown): value is string {
  return typeof value === 'string' && !value.includes('\0');
}

function texts(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(text);
}

// An object, written as JSON, or a string as it is.
function json(value: unknown): [string] | undefined {
  if (text(value)) {
    return [value];
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? [JSON.stringify(value)]
    : undefined;
}

function refuse(reason: string): ReadArgs {
  return { ok: false, reason };
}

// How long claude may take: an hour unless CLAUDE_HEADLESS_TIMEOUT_MS, from
// the runner's environment, sets another.
export const defaultTimeoutMs = 3_600_000;
