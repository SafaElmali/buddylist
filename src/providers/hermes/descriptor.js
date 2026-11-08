// What the windows need to know about Hermes. Plain data, no process spawning,
// so UI-only builds (like the web preview) can use it.

/** @type {import('../contract.js').ProviderDescriptor} */
export const descriptor = {
  id: 'hermes',
  appTools: true,
  name: 'Hermes',
  avatar: 'hermes',
  avatars: [{ id: 'hermes', label: 'Hermes wing' }],
  // Hermes's own modes, under the ids it gives them. They only decide what it asks before
  // changing a file: in each of them it runs commands without asking, unless it finds one dangerous.
  permissionModes: [
    { id: 'default', label: 'Ask before changing files', short: 'Asks first' },
    { id: 'accept_edits', label: 'Auto-accept file edits in this folder', short: 'Auto-accepts edits' },
    { id: 'dont_ask', label: 'Accept every file edit (risky!)', short: 'Accepts every edit', danger: true },
  ],
  defaultPermissionMode: 'default',
  planApprovals: [],
  commonCommands: ['help', 'tools', 'context', 'compress'],
  // Models are named "provider:model", and which ones exist depends on the
  // providers you have set up: `hermes model` picks them.
  modelSuggestions: [{ id: '', label: 'Default', hint: 'From your Hermes settings' }],
  modelPlaceholder: 'Type a model as provider:model',
  loginHint: 'Open Terminal and run "hermes model" to choose a provider and sign in. Then send your message again.',
};
