// What the windows need to know about Gemini. Plain data, no process spawning,
// so UI-only builds (like the web preview) can use it.

/** @type {import('../contract.js').ProviderDescriptor} */
export const descriptor = {
  id: 'gemini',
  appTools: true,
  name: 'Gemini',
  avatar: 'gemini',
  avatars: [{ id: 'gemini', label: 'Gemini twins' }],
  // Gemini CLI's own approval modes, under the ids it gives them.
  permissionModes: [
    { id: 'default', label: 'Ask before acting', short: 'Asks first' },
    { id: 'autoEdit', label: 'Auto-accept file edits', short: 'Auto-accepts edits' },
    { id: 'plan', label: 'Plan mode (look, don’t touch)', short: 'Plan mode' },
    { id: 'yolo', label: 'Never ask (risky!)', short: 'Never asks', danger: true },
  ],
  defaultPermissionMode: 'default',
  readOnlyMode: 'plan',
  planApprovals: [],
  commonCommands: ['memory', 'extensions', 'init', 'restore', 'about', 'help'],
  // The Gemini CLI's own names for the newest model of each kind.
  modelSuggestions: [
    { id: '', label: 'Default', hint: 'From your Gemini settings' },
    { id: 'auto', label: 'Auto', hint: 'Picks one for each task' },
    { id: 'pro', label: 'Pro', hint: 'Most capable' },
    { id: 'flash', label: 'Flash', hint: 'Fast' },
    { id: 'flash-lite', label: 'Flash-Lite', hint: 'Fastest' },
  ],
  modelPlaceholder: 'Search, or type a model name',
  loginHint:
    'Open Terminal, run "gemini" and choose how to sign in (or set GEMINI_API_KEY). Then send your message again.',
};
