// Gemini, via Gemini CLI's ACP mode (`gemini --acp`).
import { AcpSession } from '../acp/session.js';
import { descriptor } from './descriptor.js';
import { cliSetup } from '../setup.js';

export { descriptor };

/** What installs it, for the user to copy. */
const INSTALL_COMMAND = 'npm install -g @google/gemini-cli';
/** @type {import('../json-rpc.js').Program} */
const PROGRAM = { name: 'Gemini CLI', install: `Install it with "${INSTALL_COMMAND}"` };

// Gemini CLI tells its front end about a change of mode in a line of reply text.
const MODE_UPDATE = /^\[MODE_UPDATE\] (\w+)$/;

/**
 * How Gemini CLI is run, and where it has ways of its own.
 * @param {string} [command]  the Gemini CLI to run
 * @returns {import('../acp/session.js').AcpAgent}
 */
export const geminiAgent = (command = 'gemini') => ({
  descriptor,
  command,
  args: ['--acp'],
  program: PROGRAM,
  // "Always allow" lasts until the session ends, and for a tool from an MCP
  // server it covers that tool, not everything the server has.
  alwaysOptions: ['proceed_always', 'proceed_always_tool'],
  modeFromText: (text) => MODE_UPDATE.exec(text)?.[1] ?? null,
  // Gemini CLI goes on by itself in Auto-accept file edits once a file change is always allowed, and leaves Plan mode
  // for Ask before acting once its plan is approved.
  modeAfter: ({ mode, kind, always }) => (always && kind === 'edit' ? 'autoEdit' : mode === 'plan' ? 'default' : null),
});

/**
 * @param {object} [opts]
 * @param {(conversation: string, speakerId: string, seat?: import('../../main/app-tools.js').Seat) => import('../../main/app-tools.js').AppTool[]} [opts.tools]
 * @param {() => string} [opts.cliPath]  the Gemini CLI the user pointed the app at, if any: asked each time
 * @param {() => Promise<void>} [opts.reloadPath]  asks the login shell for its PATH again, for a Gemini CLI installed while
 *   the app is open
 * @returns {import('../contract.js').Provider}
 */
export function createGeminiProvider({ cliPath = () => '', tools = () => [], reloadPath } = {}) {
  // Gemini CLI isn't bundled: the app runs the `gemini` you installed.
  // Settings, or BUDDYLIST_GEMINI_CLI, points it at a different one.
  const cli = () => cliPath() || process.env.BUDDYLIST_GEMINI_CLI || 'gemini';
  return {
    descriptor,
    // No `mainFolder`: Gemini CLI reads a folder's .gemini/settings.json only once the user trusts
    // that folder, and can't be pointed at the main checkout's. See docs/gemini.md.
    createSession: ({ contact, emit, conversation, env, instructions }) =>
      new AcpSession({
        contact,
        emit,
        agent: geminiAgent(cli()),
        reloadPath,
        env,
        instructions,
        appTools: conversation ? tools(conversation, contact.id, { readOnly: Boolean(contact.readOnly) }) : [],
      }),
    // Gemini CLI can't be asked whether it is signed in, only whether it is there.
    checkSetup: () =>
      cliSetup({
        command: cli(),
        args: ['--version'],
        install: `${PROGRAM.install}, then run "gemini" once to sign in.`,
        installCommand: INSTALL_COMMAND,
        signIn: 'Open Terminal and run "gemini" to see what is wrong with it.',
        ready: 'Installed. Whether it is signed in shows with your first message.',
      }),
  };
}
