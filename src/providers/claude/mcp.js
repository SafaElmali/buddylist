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

/** A tool's name as Claude Code puts it at the end of the one it calls: what isn't a letter, digit, _ or - is _. */
const inToolName = (name) => String(name).replace(/[^\w-]/g, '_');

/**
 * The tool of an MCP server a call is for, as the server lists it. The server is found by its own name: Claude Code's
 * `mcp__<server>__<tool>` writes some servers' names differently, such as a claude.ai connector's. Null where that
 * isn't known: a server that isn't listed, a tool it doesn't list, or a call that could be either of two of its tools.
 * @param {import('@anthropic-ai/claude-agent-sdk').McpServerStatus[]} servers  as Claude Code lists them now
 * @param {string} toolName  the one called, `mcp__<server>__<tool>`
 * @param {string} [serverName]  the server Claude Code says the call is for. Without one, nothing is known
 */
export function calledTool(servers, toolName, serverName) {
  const tools = servers.find((server) => server.name === serverName)?.tools ?? [];
  // Its tool is the one whose name the call ends in, with the server's part before it.
  const called = tools.filter(({ name }) => {
    const end = `__${inToolName(name)}`;
    return toolName.endsWith(end) && toolName.length - end.length > 'mcp__'.length;
  });
  return called.length === 1 ? called[0] : null;
}

/**
 * Whether an MCP server's tool only reads, as the server says in its annotations: read-only, and not destructive.
 * Never by its name. One that isn't known, or that its server says nothing of, may change things.
 * @param {{ annotations?: { readOnly?: boolean, destructive?: boolean } } | null} tool  as its server lists it
 */
export const readsOnly = (tool) => Boolean(tool?.annotations?.readOnly && !tool.annotations.destructive);
