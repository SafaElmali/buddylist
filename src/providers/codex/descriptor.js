// What the windows need to know about Codex. Plain data, no process spawning,
// so UI-only builds (like the web preview) can use it.

/** @type {import('../contract.js').ProviderDescriptor} */
export const descriptor = {
  id: 'codex',
  appTools: true,
  cancelQueued: true,
  name: 'Codex',
  avatar: 'codex',
  avatars: [{ id: 'codex', label: 'Codex prompt' }],
  // What each mode means to Codex is in session.js (POLICIES).
  permissionModes: [
    { id: 'ask', label: 'Ask before acting', short: 'Asks first' },
    { id: 'auto', label: 'Work freely inside this folder', short: 'Works in this folder' },
    { id: 'read-only', label: 'Read only (look, don’t touch)', short: 'Read only' },
    { id: 'full-access', label: 'Never ask (risky!)', short: 'Never asks', danger: true },
  ],
  defaultPermissionMode: 'ask',
  readOnlyMode: 'read-only',
  // An agent that changes no files works in any mode: its session keeps it in a sandbox that writes nothing.
  readOnlyEveryMode: true,
  planApprovals: [],
  // Codex's own; a session adds the skills it finds (session.js).
  commonCommands: ['compact', 'review'],
  // Codex says how full a thread's context window is, and how much of your plan's limits is used.
  usage: true,
  // As Codex listed them when this was written. It says what it has now when it is asked.
  modelSuggestions: [
    { id: '', label: 'Default', hint: 'From your Codex settings' },
    { id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol', hint: 'Latest workhorse model for coding and everyday work' },
    { id: 'gpt-6-astra', label: 'GPT-6-Astra', hint: 'Frontier intelligence for the most demanding work' },
    { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', hint: 'GPT-6.1 Terra Codex model' },
    { id: 'gpt-6-sol', label: 'GPT-6-Sol', hint: 'Previous generation workhorse model' },
    { id: 'gpt-6-luna', label: 'GPT-6-Luna', hint: 'Fast and affordable model for easier tasks' },
  ],
  modelPlaceholder: 'Search, or type a model name',
  // The levels every Codex model takes. It says which others each has when it is asked.
  efforts: ['low', 'medium', 'high'],
  loginHint: 'Open Terminal and run "codex login" (or set OPENAI_API_KEY). Then send your message again.',
};
