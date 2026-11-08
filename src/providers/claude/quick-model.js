import os from 'node:os';
import { within } from '../within.js';
import { childEnv } from './env.js';
import { query } from './sdk.js';

/** How long an answer is waited for. */
const PATIENCE_MS = 10000;

/**
 * A short answer from Claude's quickest model, for the small jobs the app hands it itself: naming a
 * branch, suggesting replies. Claude Code is started outside any project, with no tools and none of
 * the user's settings, and is closed once it has answered.
 * @param {string} prompt
 * @param {string} instructions  its system prompt: the job, and how to answer
 * @param {object} [opts]
 * @param {string} [opts.cliPath]
 * @param {NodeJS.ProcessEnv} [opts.env]  what it is started with: the account in use, which the request is made in
 * @param {typeof query} [opts.queryFn]  the SDK's query(); replaceable in tests
 * @param {number} [opts.patienceMs]
 * @returns {Promise<string>}  its answer as it gave it; '' when it gave none
 */
export async function askQuickModel(
  prompt,
  instructions,
  { cliPath, env = childEnv(), queryFn = query, patienceMs = PATIENCE_MS } = {}
) {
  const options = {
    cwd: os.homedir(),
    env,
    model: 'haiku',
    systemPrompt: instructions,
    tools: [],
    settingSources: [],
    maxTurns: 1,
    thinking: { type: 'disabled' },
    persistSession: false,
  };
  if (cliPath) options.pathToClaudeCodeExecutable = cliPath;
  const q = queryFn({ prompt, options });
  try {
    return await within(answer(q), patienceMs, 'Claude Code');
  } finally {
    q.close();
  }
}

/** What the turn ended with. */
async function answer(q) {
  for await (const msg of q) {
    if (msg.type === 'result') return msg.subtype === 'success' && !msg.is_error ? msg.result : '';
  }
  return '';
}
