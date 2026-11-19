// Codex, via `codex app-server` (the Codex CLI's own protocol for front ends).
import { CodexSession } from './session.js';
import { listCodexModels } from './models.js';
import { codexSuggestReplies } from './suggest-replies.js';
import { codexElsewhere } from './sessions.js';
import { descriptor } from './descriptor.js';
import { cliSetup } from '../setup.js';
import { CODEX, INSTALL_COMMAND } from './rpc.js';

export { descriptor };

/**
 * @param {object} [opts]
 * @param {(conversation: string, speakerId: string, seat?: import('../../main/app-tools.js').Seat) => import('../../main/app-tools.js').AppTool[]} [opts.tools]
 * @param {() => string} [opts.cliPath]  the Codex CLI the user pointed the app at, if any: asked each time
 * @param {() => Promise<void>} [opts.reloadPath]  asks the login shell for its PATH again, for a Codex CLI installed while
 *   the app is open
 * @returns {import('../contract.js').Provider}
 */
export function createCodexProvider({ cliPath = () => '', tools = () => [], reloadPath } = {}) {
  // Codex isn't bundled (its binary is over 300 MB): the app runs the `codex`
  // you installed. Settings, or BUDDYLIST_CODEX_CLI, points it at a different one.
  const cli = () => cliPath() || process.env.BUDDYLIST_CODEX_CLI || 'codex';
  return {
    descriptor,
    elsewhere: codexElsewhere({ command: cli }),
    createSession: ({ contact, emit, conversation, env, instructions, mainFolder }) =>
      new CodexSession({
        contact,
        emit,
        cliPath: cli(),
        reloadPath,
        env,
        instructions,
        mainFolder,
        appTools: conversation ? tools(conversation, contact.id, { readOnly: Boolean(contact.readOnly) }) : [],
      }),
    listModels: () => listCodexModels({ command: cli() }),
    suggestReplies: (reply, { asks, model } = {}) => codexSuggestReplies(reply, { asks, model, command: cli() }),
    checkSetup: () =>
      cliSetup({
        command: cli(),
        args: ['login', 'status'],
        version: true,
        install: `${CODEX.install}, then run "codex login".`,
        installCommand: INSTALL_COMMAND,
        signIn: 'Open Terminal and run "codex login" (or set OPENAI_API_KEY).',
      }),
  };
}
