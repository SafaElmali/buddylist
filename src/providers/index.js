// The provider registry. Add new providers here.
import { createClaudeProvider } from './claude/index.js';
import { createCodexProvider } from './codex/index.js';
import { createGeminiProvider } from './gemini/index.js';
import { createOpencodeProvider } from './opencode/index.js';
import { createHermesProvider } from './hermes/index.js';
import { sessionLogins } from './claude/accounts.js';
import { DemoSession, PLANS } from './demo/session.js';
import { demoAccounts, demoWho } from './demo/accounts.js';
import { DEMO_AGENTS } from './demo/agents.js';
import { demoElsewhere } from './demo/sessions.js';
import { demoSuggestReplies } from './demo/suggest-replies.js';
import { NOT_SIGNED_IN, READY, UNKNOWN } from './setup.js';
import { MODELS_MAX_AGE_MS } from '../shared/models.js';

/** @typedef {import('./contract.js').Provider} Provider */

export const DEFAULT_PROVIDER = 'claude';

/**
 * @param {object} opts
 * @param {{ isPackaged: boolean, resourcesPath?: string }} opts.app
 * @param {boolean} [opts.demo]  replace every session with a scripted fake of its provider
 * @param {string} [opts.demoFolder]  in the demo, where the project folders of the conversations Claude Code had
 *   outside the app are made up (see demo/sessions.js). Without it, the demo has none
 * @param {(conversation: string, speakerId: string, seat?: import('../main/app-tools.js').Seat) => import('../main/app-tools.js').AppTool[]} [opts.tools]  what the agents of a
 *   conversation can ask the app itself to do. Only a provider that can give its agent tools uses them
 * @param {(id: string) => string} [opts.cliPath]  where the user keeps a provider's program, when they said so
 *   in Settings: asked whenever one is started, so a change holds from the next session. '' for the app's own choice
 * @param {(id: string, accountId?: string) => import('./contract.js').AccountSwitch | null} [opts.accounts]  the logins a provider's
 *   sessions start in, as the app keeps them: only a provider with `accounts` asks. Null for the user's own alone
 */
export function createProviders({
  app,
  demo = false,
  demoFolder = '',
  tools = () => [],
  cliPath = () => '',
  accounts = () => null,
}) {
  /** @type {Map<string, Provider>} */
  const providers = new Map();
  const all = [
    createClaudeProvider(app, { tools, cliPath: () => cliPath('claude'), accounts: (id) => accounts('claude', id) }),
    createCodexProvider({ tools, cliPath: () => cliPath('codex') }),
    createGeminiProvider({ tools, cliPath: () => cliPath('gemini') }),
    createOpencodeProvider({ tools, cliPath: () => cliPath('opencode') }),
    createHermesProvider({ tools, cliPath: () => cliPath('hermes') }),
  ];
  for (const provider of all) {
    const { descriptor } = provider;
    if (!demo) {
      providers.set(descriptor.id, provider);
      continue;
    }
    // A scripted agent has the app's tools where the one it plays would have them. One whose provider has
    // more logins has made-up ones to switch between, in place of its CLI's, and answers in the one in use.
    const own = PLANS[descriptor.id] || PLANS.claude;
    const scripted = ({ contact, emit, conversation }) =>
      new DemoSession({
        contact,
        emit,
        descriptor,
        tools:
          descriptor.appTools && conversation
            ? tools(conversation, contact.id, { readOnly: Boolean(contact.readOnly) })
            : [],
        ...(descriptor.accounts && {
          accounts: sessionLogins((accountId) => accounts(descriptor.id, accountId), contact) || undefined,
          login: (dir) => demoWho(dir, own),
        }),
      });
    providers.set(descriptor.id, {
      ...provider,
      createSession: scripted,
      ...(descriptor.accounts && { accounts: demoAccounts({ own }) }),
    });
  }

  /** @param {string} [id] */
  const get = (id) => providers.get(id) || providers.get(DEFAULT_PROVIDER);
  // Made-up outside conversations for each provider, never the user's real ones.
  const demoHeld = new Map();
  if (demo && demoFolder) {
    for (const [id, provider] of providers) {
      if (provider.elsewhere) demoHeld.set(id, demoElsewhere(demoFolder, id));
    }
  }

  /**
   * What each provider said its models are: the list it last gave, when it was last asked, and the asking going on.
   * @type {Map<string, { list?: import('./contract.js').ModelOption[], at?: number, asking?: Promise<import('./contract.js').ModelOption[]> }>}
   */
  const models = new Map();
  /**
   * Asks a provider for its models, unless it is being asked already: whoever asks meanwhile gets the same answer.
   * A failed or empty answer leaves the list it gave before, where it gave one.
   * @param {Provider} provider
   */
  const askModels = (provider) => {
    const key = provider.descriptor.id;
    const known = models.get(key) || {};
    models.set(key, known);
    if (!known.asking) {
      known.at = Date.now();
      known.asking = provider
        .listModels()
        .then(
          (list) => (known.list = list.length || !known.list ? list : known.list),
          (error) => {
            if (!known.list) throw error;
            return known.list;
          }
        )
        .finally(() => (known.asking = undefined));
    }
    return known.asking;
  };

  return {
    get,
    descriptor: (id) => get(id).descriptor,
    upgradeHistory: (id, entries) => {
      const upgrade = get(id).upgradeHistoryEntry;
      return upgrade ? entries.map(upgrade) : entries;
    },
    list: () => [...providers.values()].map((p) => p.descriptor),
    /**
     * Where a provider's agent keeps the conversations held outside the app; null from one that keeps
     * none to read. In the demo, a few made up for the one that keeps some.
     * @param {string} id
     * @returns {import('./contract.js').Elsewhere | null}
     */
    elsewhere: (id) => (get(id).elsewhere && (demo ? demoHeld.get(get(id).descriptor.id) : get(id).elsewhere)) || null,
    /**
     * A provider's own list of its models. It is asked once, and again in the background once its list is
     * older than MODELS_MAX_AGE_MS: a new model can come out while the app runs. Until the new list comes, and
     * where asking again fails, the last one is given. An attempt that failed before there was any list is made
     * again the next time: its CLI may be installed by then.
     * In a folder, a provider whose sessions' defaults go by the folder (`modelsByFolder`) is asked each time,
     * there: what its settings say can have changed since. Any other gives its one list.
     * @param {string} id
     * @param {{ cwd: string, mainFolder?: string, env?: Record<string, string> }} [where]  as for listModels
     * @param {{ fresh?: boolean }} [opts]  `fresh`: an old list is not given at once, but the new one once it
     *   comes, for a window that shows the old one meanwhile
     * @returns {Promise<import('./contract.js').ModelOption[] | null>} null from one that can't be asked,
     *   and in the demo, where no provider's CLI is started
     */
    models: (id, where, { fresh = false } = {}) => {
      const provider = get(id);
      if (demo || !provider.listModels) return Promise.resolve(null);
      if (where && provider.descriptor.modelsByFolder) return provider.listModels(where);
      const known = models.get(provider.descriptor.id);
      const old = !known?.list || Date.now() - known.at >= MODELS_MAX_AGE_MS;
      const asking = old ? askModels(provider) : known.asking;
      if (!known?.list) return asking;
      return fresh && asking ? asking : Promise.resolve(known.list);
    },
    /**
     * The agents the user defined that a guest working in `where` can run as, from every provider whose sessions
     * can run as one. Asked each time: a file in .claude/agents can be added at any moment.
     * @param {{ cwd: string, mainFolder?: string }} where
     * @returns {Promise<import('./contract.js').CustomAgent[]>}  made up in the demo, where no provider's CLI
     *   is started. Rejects when a provider could not be asked
     */
    agents: async (where) => {
      const lists = await Promise.all(
        [...providers.values()]
          .filter(({ descriptor }) => descriptor.customAgents)
          .map(async ({ descriptor, listAgents }) => {
            const listed = demo ? DEMO_AGENTS : await listAgents(where);
            return listed.map((agent) => ({ ...agent, provider: descriptor.id }));
          })
      );
      return lists.flat();
    },
    /**
     * A few words for the task a message asks for, from a provider's own quick model.
     * @param {string} id  a provider's own: Claude does not stand in for one that is not there
     * @param {string} message
     * @returns {Promise<string>}  '' from one that has none to ask, and in the demo, where no provider's CLI
     *   is started
     */
    nameTask: async (id, message) => {
      const provider = providers.get(id);
      return demo || !provider?.nameTask ? '' : provider.nameTask(message);
    },
    /**
     * What the user might send after a reply, from a provider's own quick model: a few replies to one that asks
     * them something, else the one message they would most likely send next (see suggest-replies.js).
     * @param {string} id  a provider's own: Claude does not stand in for one that is not there
     * @param {string} reply
     * @param {{ asks?: boolean, model?: string }} [opts]  `asks`: whether the reply asks the user something.
     *   `model`: the conversation's (see contract.js)
     * @returns {Promise<string[]>}  none from one that has none to ask. In the demo, where no provider's CLI
     *   is started, one that has one answers from a script
     */
    suggestReplies: async (id, reply, opts) => {
      const provider = providers.get(id);
      if (!provider?.suggestReplies) return [];
      return demo ? demoSuggestReplies(reply, opts) : provider.suggestReplies(reply, opts);
    },
    /**
     * Whether a provider's CLI is on this computer and signed in, asked now. One that can't be
     * asked is not judged. In the demo nobody's CLI is started, and everyone is ready.
     * @param {string} id
     * @returns {Promise<import('./setup.js').Setup>}
     */
    setup: async (id) => {
      const provider = get(id);
      if (demo) return READY;
      return provider.checkSetup ? provider.checkSetup() : UNKNOWN;
    },
    /**
     * Signs a provider in with its CLI's own sign-in, which opens the browser and waits there for the
     * user. One that has no such sign-in is not signed in, and neither is anyone in the demo.
     * @param {string} id  a provider's own: Claude does not stand in for one that is not there
     * @param {{ way: string, signal?: AbortSignal }} opts  `way`: one of the descriptor's `signIn`
     * @returns {Promise<import('./setup.js').SignInResult>}
     */
    signIn: async (id, opts) => {
      const provider = providers.get(id);
      return demo || !provider?.signIn ? NOT_SIGNED_IN : provider.signIn(opts);
    },
    /**
     * What can be done with a provider's logins: null from one that has a single login. The demo's are made up.
     * @param {string} id  a provider's own
     * @returns {import('./contract.js').AccountOps | null}
     */
    accounts: (id) => providers.get(id)?.accounts || null,
    /**
     * @param {import('./contract.js').SessionContact & { provider?: string }} contact
     * @param {(event: import('./contract.js').SessionEvent) => void} emit
     * @param {{ conversation?: string, env?: Record<string, string>, instructions?: string, mainFolder?: string }} [where]
     *   `conversation`: the contact whose conversation it answers in. `env`, `instructions` and `mainFolder`:
     *   what the project of its folder starts its agents with
     */
    createSession: (contact, emit, { conversation, env, instructions, mainFolder, todos } = {}) =>
      get(contact.provider).createSession({ contact, emit, conversation, env, instructions, mainFolder, todos }),
  };
}
