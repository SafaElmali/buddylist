// The agents you defined for Claude Code, which a guest can run as (see `agent` on SessionContact): its custom
// agents, each a file in .claude/agents. Claude Code says which agents a session has, its built-in ones and a
// plugin's among them, but not where each comes from. The files say that: one defined in .claude/agents of the
// project, in its folder or one above it, is the project's, and one in the agents of your config folder is your
// own. The others are left out.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { within } from '../within.js';
import { childEnv } from './env.js';
import { InputQueue } from './input-queue.js';
import { query } from './sdk.js';

const PATIENCE_MS = 20000;

// "---\nname: code-reviewer\n..." -> "code-reviewer": the name an agent's file gives it in its frontmatter.
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---/;
const NAME = /^name:[ \t]*(["']?)(.+?)\1[ \t]*$/m;

/**
 * The name an agent's file gives it. None for a file that gives none, which is no agent's.
 * @param {string} text
 * @returns {string | null}
 */
export const agentName = (text) => text.match(FRONTMATTER)?.[1].match(NAME)?.[2] ?? null;

/** The names the agent files in a folder give, in its subfolders too. None where there is no such folder. */
async function namesIn(dir) {
  const files = await fs.readdir(dir, { recursive: true }).catch(() => []);
  const names = await Promise.all(
    files
      .filter((file) => file.endsWith('.md'))
      .map((file) => fs.readFile(path.join(dir, file), 'utf8').then(agentName, () => null))
  );
  return new Set(names.filter(Boolean));
}

/**
 * The agents folders of the project a folder is in: its own and every one above it, as Claude Code looks
 * for them. The one in your home folder is your own Claude Code's, and so is your config folder's.
 * @param {string} from
 * @param {string} personal  the agents folder of your config folder
 */
function projectDirs(from, personal) {
  const own = [personal, path.join(os.homedir(), '.claude', 'agents')];
  const dirs = [];
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    const agents = path.join(dir, '.claude', 'agents');
    if (!own.includes(agents)) dirs.push(agents);
    if (path.dirname(dir) === dir) return dirs;
  }
}

/**
 * Claude Code is started where the session would work, says which agents it has, and is closed before it reads
 * a message: nothing is sent to a model. The project's agents come first, then your own, each as Claude Code
 * lists them. One defined in both is the project's, as Claude Code runs the project's.
 * @param {object} opts
 * @param {string} opts.cwd  where the session would work
 * @param {string} [opts.mainFolder]  for a folder in a worktree, the same folder in the main checkout: Claude
 *   Code reads the project's agents there, as a session does
 * @param {string} opts.configDir  the config folder of the account in use, which has your own agents
 * @param {string} [opts.cliPath]
 * @param {NodeJS.ProcessEnv} [opts.env]  what it is started with: the account in use, as a session is
 * @param {typeof query} [opts.queryFn]  the SDK's query(); replaceable in tests
 * @param {number} [opts.patienceMs]
 * @returns {Promise<Omit<import('../contract.js').CustomAgent, 'provider'>[]>}
 */
export async function listClaudeAgents({
  cwd,
  mainFolder,
  configDir,
  cliPath,
  env = childEnv(),
  queryFn = query,
  patienceMs = PATIENCE_MS,
}) {
  const input = new InputQueue();
  const options = { cwd, env, persistSession: false, ...(mainFolder && { projectConfigRoot: mainFolder }) };
  if (cliPath) options.pathToClaudeCodeExecutable = cliPath;
  const q = queryFn({ prompt: input, options });
  try {
    const personalDir = path.join(configDir, 'agents');
    const [agents, inProject, personal] = await Promise.all([
      within(q.supportedAgents(), patienceMs, 'Claude Code'),
      Promise.all(projectDirs(mainFolder || cwd, personalDir).map(namesIn)),
      namesIn(personalDir),
    ]);
    const project = new Set(inProject.flatMap((names) => [...names]));
    const listed = (source, names) =>
      agents
        .filter(({ name }) => names.has(name) && (source === 'project' || !project.has(name)))
        .map(({ name, description, model }) => ({
          name,
          description: description ?? '',
          ...(model && { model }),
          source,
        }));
    return [...listed('project', project), ...listed('personal', personal)];
  } finally {
    input.close();
    q.close();
  }
}
