// Hermes, via Hermes Agent's ACP server (`hermes acp`).
import { AcpSession } from '../acp/session.js';
import { descriptor } from './descriptor.js';
import { cliSetup } from '../setup.js';

export { descriptor };

// Hermes's installer is a different one-liner on each system, so the user is sent to its site for it.
const INSTALL = 'Install it from https://hermes-agent.nousresearch.com';
const NOT_INSTALLED = `Couldn’t find Hermes. ${INSTALL}, run "hermes model" to choose a provider, then send your message again.`;

/**
 * How Hermes is run, and where it has ways of its own.
 * @param {string} [command]  the hermes to run
 * @returns {import('../acp/session.js').AcpAgent}
 */
export const hermesAgent = (command = 'hermes') => ({
  descriptor,
  command,
  args: ['acp'],
  notInstalled: NOT_INSTALLED,
  // "Always allow" lasts until the session ends. Hermes's other one adds the command
  // to its settings, for every session in every folder from then on.
  alwaysOptions: ['allow_session'],
  // Hermes answers a session it hasn't got with nothing, and one it has with its modes.
  loaded: (answer) => Boolean(answer?.modes),
});

/**
 * @param {object} [opts]
 * @param {(conversation: string, speakerId: string) => import('../../main/app-tools.js').AppTool[]} [opts.tools]
 * @param {() => string} [opts.cliPath]  the hermes the user pointed the app at, if any: asked each time
 * @returns {import('../contract.js').Provider}
 */
export function createHermesProvider({ cliPath = () => '', tools = () => [] } = {}) {
  // Hermes isn't bundled: the app runs the `hermes` you installed.
  // Settings, or BUDDYLIST_HERMES_CLI, points it at a different one.
  const cli = () => cliPath() || process.env.BUDDYLIST_HERMES_CLI || 'hermes';
  return {
    descriptor,
    // A contact's worktree can be anyone's pull request, and Hermes runs the plugins in a folder's
    // .hermes/plugins once you let it run them anywhere. So in a worktree it runs none of them.
    createSession: ({ contact, emit, conversation, env, instructions, mainFolder }) =>
      new AcpSession({
        contact,
        emit,
        agent: hermesAgent(cli()),
        env: mainFolder ? { ...env, HERMES_ENABLE_PROJECT_PLUGINS: '0' } : env,
        instructions,
        appTools: conversation ? tools(conversation, contact.id) : [],
      }),
    // Hermes can't be asked whether it has a provider set up, only whether it is there.
    checkSetup: () =>
      cliSetup({
        command: cli(),
        args: ['--version'],
        install: `${INSTALL}, then run "hermes model" to choose a provider.`,
        signIn: 'Open Terminal and run "hermes" to see what is wrong with it.',
        ready: 'Installed. Whether it has a provider set up shows with your first message.',
      }),
  };
}
