// "MCP Servers": what /mcp lists in a terminal. Every MCP server the host's agent
// has, how each is doing, and what can be done about it: reconnect it, sign in to
// it, turn it off or on again.
import { api } from '../lib/api.js';
import { el, errorText, html, raw } from '../lib/dom.js';
import { openDialog } from '../lib/dialog.js';
import { buddy } from '../lib/icons.js';
import {
  MCP_ACTION_LABELS,
  mcpActionsFor,
  mcpDetail,
  mcpMatching,
  mcpOrder,
  mcpSettling,
  mcpStatus,
  mcpSummary,
} from '../../shared/mcp.js';

/** @typedef {import('../../providers/contract.js').McpServer} McpServer */

// A server on its way to connecting, or one being signed in to in the browser, is asked about again this often.
const AGAIN_MS = 1500;
// Signing in takes as long as the user takes. After this the list stops asking by itself.
const SIGN_IN_MS = 3 * 60 * 1000;

/**
 * @param {{ contactId: string, participants: { name: string }[] }} ctx  the servers are the host's
 * @returns {Promise<void>}  when the dialog is closed
 */
export function mcpDialog({ contactId, participants }) {
  const who = participants[0].name;
  const body = el(
    html`<div class="mcp">
      <div class="mcp-head">
        <span class="mcp-summary">Asking ${who} about its MCP servers...</span>
        <button class="btn mcp-refresh" type="button" disabled>Refresh</button>
      </div>
      <input
        type="text"
        class="mcp-search"
        placeholder="Search MCP servers..."
        aria-label="Search MCP servers"
        spellcheck="false"
      />
      <div class="mcp-list" role="list" hidden></div>
      <div class="hint mcp-none" hidden>No MCP server matches that.</div>
      <div class="hint mcp-note" hidden></div>
      <div class="error" hidden></div>
    </div>`
  );
  const summary = /** @type {HTMLElement} */ (body.querySelector('.mcp-summary'));
  const refresh = /** @type {HTMLButtonElement} */ (body.querySelector('.mcp-refresh'));
  const search = /** @type {HTMLInputElement} */ (body.querySelector('.mcp-search'));
  const list = /** @type {HTMLElement} */ (body.querySelector('.mcp-list'));
  const none = /** @type {HTMLElement} */ (body.querySelector('.mcp-none'));
  const note = /** @type {HTMLElement} */ (body.querySelector('.mcp-note'));
  const error = /** @type {HTMLElement} */ (body.querySelector('.error'));

  /** @type {McpServer[]} */
  let servers = [];
  // The order the rows were first listed in: a server that connects stays where it is.
  /** @type {string[]} */
  const rows = [];
  /** @type {Map<string, import('../../shared/mcp.js').McpAction>} what is being done about a server right now */
  const doing = new Map();
  /** @type {Map<string, string>} why that didn't work, until something else is tried on it */
  const failed = new Map();
  /** @type {Map<string, number>} the servers being signed in to in the browser, and until when to follow along */
  const signingIn = new Map();
  let closed = false;
  let asked = 0;
  let again;
  let drawn = '';

  const row = (/** @type {McpServer} */ server) => {
    const busy = doing.get(server.name);
    const why = failed.get(server.name) || server.error;
    return html`<div class="mcp-row" role="listitem" data-name="${server.name}">
      <span class="mcp-buddy">${raw(buddy(mcpStatus(server.status).buddy))}</span>
      <div class="mcp-about">
        <div class="mcp-name">${server.name}</div>
        <div class="mcp-detail">${busy ? MCP_ACTION_LABELS[busy].doing : mcpDetail(server)}</div>
        ${server.address ? html`<div class="mcp-address" title="${server.address}">${server.address}</div>` : ''}
        ${why ? html`<div class="mcp-error">${why}</div>` : ''}
      </div>
      <div class="mcp-actions">
        ${mcpActionsFor(server).map(
          (action) =>
            html`<button class="btn" type="button" data-action="${action}" ${busy ? 'disabled' : ''}>
              ${MCP_ACTION_LABELS[action].label}
            </button>`
        )}
      </div>
    </div>`;
  };

  const draw = () => {
    // New names go in by what needs the user first; the ones already listed keep their place.
    const known = new Set(rows);
    rows.push(
      ...mcpOrder(servers)
        .map((server) => server.name)
        .filter((name) => !known.has(name))
    );
    const listed = mcpMatching(
      rows.flatMap((name) => servers.find((server) => server.name === name) ?? []),
      search.value
    );
    summary.textContent = mcpSummary(servers);
    // Shown while they are asked about; with no servers to search, it goes.
    search.hidden = !servers.length;
    list.hidden = !listed.length;
    none.hidden = !servers.length || listed.length > 0;
    // Asked again every moment or two, it mostly says the same: the rows, and a button under the pointer, stay.
    const showing = JSON.stringify([listed, [...doing], [...failed]]);
    if (showing === drawn) return;
    drawn = showing;
    list.replaceChildren(...listed.map((server) => el(row(server))));
  };

  const load = async () => {
    clearTimeout(again);
    const turn = ++asked;
    refresh.disabled = true;
    try {
      const answer = await api.chat.mcpServers(contactId);
      // Closed meanwhile, or asked again since: this answer is the older one.
      if (closed || turn !== asked) return;
      servers = answer;
      error.hidden = true;
    } catch (err) {
      if (closed || turn !== asked) return;
      error.textContent = errorText(err);
      error.hidden = false;
      if (!servers.length) {
        summary.textContent = `${who} couldn’t be asked about its MCP servers.`;
        search.hidden = true;
      }
      refresh.disabled = false;
      return;
    }
    refresh.disabled = false;
    for (const [name, until] of signingIn) {
      const server = servers.find((known) => known.name === name);
      if (server?.status !== 'needs-auth' || Date.now() > until) signingIn.delete(name);
    }
    note.hidden = !signingIn.size;
    draw();
    if (servers.some(mcpSettling) || signingIn.size) again = setTimeout(load, AGAIN_MS);
  };

  const act = async (name, action) => {
    if (doing.has(name)) return;
    doing.set(name, action);
    failed.delete(name);
    signingIn.delete(name);
    draw();
    try {
      const { browser } = await api.chat.mcpAct(contactId, name, action);
      if (browser) {
        signingIn.set(name, Date.now() + SIGN_IN_MS);
        note.textContent = `Finish signing in to ${name} in your browser. This list follows along.`;
      }
    } catch (err) {
      failed.set(name, errorText(err));
    }
    doing.delete(name);
    if (closed) return;
    // Its row says how that went: the new status, or why not.
    await load();
  };

  list.addEventListener('click', (e) => {
    const button = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-action]'));
    const name = /** @type {HTMLElement | null} */ (button?.closest('.mcp-row'))?.dataset.name;
    if (name) act(name, button.dataset.action);
  });
  refresh.addEventListener('click', load);
  // Before the first answer there is nothing to filter: that answer is drawn with what was typed.
  search.addEventListener('input', () => servers.length && draw());

  const dialog = openDialog({ title: 'MCP Servers', body, buttons: [{ label: 'Close', value: null, default: true }] });
  search.focus();
  load();
  return dialog.result.then(() => {
    closed = true;
    clearTimeout(again);
  });
}
