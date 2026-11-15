// Grok, via Grok Build's ACP mode (`grok agent stdio`).
import { AcpSession } from '../acp/session.js';
import { descriptor } from './descriptor.js';
import { listGrokModels } from './models.js';
import { cliSetup } from '../setup.js';

export { descriptor };

const INSTALL = 'Install it with "curl -fsSL https://x.ai/cli/install.sh | bash"';
const NOT_INSTALLED = `Couldn’t find Grok Build. ${INSTALL}, run "grok login", then send your message again.`;
const NEVER_ASKS = 'yolo';

/**
 * What a read-only Grok seat works as: Grok's own agent without the tools that run commands, change files or start
 * agents and jobs of their own. Plan mode keeps Grok from editing, but not from its shell, and the user's Claude Code
 * hooks and allow rules, which Grok follows in every folder, can approve a command without the app hearing of it.
 * Grok's read-only sandbox would hold it, but it doesn't start everywhere. Without the tools, nothing can approve one.
 * A name Grok doesn't have is passed over, so the list names each tool by every name Grok has given it.
 */
export const READ_ONLY_PROFILE = Object.freeze({
  name: 'buddylist-read-only',
  description: 'Reads and searches the code, and changes nothing.',
  disallowedTools: Object.freeze([
    // Its shell, and the commands it leaves running.
    'run_terminal_command',
    'bash',
    'kill_task',
    'monitor',
    // File changes.
    'search_replace',
    'write',
    'edit',
    'apply_patch',
    // Agents and jobs of its own, which have tools of their own.
    'Agent',
    'spawn_subagent',
    'task',
    'workflow',
    'scheduler_create',
    // Files it makes.
    'image_gen',
    'image_edit',
    'video_gen',
    'image_to_video',
    'reference_to_video',
  ]),
});

/**
 * How Grok Build is run, and where it has ways of its own.
 * @param {string} [command]  the grok to run
 * @param {{ readOnly?: boolean }} [opts]  `readOnly`: for a contact kept from changing files (see `readOnly` on
 *   SessionContact), which works as READ_ONLY_PROFILE
 * @returns {import('../acp/session.js').AcpAgent}
 */
export const grokAgent = (command = 'grok', { readOnly = false } = {}) => ({
  descriptor,
  command,
  args: ['agent', 'stdio'],
  notInstalled: NOT_INSTALLED,
  // Each session starts with always-approve as its mode says, and with auto mode off, whatever Grok's settings say:
  // either would have it run commands unasked, a read-only one's too.
  sessionMeta: (mode) => ({
    yoloMode: mode === NEVER_ASKS,
    autoMode: false,
    ...(readOnly && { agentProfile: READ_ONLY_PROFILE }),
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
 * @returns {import('../contract.js').Provider}
 */
export function createGrokProvider({ cliPath = () => '', tools = () => [] } = {}) {
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
        env,
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
        signIn: 'Open Terminal and run "grok login" (or set XAI_API_KEY).',
      }),
  };
}
