// What the windows need to know about OpenCode. Plain data, no process
// spawning, so UI-only builds (like the web preview) can use it.

/** @type {import('../contract.js').ProviderDescriptor} */
export const descriptor = {
  id: 'opencode',
  appTools: true,
  name: 'OpenCode',
  avatar: 'opencode',
  avatars: [{ id: 'opencode', label: 'OpenCode brackets' }],
  // opencode's modes are its two built-in agents. What "Build" asks before
  // doing is decided by the "permission" settings in your opencode.json, and
  // out of the box that is nothing.
  permissionModes: [
    { id: 'build', label: 'Build (asks only where your opencode settings say so)', short: 'Build' },
    { id: 'plan', label: 'Plan (look, don’t touch)', short: 'Plan' },
  ],
  defaultPermissionMode: 'build',
  readOnlyMode: 'plan',
  planApprovals: [],
  commonCommands: ['init', 'review', 'compact'],
  // Models are named "provider/model", and which ones exist depends on the
  // providers you have set up: `opencode models` lists them.
  modelSuggestions: [{ id: '', label: 'Default', hint: 'From your opencode settings' }],
  modelPlaceholder: 'Type a model as provider/model',
  loginHint: 'Open Terminal and run "opencode auth login". Then send your message again.',
};
