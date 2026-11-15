// What the windows need to know about Grok. Plain data, no process spawning,
// so UI-only builds (like the web preview) can use it.

/** @type {import('../contract.js').ProviderDescriptor} */
export const descriptor = {
  id: 'grok',
  appTools: true,
  name: 'Grok',
  avatar: 'grok',
  avatars: [{ id: 'grok', label: 'Grok mark' }],
  // Grok Build's own session modes, under the ids it gives them, and its always-approve as Never ask: no mode of its
  // sessions, but a switch on top of Ask before acting (see grok/index.js).
  permissionModes: [
    { id: 'default', label: 'Ask before acting', short: 'Asks first' },
    { id: 'plan', label: 'Plan mode (look, don’t touch)', short: 'Plan mode' },
    { id: 'yolo', label: 'Never ask (risky!)', short: 'Never asks', danger: true },
  ],
  defaultPermissionMode: 'default',
  readOnlyMode: 'plan',
  planApprovals: [],
  commonCommands: ['compact', 'context', 'memory'],
  // Which models there are depends on the account and Grok's own settings: `grok models` lists them.
  modelSuggestions: [{ id: '', label: 'Default', hint: 'From your Grok settings' }],
  modelPlaceholder: 'Search, or type a model name',
  loginHint: 'Open Terminal and run "grok login" (or set XAI_API_KEY). Then send your message again.',
};
