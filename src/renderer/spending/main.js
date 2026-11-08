// The Spending window: what every contact cost today, this week and this month, then each contact
// that spent anything, the most this month first. The main process works it out from the message
// history; the window asks again when a contact finishes a turn, when the history changes, when you
// come back to it, and at midnight, when today starts over.
// First, so that an error in what the lines below load is reported too.
import '../lib/error-reports.js';
// Next, so that the window is drawn in its look from the start.
import '../lib/look.js';
import { api } from '../lib/api.js';
import { $, el, html, raw } from '../lib/dom.js';
import { dollars } from '../lib/format.js';
import { mountFrame } from '../lib/frame.js';
import { feedbackDialog } from '../lib/feedback-dialog.js';
import { aboutItem, docsItem } from '../lib/help.js';
import { closeMenu } from '../lib/menu.js';
import { setPack } from '../lib/pack.js';
import { pictureHtml } from '../lib/pictures.js';
import { statusLine, totals } from './report.js';

/** @typedef {import('./report.js').SpendingReport} SpendingReport */

const IS_MAC = navigator.platform.toLowerCase().includes('mac');
const MOD = IS_MAC ? '⌘' : 'Ctrl+';

// Counts the reports asked for, so a slow answer can't replace a newer one.
let asked = 0;
let midnight = 0;
let shown = false;

/** @param {SpendingReport} report */
function render(report) {
  $('#totals').replaceChildren(
    ...totals(report).map(({ label, amount, since }) =>
      el(
        html`<div class="sp-total">
          <div class="sp-label">${label}</div>
          <div class="sp-amount" title="${amount}">${amount}</div>
          <div class="sp-since" title="${since}">${since}</div>
        </div>`
      )
    )
  );
  $('#contacts').replaceChildren(
    el(
      html`<div class="sp-row sp-head" role="row">
        <span role="columnheader">Contact</span>
        <span class="sp-money" role="columnheader">This week</span>
        <span class="sp-money" role="columnheader">This month</span>
      </div>`
    ),
    ...(report.contacts.length
      ? report.contacts.map((contact) =>
          el(
            html`<div class="sp-row" role="row">
              <span class="sp-who" role="rowheader">
                ${raw(pictureHtml({ avatar: contact.avatar, size: 'tiny' }))}
                <span class="sp-name" title="${contact.name}">${contact.name}</span>
                ${contact.archived && html`<span class="sp-archived">(Archived)</span>`}
              </span>
              <span class="sp-money" role="cell">${dollars(contact.week)}</span>
              <span class="sp-money" role="cell">${dollars(contact.month)}</span>
            </div>`
          )
        )
      : [
          el(
            html`<div role="row">
              <div class="sp-empty" role="cell" aria-colspan="3">No reported spending this week or this month.</div>
            </div>`
          ),
        ])
  );
  $('#status').textContent = statusLine(report.uncounted);
  shown = true;
}

async function refresh() {
  const request = ++asked;
  try {
    const report = await api.spending.read();
    if (request !== asked) return;
    if (!report) throw new Error('No spending report was returned.');
    render(report);
  } catch {
    if (request !== asked) return;
    $('#status').textContent = shown
      ? 'Couldn’t refresh spending. Showing the last report. Choose File > Refresh to try again.'
      : 'Couldn’t load spending. Choose File > Refresh to try again.';
  }
  // Today is yesterday at midnight, whether or not anything happens by then.
  const now = new Date();
  clearTimeout(midnight);
  midnight = setTimeout(
    refresh,
    new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime()
  );
}

/** What of a contact the window shows, or that says it finished a turn: its status goes from busy. */
const standing = (contact) => `${contact.name} ${contact.avatar} ${contact.status} ${Boolean(contact.archived)}`;

async function main() {
  setPack(await api.pack.list());
  mountFrame({
    title: 'Spending',
    menus: [
      {
        label: 'File',
        items: () => [
          { label: 'Refresh', hint: `${MOD}R`, action: refresh },
          { separator: true },
          { label: 'Close', hint: `${MOD}W`, role: 'close', action: () => api.window.close() },
        ],
      },
      {
        label: 'Help',
        items: () => [
          docsItem(api.app.openExternal),
          { label: 'Send feedback...', action: feedbackDialog },
          { separator: true },
          aboutItem(api.app.version),
        ],
      },
    ],
  });
  /** contactId -> its standing, as the list last said */
  let before = new Map();
  api.on.contacts((contacts) => {
    const now = new Map(contacts.map((contact) => [contact.id, standing(contact)]));
    const changed = now.size !== before.size || [...now].some(([id, said]) => before.get(id) !== said);
    before = now;
    if (changed) refresh();
  });
  // A past conversation was deleted, or one moved into the history or out of it.
  api.on.history(() => refresh());
  let inFront = true;
  api.on.windowState(({ focused }) => {
    if (focused && !inFront) refresh();
    inFront = focused;
  });
  window.addEventListener('blur', closeMenu);
  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r' && !document.querySelector('.modal')) {
      event.preventDefault();
      refresh();
    }
  });
  await refresh();
}

main();
