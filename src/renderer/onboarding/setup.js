// How the welcome wizard words what the setup check found, and how Settings and a
// service's Models dialog word the same of one service. Nothing in here touches the
// page: main/setup-check.js says how each CLI stands, and this says how that reads.
import { listNames } from '../lib/format.js';

/** @typedef {import('../../main/setup-check.js').SetupItem} SetupItem */

/**
 * How a line of the check reads: the buddy it wears, as a contact in that state would, and
 * what follows its name.
 */
const LOOKS = {
  ready: { presence: 'online', label: 'Ready' },
  'signed-out': { presence: 'away', label: 'Not signed in' },
  missing: { presence: 'offline', label: 'Not installed' },
  unknown: { presence: 'offline', label: 'Could not be checked' },
};

/** @param {string} state  a {@link SetupItem}'s */
export const setupLook = (state) => LOOKS[state] ?? LOOKS.unknown;

/**
 * How a service's program stands, in a few words: what the welcome wizard asks of it too.
 * @param {import('../../providers/setup.js').Setup & { custom: boolean }} setup  `custom`: it is one the
 *   user pointed the app at
 * @returns {{ text: string, ok: boolean | null }}  `ok` is null for one that gave no answer
 */
export function statusText({ state, custom }) {
  if (state === 'ready') return { text: custom ? 'Ready, with the program you named' : 'Ready', ok: true };
  if (state === 'signed-out') return { text: 'Not signed in', ok: false };
  if (state === 'missing') return { text: custom ? 'Not found where you said' : 'Not installed', ok: false };
  return { text: 'Could not be checked', ok: null };
}

/**
 * The services that can be talked to right now. GitHub's CLI is nobody to talk to.
 * @param {SetupItem[]} items
 */
export const readyAgents = (items) => items.filter((item) => !item.optional && item.state === 'ready');

/** What the check calls GitHub's CLI. */
export const GITHUB = 'github';

/** GitHub's CLI has one way in, and a dialog of its own for it: the code GitHub wants typed into its page. */
const GITHUB_WAYS = Object.freeze([{ id: 'web', label: 'GitHub' }]);

/**
 * The ways a line of the check can be signed in from here: its service's own, when a sign-in is
 * what it lacks. None for a service that is signed in to in a terminal.
 * @param {SetupItem} item
 * @param {{ id: string, signIn?: import('../../providers/contract.js').SignInWay[] }[]} providers
 * @returns {readonly import('../../providers/contract.js').SignInWay[]}
 */
export function signInWays(item, providers) {
  if (item.state !== 'signed-out') return [];
  if (item.id === GITHUB) return GITHUB_WAYS;
  return providers.find((provider) => provider.id === item.id)?.signIn ?? [];
}

/**
 * What the page says under the list.
 * @param {SetupItem[]} items
 */
export function setupSummary(items) {
  const ready = readyAgents(items).map((item) => item.name);
  if (!ready.length) {
    return 'Nobody is ready yet. Do what one of the lines says, then check again. You can also go on, and do it later.';
  }
  return `${listNames(ready)} ${ready.length === 1 ? 'is' : 'are'} ready. ${
    ready.length === 1 ? 'That is enough to start.' : 'Any of them is enough to start.'
  }`;
}

/**
 * The services with the ready ones first, so that "Add a Contact" starts out with one that
 * can answer. Among themselves they keep their order.
 * @template {{ id: string }} Provider
 * @param {Provider[]} providers
 * @param {SetupItem[] | null} items  null while the check has not answered
 * @returns {Provider[]}
 */
export function readyFirst(providers, items) {
  const ready = new Set(readyAgents(items ?? []).map((item) => item.id));
  return [...providers.filter((p) => ready.has(p.id)), ...providers.filter((p) => !ready.has(p.id))];
}
