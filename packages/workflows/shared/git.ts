// The environment a script's git runs with: the runner's own, with `home`, an
// empty folder of the script's own, as its HOME, so no .netrc of the
// runner's user hands a server a password.
//
// A repository that asks for credentials fails at once instead of waiting on
// a prompt no one answers: no secret comes from the server. Nor does git read
// the configuration of the runner's user or system, whose credential helpers
// would hand a private repository the user's token, and whose URL rewrites,
// hooks and output settings would change the run, nor take a setting from the
// runner's environment: every GIT_ variable goes but the certificate file git
// trusts, and SSH_ASKPASS, which git asks for a password too, and NETRC,
// which names another .netrc.
export function gitEnv(
  env: NodeJS.ProcessEnv,
  home: string,
): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(env).filter(
        ([name]) =>
          name !== 'SSH_ASKPASS' &&
          name !== 'NETRC' &&
          (!name.startsWith('GIT_') || name === 'GIT_SSL_CAINFO'),
      ),
    ),
    HOME: home,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
  };
}
