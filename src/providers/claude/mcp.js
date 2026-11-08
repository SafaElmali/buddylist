// Claude Code's MCP servers, in the app's words. What `/mcp` lists in a terminal.

// Where a server is set up, by the scope Claude Code names. Any other is shown by that name.
const ORIGINS = {
  user: 'Your Claude Code settings',
  project: 'This project',
  local: 'This folder, for you only',
  plugin: 'Plugin',
  claudeai: 'claude.ai connector',
  managed: 'Your organization',
  enterprise: 'Your organization',
  dynamic: 'This session',
};

/** Where it is reached: its URL, or for one that runs on this computer, the command that starts it. */
function addressOf(config) {
  if (config?.url) return String(config.url);
  if (config?.command) return [config.command, ...(config.args || [])].join(' ');
  return '';
}

/**
 * A server as the SDK reports it, as the app shows it. Nothing of its configuration but its
 * address is passed on: the headers and the environment it is given can hold secrets.
 * @param {import('@anthropic-ai/claude-agent-sdk').McpServerStatus} server
 * @returns {import('../contract.js').McpServer}
 */
export function toMcpServer({ name, status, error, config, scope, source, tools }) {
  // `source` tells a plugin's server from one given to this session; a Claude Code that predates it only has `scope`.
  const from = source || scope;
  const address = addressOf(config);
  return {
    name,
    status,
    ...(error && { error }),
    ...(address && { address }),
    ...(from && { origin: ORIGINS[from] || from }),
    ...(tools && { tools: tools.length }),
  };
}
