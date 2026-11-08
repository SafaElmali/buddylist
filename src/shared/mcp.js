// The MCP servers of a session as the app shows them: what each status is called,
// which buddy it wears, and what can be done about a server in it.

/** @typedef {import('../providers/contract.js').McpServer} McpServer */
/** @typedef {'reconnect' | 'sign-in' | 'enable' | 'disable'} McpAction */

/** @type {readonly McpAction[]} what the user can do about a server */
export const MCP_ACTIONS = Object.freeze(['reconnect', 'sign-in', 'enable', 'disable']);

/** What each is called on its button, and while it is going on. */
export const MCP_ACTION_LABELS = Object.freeze({
  reconnect: { label: 'Reconnect', doing: 'Reconnecting...' },
  'sign-in': { label: 'Sign in', doing: 'Opening your browser...' },
  enable: { label: 'Enable', doing: 'Enabling...' },
  disable: { label: 'Disable', doing: 'Disabling...' },
});

// In the order they are listed and counted: what needs the user first, what is switched off last.
// `buddy` is the status icon a contact would wear for it: waiting for you is "away", as for a contact.
// One signed in to somewhere else, as a claude.ai connector is, connects when it is asked to again.
const STATUSES = {
  failed: { label: 'Failed', count: 'failed', buddy: 'busy', actions: ['reconnect', 'disable'] },
  'needs-auth': {
    label: 'Needs sign-in',
    count: 'not signed in',
    buddy: 'away',
    actions: ['sign-in', 'reconnect', 'disable'],
  },
  pending: { label: 'Connecting...', count: 'connecting', buddy: 'offline', actions: ['disable'] },
  connected: { label: 'Connected', count: 'connected', buddy: 'online', actions: ['reconnect', 'disable'] },
  disabled: { label: 'Disabled', count: 'disabled', buddy: 'offline', actions: ['enable'] },
};
const ORDER = Object.keys(STATUSES);

/**
 * How a status is shown. One the app doesn't know is shown by its own name, with nothing to do about it.
 * @param {string} status
 * @returns {{ label: string, buddy: string }}
 */
export function mcpStatus(status) {
  const { label, buddy } = STATUSES[status] || { label: status, buddy: 'offline' };
  return { label, buddy };
}

/**
 * What can be done about a server, the most likely first.
 * @param {Pick<McpServer, 'status'>} server
 * @returns {McpAction[]}
 */
export function mcpActionsFor({ status }) {
  return [...(STATUSES[status]?.actions || [])];
}

/** A server is still on its way to connecting: its status is worth asking for again. */
export const mcpSettling = ({ status }) => status === 'pending';

/**
 * The servers that need the user first, then the ones that work, then the ones switched off.
 * By name within each.
 * @template {Pick<McpServer, 'name' | 'status'>} T
 * @param {T[]} servers
 * @returns {T[]}
 */
export function mcpOrder(servers) {
  // A status the app doesn't know goes before the ones switched off.
  const rank = ({ status }) => (ORDER.includes(status) ? ORDER.indexOf(status) : ORDER.length - 1.5);
  return [...servers].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
}

/**
 * The servers with `query` in their name, address, where they are set up or how they are doing, in any letter case.
 * @template {Pick<McpServer, 'name' | 'status' | 'address' | 'origin'>} T
 * @param {T[]} servers
 * @param {string} query
 * @returns {T[]}
 */
export function mcpMatching(servers, query) {
  const q = String(query ?? '')
    .trim()
    .toLowerCase();
  if (!q) return servers;
  return servers.filter(({ name, address, origin, status }) =>
    [name, address, origin, mcpStatus(status).label].some((text) => text?.toLowerCase().includes(q))
  );
}

/**
 * One line about all of them: "6 MCP servers: 1 failed, 2 not signed in, 3 connected."
 * @param {Pick<McpServer, 'status'>[]} servers
 */
export function mcpSummary(servers) {
  if (!servers.length) return 'No MCP servers are set up here.';
  const counts = ORDER.map((status) => [servers.filter((s) => s.status === status).length, STATUSES[status].count]);
  const parts = counts.filter(([count]) => count).map(([count, what]) => `${count} ${what}`);
  const total = `${servers.length} MCP server${servers.length === 1 ? '' : 's'}`;
  return parts.length ? `${total}: ${parts.join(', ')}.` : `${total}.`;
}

/**
 * A few words about all of them, for a glance: what needs the user, or is on its way to
 * connecting, or else how many work. "1 failed, 2 not signed in", "3 connected".
 * @param {Pick<McpServer, 'status'>[]} servers
 * @returns {{ text: string, attention: boolean }}  `attention`: one of them needs the user
 */
export function mcpGlance(servers) {
  if (!servers.length) return { text: 'None set up', attention: false };
  const counted = (statuses) =>
    statuses
      .map((status) => [servers.filter((s) => s.status === status).length, STATUSES[status].count])
      .filter(([count]) => count)
      .map(([count, what]) => `${count} ${what}`);
  const needs = counted(['failed', 'needs-auth']);
  const parts = [...needs, ...counted(['pending'])];
  // Only statuses the app doesn't know: there are this many, and nothing more to say.
  const text = (parts.length ? parts : counted(['connected', 'disabled'])).join(', ') || `${servers.length} set up`;
  return { text, attention: needs.length > 0 };
}

/**
 * What a server's row says under its name: how it is doing, how many tools it has, where it comes from.
 * @param {McpServer} server
 */
export function mcpDetail({ status, tools, origin }) {
  const count = status === 'connected' && tools ? `${tools} tool${tools === 1 ? '' : 's'}` : '';
  return [mcpStatus(status).label, count, origin].filter(Boolean).join(' · ');
}
