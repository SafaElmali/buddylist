import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { agentName, listClaudeAgents } from '../src/providers/claude/agents.js';
import { createProviders } from '../src/providers/index.js';
import { DEMO_AGENTS } from '../src/providers/demo/agents.js';
import { tempDir } from './fixtures/temp-dir.js';

/** An agent's file, as Claude Code reads one. */
const agentFile = (name, description = 'Does a thing.') =>
  `---\nname: ${name}\ndescription: ${description}\n---\nYou are ${name}.\n`;

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/**
 * A project and a config folder, with a Claude Code that lists `listed`: as a real one does, its built-in agents,
 * a plugin's, and the ones in the files.
 */
function setup(listed) {
  const dir = tempDir('cm-agents-');
  const project = path.join(dir, 'shop');
  const configDir = path.join(dir, 'config');
  const calls = { options: null, closed: false, inputClosed: false };
  const queryFn = ({ prompt, options }) => {
    calls.options = options;
    calls.prompt = prompt;
    return {
      supportedAgents: async () => listed,
      close: () => {
        calls.closed = true;
      },
    };
  };
  return { dir, project, configDir, calls, queryFn };
}

const LISTED = [
  { name: 'general-purpose', description: 'General-purpose agent.' },
  { name: 'Explore', description: 'Fast read-only search agent.', model: 'inherit' },
  { name: 'claude', description: 'Catch-all.' },
  { name: 'code-reviewer', description: 'Reviews code.', model: 'sonnet' },
  { name: 'test-writer', description: 'Writes tests.', model: 'inherit' },
  { name: 'shared', description: 'The project’s own.' },
  { name: 'plugin:helper', description: 'From a plugin.' },
];

test('the name an agent’s file gives it is in its frontmatter, quoted or not', () => {
  assert.equal(agentName(agentFile('code-reviewer')), 'code-reviewer');
  assert.equal(agentName('---\ndescription: |\n  Many lines\nname: "quoted"\n---\nbody'), 'quoted');
  assert.equal(agentName("---\r\nname: 'single'\r\n---\r\n"), 'single');
  assert.equal(agentName('# Just notes\nname: not-an-agent'), null, 'no frontmatter, no agent');
  assert.equal(agentName('---\ndescription: nameless\n---\n'), null);
});

test('Claude Code’s agents are listed by where they were defined: the project’s first, then your own', async () => {
  const { project, configDir, calls, queryFn } = setup(LISTED);
  write(path.join(project, '.claude', 'agents', 'review.md'), agentFile('code-reviewer'));
  write(path.join(project, '.claude', 'agents', 'nested', 'shared.md'), agentFile('shared'));
  write(path.join(project, '.claude', 'agents', 'README.txt'), agentFile('not-markdown'));
  write(path.join(configDir, 'agents', 'tests.md'), agentFile('test-writer'));
  // Defined in both: Claude Code runs the project's.
  write(path.join(configDir, 'agents', 'shared.md'), agentFile('shared'));
  // A file whose agent Claude Code doesn't have, say one it could not read, is none to offer.
  write(path.join(configDir, 'agents', 'broken.md'), agentFile('broken'));

  const agents = await listClaudeAgents({ cwd: project, configDir, env: {}, queryFn });
  assert.deepEqual(agents, [
    { name: 'code-reviewer', description: 'Reviews code.', model: 'sonnet', source: 'project' },
    { name: 'shared', description: 'The project’s own.', source: 'project' },
    { name: 'test-writer', description: 'Writes tests.', model: 'inherit', source: 'personal' },
  ]);
  // Its built-in agents and a plugin's are not yours to invite.
  assert.ok(!agents.some((agent) => ['general-purpose', 'Explore', 'claude', 'plugin:helper'].includes(agent.name)));
  assert.equal(calls.options.cwd, project);
  assert.equal(calls.options.persistSession, false, 'it is asked, and keeps no conversation');
  assert.ok(!('projectConfigRoot' in calls.options));
  assert.ok(calls.closed, 'and is closed once it said');
});

test('a project’s agents are found in a folder above the one it works in, as Claude Code finds them', async () => {
  const { project, configDir, queryFn } = setup(LISTED);
  write(path.join(project, '.claude', 'agents', 'review.md'), agentFile('code-reviewer'));
  const inside = path.join(project, 'packages', 'web');
  fs.mkdirSync(inside, { recursive: true });
  const agents = await listClaudeAgents({ cwd: inside, configDir, env: {}, queryFn });
  assert.deepEqual(
    agents.map((agent) => [agent.name, agent.source]),
    [['code-reviewer', 'project']]
  );
});

test('in a worktree, the project’s agents are read from the main checkout, as a session reads them', async () => {
  const { dir, project, configDir, calls, queryFn } = setup(LISTED);
  write(path.join(project, '.claude', 'agents', 'review.md'), agentFile('code-reviewer'));
  // The branch's own copy is someone else's pull request.
  const worktree = path.join(dir, 'worktrees', 'their-pr');
  write(path.join(worktree, '.claude', 'agents', 'tests.md'), agentFile('test-writer'));
  const agents = await listClaudeAgents({ cwd: worktree, mainFolder: project, configDir, env: {}, queryFn });
  assert.deepEqual(
    agents.map((agent) => [agent.name, agent.source]),
    [['code-reviewer', 'project']]
  );
  assert.equal(calls.options.projectConfigRoot, project);
  assert.equal(calls.options.cwd, worktree, 'it is still asked where the guest works');
});

test('without agents folders there are no agents to list', async () => {
  const { project, configDir, queryFn } = setup(LISTED);
  fs.mkdirSync(project, { recursive: true });
  assert.deepEqual(await listClaudeAgents({ cwd: project, configDir, env: {}, queryFn }), []);
});

test('a Claude Code that can’t say is a failure to list, and it is closed all the same', async () => {
  const { project, configDir, calls } = setup([]);
  const queryFn = (args) => {
    calls.options = args.options;
    return {
      supportedAgents: () => Promise.reject(new Error('Claude Code exited.')),
      close: () => {
        calls.closed = true;
      },
    };
  };
  await assert.rejects(listClaudeAgents({ cwd: project, configDir, env: {}, queryFn }), /Claude Code exited/);
  assert.ok(calls.closed);
});

test('the registry tags each agent with its service, and makes them up in the demo', async () => {
  const demo = createProviders({ app: { isPackaged: false }, demo: true });
  assert.deepEqual(
    await demo.agents({ cwd: '/tmp/shop' }),
    DEMO_AGENTS.map((agent) => ({ ...agent, provider: 'claude' }))
  );
  assert.deepEqual(
    [...new Set(DEMO_AGENTS.map((agent) => agent.source))].sort(),
    ['personal', 'project'],
    'one of each, for both to be seen'
  );
});
