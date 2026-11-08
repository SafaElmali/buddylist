// The agents a demo user defined for Claude Code in .claude/agents: what Invite offers on its "Your agents" tab
// in the demo and in the web preview, where there is no Claude Code to ask. One is the project's, one their own.

/** @type {readonly Omit<import('../contract.js').CustomAgent, 'provider'>[]} */
export const DEMO_AGENTS = Object.freeze([
  {
    name: 'code-reviewer',
    description: 'Reviews a change for bugs, missed cases and code that doesn’t fit the project. Use it before a PR.',
    model: 'sonnet',
    source: 'project',
  },
  {
    name: 'test-writer',
    description: 'Writes the tests a change is missing, then runs them.',
    model: 'inherit',
    source: 'personal',
  },
]);
