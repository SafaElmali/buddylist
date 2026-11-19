// Grok, via Grok Build's ACP mode (`grok agent stdio`).
import { AcpSession } from '../acp/session.js';
import { descriptor } from './descriptor.js';
import { listGrokModels } from './models.js';
import { READ_ONLY_ENV, readOnlyProfile } from './read-only.js';
import { cliSetup } from '../setup.js';

export { descriptor };

const INSTALL_COMMAND = 'curl -fsSL https://x.ai/cli/install.sh | bash';
const INSTALL = `Install it with "${INSTALL_COMMAND}"`;
/** @type {import('../json-rpc.js').Program} */
const PROGRAM = { name: 'Grok Build', install: INSTALL };
const NEVER_ASKS = 'yolo';

/**
 * How Grok Build is run, and where it has ways of its own.
 * @param {string} [command]  the grok to run
 * @param {{ readOnly?: boolean }} [opts]  `readOnly`: for a contact kept from changing files (see `readOnly` on
 *   SessionContact), which works as the read-only profile (see read-only.js)
 * @returns {import('../acp/session.js').AcpAgent}
 */
export const grokAgent = (command = 'grok', { readOnly = false } = {}) => ({
  descriptor,
  command,
  args: ['agent', 'stdio'],
  program: PROGRAM,
  // Each session starts with always-approve as its mode says, and with auto mode off, whatever Grok's settings say:
  // either would have it run commands unasked, a read-only one's too.
  sessionMeta: (mode) => ({
    yoloMode: mode === NEVER_ASKS,
    autoMode: false,
    ...(readOnly && { agentProfile: readOnlyProfile() }),
  }),
  // Its sessions don't list their modes, and Never ask isn't one of them: it is Grok's always-approve, which goes on
  // and off with a notification of Grok's own, over Ask before acting. Auto mode, where a judge of Grok's runs what it
  // finds safe unasked, goes off with it: the app has no mode for it.
  setMode: async (rpc, sessionId, mode) => {
    rpc.notify('_x.ai/yolo_mode_changed', { yolo_mode: mode === NEVER_ASKS, auto_mode: false });
    await rpc.request('session/set_mode', { sessionId, modeId: mode === 'plan' ? 'plan' : 'default' });
  },
  // In Never ask Grok says it is in its default mode.
  modeHeard: (mode, current) => (mode === 'default' && current === NEVER_ASKS ? NEVER_ASKS : mode),
  // Grok's "Always allow" for a command, an MCP tool or a website lasts in that folder for good. Only the one for file
  // edits is for the session alone.
  alwaysOptions: ['allow-edits-session'],
  alwaysOptionsOnly: true,
});

/**
 * @param {object} [opts]
 * @param {(conversation: string, speakerId: string, seat?: import('../../main/app-tools.js').Seat) => import('../../main/app-tools.js').AppTool[]} [opts.tools]
 * @param {() => string} [opts.cliPath]  the grok the user pointed the app at, if any: asked each time
 * @param {() => Promise<void>} [opts.reloadPath]  asks the login shell for its PATH again, for a grok installed while
 *   the app is open
 * @returns {import('../contract.js').Provider}
 */
export function createGrokProvider({ cliPath = () => '', tools = () => [], reloadPath } = {}) {
  // Grok Build isn't bundled: the app runs the `grok` you installed.
  // Settings, or BUDDYLIST_GROK_CLI, points it at a different one.
  const cli = () => cliPath() || process.env.BUDDYLIST_GROK_CLI || 'grok';
  return {
    descriptor,
    // No `mainFolder`: Grok reads a folder's .grok/config.toml, hooks, plugins and AGENTS.md only once the user trusts
    // that folder, and can't be pointed at the main checkout's. See docs/grok.md.
    createSession: ({ contact, emit, conversation, env, instructions }) =>
      new AcpSession({
        contact,
        emit,
        agent: grokAgent(cli(), { readOnly: Boolean(contact.readOnly) }),
        reloadPath,
        env: contact.readOnly ? { ...env, ...READ_ONLY_ENV } : env,
        instructions,
        appTools: conversation ? tools(conversation, contact.id, { readOnly: Boolean(contact.readOnly) }) : [],
      }),
    listModels: () => listGrokModels({ command: cli() }),
    // Grok has no command that says whether it is signed in by how it leaves, but `grok models` says so first.
    checkSetup: () =>
      cliSetup({
        command: cli(),
        args: ['models'],
        signedOut: /^You are not authenticated\./m,
        version: true,
        install: `${INSTALL}, then run "grok login".`,
        installCommand: INSTALL_COMMAND,
        signIn: 'Open Terminal and run "grok login" (or set XAI_API_KEY).',
      }),
  };
}
