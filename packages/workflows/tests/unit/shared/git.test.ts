import { expect, test } from 'vitest';
import { gitEnv } from '../../../shared/git';

const home = '/tmp/home';

test('gitEnv keeps GIT_SSL_CAINFO, the certificate file git trusts', () => {
  expect(gitEnv({ GIT_SSL_CAINFO: '/ca.pem' }, home).GIT_SSL_CAINFO).toBe(
    '/ca.pem',
  );
});

test.each([
  'GIT_DIR',
  'GIT_ASKPASS',
  'GIT_CONFIG_PARAMETERS',
  'GIT_SSL_NO_VERIFY',
])('gitEnv drops %s, as every other GIT_ variable', (name) => {
  expect(gitEnv({ [name]: 'value' }, home)).not.toHaveProperty(name);
});

test.each(['SSH_ASKPASS', 'NETRC'])('gitEnv drops %s', (name) => {
  expect(gitEnv({ [name]: 'value' }, home)).not.toHaveProperty(name);
});

test('gitEnv keeps a variable that has nothing to do with git', () => {
  expect(gitEnv({ PATH: '/bin', LANG: 'C' }, home)).toMatchObject({
    PATH: '/bin',
    LANG: 'C',
  });
});

test("gitEnv gives git the folder it is handed as HOME, over the runner's", () => {
  expect(gitEnv({ HOME: '/home/runner' }, home).HOME).toBe(home);
});

test('gitEnv has git refuse to prompt and read no global or system configuration', () => {
  expect(gitEnv({}, home)).toEqual({
    HOME: home,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
  });
});
