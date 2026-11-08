import { ClaudeSession } from './session.js';
import { claudeBinaryPath, sdkBinaryPath } from './binary.js';
import { childEnv } from './env.js';
import { listClaudeModels } from './models.js';
import { listClaudeAgents } from './agents.js';
import { claudeTaskName } from './task-name.js';
import { claudeSuggestReplies } from './suggest-replies.js';
import { upgradeHistoryEntry } from './legacy.js';
import { elsewhere } from './sessions.js';
import { descriptor } from './descriptor.js';
import { accountEnv, claudeAccounts, ownConfig, OWN_LOGIN_ONLY, sessionLogins } from './accounts.js';
import { cliSetup, cliSignIn } from '../setup.js';

export { descriptor };

/**
 * What makes Claude Code sign in.
 * @param {string} way  one of the descriptor's `signIn`: each is named after its flag
 */
export const loginArgs = (way) => ['auth', 'login', `--${way}`];

/**
 * @param {{ isPackaged: boolean, resourcesPath?: string }} app
 * @param {object} [opts]
 * @param {(conversation: string, speakerId: string) => import('../../main/app-tools.js').AppTool[]} [opts.tools]  the app's own
 *   tools for the agents of a conversation
 * @param {() => string} [opts.cliPath]  the Claude Code the user pointed the app at, if any: asked each time
 * @param {(accountId?: string) => import('../contract.js').AccountSwitch | null} [opts.accounts]  the logins the app keeps, with
 *   the one in use: asked each time too. None, and it is the user's own
 * @returns {import('../contract.js').Provider}
 */
export function createClaudeProvider(app, { tools = () => [], cliPath = () => '', accounts = () => null } = {}) {
  const own = claudeBinaryPath(app);
  const cli = () => cliPath() || own;
  const binary = () => cli() || sdkBinaryPath();
  const logins = (id) => accounts(id) || OWN_LOGIN_ONLY;
  // What Claude Code is asked about itself with: the account in use, as a session is, after what a project
  // starts its agents with.
  const env = (project = {}) => ({ ...childEnv(), ...project, ...accountEnv(logins().current().dir) });
  return {
    descriptor,
    createSession: ({ contact, emit, conversation, env: projectEnv, instructions, mainFolder, todos }) =>
      new ClaudeSession({
        contact,
        emit,
        cliPath: cli(),
        tools: conversation ? tools(conversation, contact.id) : [],
        env: projectEnv,
        instructions,
        mainFolder,
        accounts: sessionLogins(logins, contact),
        todos,
      }),
    upgradeHistoryEntry,
    listModels: ({ cwd, mainFolder, env: projectEnv } = {}) =>
      listClaudeModels({ cliPath: cli(), env: env(projectEnv), cwd, mainFolder }),
    // Your own agents are in the config folder of the account in use, which shares them with yours.
    listAgents: ({ cwd, mainFolder }) =>
      listClaudeAgents({
        cwd,
        mainFolder,
        configDir: logins().current().dir || ownConfig().dir,
        cliPath: cli(),
        env: env(),
      }),
    nameTask: (message) => claudeTaskName(message, { cliPath: cli(), env: env() }),
    suggestReplies: (reply, { asks } = {}) => claudeSuggestReplies(reply, { asks, cliPath: cli(), env: env() }),
    // Claude Code comes with the app, so all there is to ask is whether it is signed in.
    checkSetup: () =>
      cliSetup({
        command: binary(),
        args: ['auth', 'status'],
        env: env(),
        version: true,
        bundled: !cliPath() && !process.env.BUDDYLIST_CLAUDE_CLI,
        install: 'Claude Code should have come with the app. Install buddylist again.',
        signIn: 'Sign in here with your Claude account (or set ANTHROPIC_API_KEY).',
      }),
    signIn: ({ way, signal }) => cliSignIn({ command: binary(), args: loginArgs(way), env: env() }, { signal }),
    elsewhere,
    accounts: claudeAccounts({ binary, cliPath: cli, env: childEnv, loginArgs }),
  };
}
