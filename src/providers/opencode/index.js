// OpenCode, via opencode's ACP server (`opencode acp`).
import { AcpSession } from '../acp/session.js';
import { descriptor } from './descriptor.js';
import { listOpencodeModels } from './models.js';
import { worktreeEnv } from './worktree.js';
import { cliSetup } from '../setup.js';

export { descriptor };

const NOT_INSTALLED =
  'Couldn’t find opencode. Install it with "npm install -g opencode-ai", run "opencode auth login", then send your message again.';

/**
 * How opencode is run, and where it has ways of its own.
 * @param {string} [command]  the opencode to run
 * @returns {import('../acp/session.js').AcpAgent}
 */
export const opencodeAgent = (command = 'opencode') => ({
  descriptor,
  command,
  args: ['acp'],
  notInstalled: NOT_INSTALLED,
  requests: {
    // opencode sends an editor a copy of every edit it has been allowed to
    // make, whether or not the editor said it takes them. It writes the file
    // itself, so there is nothing to do but say "got it".
    'fs/write_text_file': () => null,
  },
});

/**
 * @param {object} [opts]
 * @param {(conversation: string, speakerId: string, seat?: import('../../main/app-tools.js').Seat) => import('../../main/app-tools.js').AppTool[]} [opts.tools]
 * @param {() => string} [opts.cliPath]  the opencode the user pointed the app at, if any: asked each time
 * @returns {import('../contract.js').Provider}
 */
export function createOpencodeProvider({ cliPath = () => '', tools = () => [] } = {}) {
  // opencode isn't bundled: the app runs the `opencode` you installed.
  // Settings, or BUDDYLIST_OPENCODE_CLI, points it at a different one.
  const cli = () => cliPath() || process.env.BUDDYLIST_OPENCODE_CLI || 'opencode';
  return {
    descriptor,
    createSession: ({ contact, emit, conversation, env, instructions, mainFolder }) =>
      new AcpSession({
        contact,
        emit,
        agent: opencodeAgent(cli()),
        env: mainFolder ? { ...env, ...worktreeEnv(contact.cwd, mainFolder, { ...process.env, ...env }) } : env,
        instructions,
        appTools: conversation ? tools(conversation, contact.id, { readOnly: Boolean(contact.readOnly) }) : [],
      }),
    listModels: () => listOpencodeModels({ command: cli() }),
    // opencode can't be asked whether it is signed in to a provider, only whether it is there.
    checkSetup: () =>
      cliSetup({
        command: cli(),
        args: ['--version'],
        install: 'Install it with "npm install -g opencode-ai", then run "opencode auth login".',
        signIn: 'Open Terminal and run "opencode" to see what is wrong with it.',
        ready: 'Installed. Whether it is signed in shows with your first message.',
      }),
  };
}
