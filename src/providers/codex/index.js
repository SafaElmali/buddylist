// Codex, via `codex app-server` (the Codex CLI's own protocol for front ends).
import { CodexSession } from './session.js';
import { listCodexModels } from './models.js';
import { codexSuggestReplies } from './suggest-replies.js';
import { codexElsewhere } from './sessions.js';
import { descriptor } from './descriptor.js';
import { cliSetup } from '../setup.js';

export { descriptor };

/**
 * @param {object} [opts]
 * @param {(conversation: string, speakerId: string) => import('../../main/app-tools.js').AppTool[]} [opts.tools]
 * @param {() => string} [opts.cliPath]  the Codex CLI the user pointed the app at, if any: asked each time
 * @returns {import('../contract.js').Provider}
 */
export function createCodexProvider({ cliPath = () => '', tools = () => [] } = {}) {
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
        env,
        instructions,
        mainFolder,
        appTools: conversation ? tools(conversation, contact.id) : [],
      }),
    listModels: () => listCodexModels({ command: cli() }),
    suggestReplies: (reply, { asks, model } = {}) => codexSuggestReplies(reply, { asks, model, command: cli() }),
    checkSetup: () =>
      cliSetup({
        command: cli(),
        args: ['login', 'status'],
        version: true,
        install: 'Install it with "npm install -g @openai/codex", then run "codex login".',
        signIn: 'Open Terminal and run "codex login" (or set OPENAI_API_KEY).',
      }),
  };
}
