// What the welcome wizard lists under "Who can you talk to?": every service's CLI, and
// GitHub's, each with whether it is on this computer and signed in. The check only ever
// asks. A service that can sign in through the browser by itself is signed in from the list,
// and so is GitHub's CLI, from there and from the contact list.
import { cliSetup, NOT_SIGNED_IN, READY, runCli, UNKNOWN } from '../providers/setup.js';
import { githubSignIn } from './github-sign-in.js';

/** What GitHub's CLI is called in the list, and by whoever signs it in. */
export const GITHUB = 'github';

/**
 * One line of the list.
 * @typedef {import('../providers/setup.js').Setup & {
 *   id: string,
 *   name: string,
 *   avatar?: string,
 *   optional?: true,
 * }} SetupItem  `avatar`: a service's picture. `optional`: nobody to talk to, only something the app does more with
 */

/**
 * The GitHub CLI: without it there are no pull request tags, repositories to pick from or reviews to count.
 * @param {{ run?: typeof runCli }} [deps]  replaceable in tests
 */
export const githubSetup = ({ run = runCli } = {}) =>
  cliSetup(
    {
      command: 'gh',
      args: ['auth', 'status'],
      install: 'Get "gh" from https://cli.github.com, then run "gh auth login".',
      signIn: 'Sign in here with your GitHub account.',
    },
    { run }
  );

/**
 * @param {object} deps
 * @param {Pick<ReturnType<import('../providers/index.js').createProviders>, 'list' | 'setup'>} deps.providers
 * @param {boolean} [deps.demo]  nothing is started in the demo: GitHub is as ready there as the services are
 * @param {() => Promise<import('../providers/setup.js').Setup>} [deps.github]  replaceable in tests
 * @returns {Promise<SetupItem[]>}  the services in the order "Add a Contact" offers them, then GitHub's CLI
 */
export function setupCheck({ providers, demo = false, github = githubSetup }) {
  // One that can't be asked must not keep the others from answering.
  const asked = (setup) => setup.catch(() => UNKNOWN);
  return Promise.all([
    ...providers
      .list()
      .map(async ({ id, name, avatar }) => ({ id, name, avatar, ...(await asked(providers.setup(id))) })),
    asked(demo ? Promise.resolve(READY) : github()).then((setup) => ({
      id: GITHUB,
      name: 'GitHub CLI',
      optional: true,
      ...setup,
    })),
  ]);
}

/**
 * The sign-ins started from the app, one per service at a time. Each waits in the browser for as
 * long as the user takes, so each can be called off.
 * @param {object} deps
 * @param {Pick<ReturnType<import('../providers/index.js').createProviders>, 'list' | 'signIn'>} deps.providers
 * @param {boolean} [deps.demo]  nothing is started in the demo, GitHub's CLI no more than a service's
 * @param {typeof githubSignIn} [deps.github]  replaceable in tests
 */
export function createSignIns({ providers, demo = false, github = githubSignIn }) {
  /** @type {Map<string, AbortController>} what calls each one off, by service */
  const running = new Map();
  /** @param {string} id  a service's. One that is not signing in is left alone */
  const cancel = (id) => running.get(id)?.abort();
  /** What signs `id` in, given what calls that off. Nothing for one that is signed in to in a terminal. */
  const signInOf = (id, way, onCode) => {
    if (id === GITHUB) return demo ? null : (signal) => github({ signal, onCode });
    const ways = providers.list().find((provider) => provider.id === id)?.signIn ?? [];
    if (!ways.length) return null;
    const known = ways.find((one) => one.id === way) ?? ways[0];
    return (signal) => providers.signIn(id, { way: known.id, signal });
  };
  return {
    cancel,
    /**
     * @param {string} id     a service's, or {@link GITHUB}
     * @param {string} [way]  one of its descriptor's `signIn`; its usual one, when it is none of them
     * @param {object} [opts]
     * @param {(step: import('./github-sign-in.js').DeviceCode) => void} [opts.onCode]  called with the code
     *   GitHub wants typed into its page, once its CLI has said it
     * @returns {Promise<import('../providers/setup.js').SignInResult>}  it never rejects
     */
    async start(id, way, { onCode } = {}) {
      const signIn = signInOf(id, way, onCode);
      if (!signIn) return NOT_SIGNED_IN;
      // Asked twice, the first is called off: two would wait for the same browser.
      cancel(id);
      const stop = new AbortController();
      running.set(id, stop);
      try {
        return await signIn(stop.signal);
      } catch (err) {
        return { ok: false, message: err?.message || String(err) };
      } finally {
        if (running.get(id) === stop) running.delete(id);
      }
    },
  };
}
