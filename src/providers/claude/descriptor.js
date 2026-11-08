// What the windows need to know about Claude. Plain data, no SDK imports,
// so UI-only builds (like the web preview) can use it.

/** @type {import('../contract.js').ProviderDescriptor} */
export const descriptor = {
  id: 'claude',
  name: 'Claude',
  avatar: 'claude',
  avatars: [
    { id: 'claude', label: 'Claude spark' },
    { id: 'claude-code', label: 'Claude Code mascot' },
  ],
  permissionModes: [
    { id: 'default', label: 'Ask before acting', short: 'Asks first' },
    { id: 'acceptEdits', label: 'Auto-accept file edits', short: 'Auto-accepts edits' },
    { id: 'plan', label: 'Plan mode (look, don’t touch)', short: 'Plan mode' },
    { id: 'bypassPermissions', label: 'Never ask (risky!)', short: 'Never asks', danger: true },
  ],
  defaultPermissionMode: 'default',
  // An agent that changes no files works in any mode: its session keeps it in a sandbox that writes nothing.
  readOnlyEveryMode: true,
  planApprovals: [
    { mode: 'acceptEdits', label: 'Yes, auto-accept edits', primary: true },
    { mode: 'default', label: 'Yes, ask before edits' },
  ],
  commonCommands: ['compact', 'review', 'init', 'context', 'cost', 'mcp'],
  // Claude Code takes tools from the app it runs in: the ones in main/app-tools.js.
  appTools: true,
  // Claude hands parts of a job to helpers (its subagents), and Claude Code says what each one does.
  helpers: true,
  // And says how each of its MCP servers is doing, before the first message too.
  mcp: true,
  // And how full its context window is, and how much of your plan's limits is used.
  usage: true,
  // Claude sets itself check-ins (CronCreate, ScheduleWakeup, /loop), and Claude Code lists them after a turn.
  checkIns: true,
  // Claude leaves commands and watchers (Monitor) running in the background, and Claude Code says when each starts and ends.
  background: true,
  // Claude Code keeps each message by the id it was sent with, and picks a conversation up at any of them: what
  // you sent can be edited, and Claude forgets what came after it.
  rewind: true,
  // And copies a conversation up to any of Claude's replies, into one of its own: a chat can be forked from a reply.
  fork: true,
  // A session can run as one of the agents you defined for Claude Code, in .claude/agents.
  customAgents: 'Claude Code',
  // The styles built into Claude Code, under the names it gives them. A
  // session adds the ones you wrote yourself.
  outputStyles: [
    { id: 'default', label: 'Default' },
    { id: 'Proactive', label: 'Proactive' },
    { id: 'Concise', label: 'Concise' },
    { id: 'Explanatory', label: 'Explanatory' },
    { id: 'Learning', label: 'Learning' },
  ],
  // Claude Code's own names for the newest model of each kind, in its words. It
  // says which version each is, and what else it has, when it is asked. Opus is
  // the one with fast mode.
  modelSuggestions: [
    { id: '', label: 'Default', hint: 'From your Claude settings' },
    { id: 'opus', label: 'Opus', hint: 'Best for everyday, complex tasks', fast: true },
    { id: 'fable', label: 'Fable', hint: 'Most capable for your hardest and longest-running tasks' },
    { id: 'sonnet', label: 'Sonnet', hint: 'Efficient for routine tasks' },
    { id: 'haiku', label: 'Haiku', hint: 'Fastest for quick answers' },
  ],
  modelPlaceholder: 'Search, or type a model name',
  // Claude Code says which of these each of its models takes when it is asked.
  efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
  // Which model and effort level it answers with when given none is up to its settings, which a project can
  // have its own of, and which /model changes in a terminal: its list is asked for again in a contact's folder.
  modelsByFolder: true,
  // Claude Code signs in through the browser by itself, so the app can start it. Each way is
  // named after the flag of `claude auth login` that asks for it.
  signIn: [
    { id: 'claudeai', label: 'Claude subscription', hint: 'Pro, Max, Team or Enterprise' },
    { id: 'console', label: 'Anthropic Console', hint: 'API usage billing' },
    { id: 'sso', label: 'Single sign-on (SSO)', hint: 'Through your organization' },
  ],
  // More accounts are signed in to the same way, each in a config folder of its own (accounts.js).
  accounts: true,
  // Claude Code comes with the app: there is no "claude" in a terminal to send anybody to.
  loginHint:
    'Sign in under Help > Getting started in the contact list (or set ANTHROPIC_API_KEY). Then send your message again.',
};
