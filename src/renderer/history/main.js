// The message history window: a contact's conversations, newest first, or every contact's
// under the days they were last added to, and a read-only transcript of the one you pick.
// Continue picks it up again in its conversation window. The main process says when a
// conversation was archived, picked up or deleted, and the list follows. Every contact's
// also lists the conversations held outside the app, such as Claude Code's in a terminal, by
// folder: from the first day, before any contact works there. Why the one picked can't be
// continued or deleted is said over the list, with the way on when there is one.
// First, so that an error in what the lines below load is reported too.
import '../lib/error-reports.js';
// Next, so that the window is drawn in its look from the start.
import '../lib/look.js';
import { api } from '../lib/api.js';
import { $, el, errorText, html } from '../lib/dom.js';
import { confirmDialog, infoDialog, messageBody } from '../lib/dialog.js';
import { formatDate, formatTime, plural, shortPath } from '../lib/format.js';
import { mountFrame } from '../lib/frame.js';
import { feedbackDialog } from '../lib/feedback-dialog.js';
import { aboutItem, docsItem } from '../lib/help.js';
import { mediaItems } from '../lib/media-menu.js';
import { closeMenu, openMenu } from '../lib/menu.js';
import { setPack } from '../lib/pack.js';
import { sounds } from '../lib/sounds.js';
import { ActivityLines } from '../chat/activity.js';
import { Conversation } from '../chat/conversation.js';
import { Invitations } from '../chat/invitations.js';
import { readMyColor } from '../chat/my-color.js';
import { speakersIn } from '../chat/participants.js';
import { openLinksInBrowser, renderEntries } from '../chat/transcript.js';
import { contactDialog } from '../contacts/contact-dialog.js';
import {
  canDelete,
  deleteQuestion,
  emptyNote,
  heldStatus,
  keptBecause,
  noteFor,
  stuckBecause,
  unreadableText,
} from './held.js';
import { highlight } from './highlight.js';
import { ConversationList, keyOf, when } from './list.js';

/** @typedef {import('./list.js').Listed} Listed */
/** @typedef {import('./list.js').HeldFolder} HeldFolder */

const IS_MAC = navigator.platform.toLowerCase().includes('mac');
const MOD = IS_MAC ? '⌘' : 'Ctrl+';

const params = new URLSearchParams(location.search);
/** The contact whose conversations the window lists. Without one, it lists every contact's. */
const only = params.get('contactId');
// Its list is wider: each row says whose the conversation is too.
document.body.classList.toggle('all-contacts', !only);

const state = {
  /** @type {Map<string, any>} contactId -> the contact as the contact list shows it: `only`, or everyone */
  contacts: new Map(),
  /** @type {Listed[]} every conversation there is to list */
  all: [],
  /** @type {Listed[]} the ones in the list: all of them, or those the search found */
  listed: [],
  /** @type {string | null} the selected one, by keyOf */
  selectedKey: null,
  query: '',
  /** @type {{ summary: Listed, query: string } | null} what the transcript is showing */
  shown: null,
  /** @type {HeldFolder[]} in every contact's: the folders conversations were held in outside the app, with them */
  heldAll: [],
  /** @type {HeldFolder[]} the ones in the list: all of them, or those the search found */
  held: [],
  /** @type {import('./held.js').Unreadable[]} where conversations held outside the app could not be read from */
  unreadable: [],
  /** What Add a Contact offers, in every contact's: the services and groups there are, and the settings. */
  adding: { providers: [], groups: [], settings: /** @type {any} */ ({}), web: false },
};

// What the conversation window's renderers read. `contact.cwd` becomes the folder of the
// conversation on show, so its files are named the way they were in that conversation. And
// `participants` whoever has lines in it, so each line is named as it was written.
const ctx = { contact: null, participants: [], profile: null, myColor: readMyColor() };
const conversation = new Conversation($('#conversation'), ctx);
const pane = {
  conversation,
  activities: new ActivityLines(conversation, ctx),
  // Read-only: the invitations in here were answered long ago.
  invitations: new Invitations(conversation, ctx, () => {}),
};
const list = new ConversationList(
  $('#list'),
  (key) => select(key),
  continueConversation,
  only ? null : (id) => state.contacts.get(id),
  addHere
);
let frame;
// Counts the listings asked for, so a slow answer to an old search can't replace a newer one.
let asked = 0;
// The pause in the typing that a search waits for.
let typing = 0;
// Set while a conversation is being picked up: one held elsewhere is copied first.
let resuming = false;

/** The ones held outside the app listed under their folders, as rows: each with its folder, and the contact there. */
const heldRows = () =>
  state.held.flatMap((folder) =>
    folder.conversations.map((c) => ({ ...c, contactId: folder.contactId ?? '', folder }))
  );
/** Every row there is to pick, in the order of the list. */
const rows = () => [...state.listed, ...heldRows()];
const selected = () => rows().find((c) => keyOf(c) === state.selectedKey) || null;
/** @param {Listed} c */
const contactOf = (c) => state.contacts.get(c.contactId);
/** The contact's deletable conversations, including its current one while archived. */
const removable = () => (only ? state.all.filter((c) => canDelete(c, contactOf(c))) : []);
const deletable = () => canDelete(selected(), selected() && contactOf(selected()));
const counted = (n) => `${n} conversation${n === 1 ? '' : 's'}`;

/** Why the selected conversation can't be continued, for the button to say: '' when it can. */
const stuck = () => (selected() ? stuckBecause(selected(), contactOf(selected())) : '');
const continuable = () => Boolean(selected() && contactOf(selected())) && !stuck() && !resuming;
/** Only a conversation with a contact is saved: the file is named after it, and so is what it said. */
const savable = () => Boolean(selected() && contactOf(selected()));

// ---- drawing ---------------------------------------------------------------------------------

function renderChrome() {
  $('#continue').disabled = !continuable();
  $('#continue').title = stuck();
  $('#save').disabled = !savable();
  $('#delete').disabled = !deletable();
  $('#delete').title = keptBecause(selected(), selected() && contactOf(selected()));
  $('#delete-all').disabled = !removable().length;
  $('#statusbar').textContent = statusLine();
  renderNote();
}

/**
 * The line over the list: why the conversation picked can't be continued or deleted, with the way on when
 * there is one, and where conversations held outside the app could not be read from.
 */
function renderNote() {
  const one = selected();
  const note = noteFor(one, one && contactOf(one));
  const lines = [
    ...(note ? [{ text: note.text, there: note.there }] : []),
    ...state.unreadable.map((u) => ({ text: unreadableText(u), there: false })),
  ];
  $('#note').hidden = !lines.length;
  $('#note').replaceChildren(
    ...lines.map(({ text, there }) => {
      const line = el(
        html`<div class="hs-note-line">
          <span class="hs-note-text">${text}</span>
          ${there && html`<button class="link hs-there" type="button" ${resuming ? 'disabled' : ''}>Continue in a new contact there</button>`}
        </div>`
      );
      line.querySelector('.hs-there')?.addEventListener('click', () => continueThere(one));
      return line;
    })
  );
}

function statusLine() {
  const total = counted(state.all.length);
  const held = heldStatus(state.heldAll);
  if (state.query) {
    const found = `Found “${state.query}” in ${state.listed.length} of ${total}`;
    return held ? `${found}, and in ${heldRows().length} of ${held}.` : `${found}.`;
  }
  if (!only) {
    const people = new Set(state.all.map((c) => c.contactId)).size;
    const own = state.all.length ? `${total} with ${people} ${plural(people, 'contact')}` : '';
    if (own && held) return `${own}, and ${held}.`;
    if (held) return `No conversations with your contacts yet, and ${held}.`;
    return own ? `${own}.` : 'No conversations yet.';
  }
  const { name } = state.contacts.get(only);
  const elsewhere = state.all.filter((c) => c.where);
  if (elsewhere.length) return `${total} with ${name}, ${elsewhere.length} of them held in ${elsewhere[0].where}.`;
  return state.all.length ? `${total} with ${name}.` : `No conversations with ${name} yet.`;
}

const drawList = () =>
  list.render(
    state.listed,
    state.selectedKey,
    only
      ? state.query
        ? `No conversation contains “${state.query}”.`
        : 'No conversations yet.'
      : emptyNote({ query: state.query, where: [...new Set(state.held.map((folder) => folder.where))].join(' and ') }),
    state.held
  );

/**
 * @param {Listed} c
 * @param {any} [contact]  whose it is: named in the window with every contact's. None for one held outside the
 *   app in a folder no contact works in
 */
function renderAbout(c, contact) {
  const sameDay = formatDate(c.startedAt) === formatDate(c.endedAt);
  const until = sameDay ? formatTime(c.endedAt) : when(c.endedAt);
  const what = c.current ? 'Current conversation' : c.where ? `Conversation in ${c.where}` : 'Conversation';
  const whose = only || !contact ? '' : ` with ${contact.name}`;
  $('#about').replaceChildren(
    ...el(
      html`<div>
        <span class="to-label">${what}${whose}:</span>
        <b>${when(c.startedAt)} – ${until}</b>
        <span class="to-addr">&lt;${shortPath(c.cwd)}&gt;</span>
      </div>`
    ).childNodes
  );
  $('#about').title = c.cwd;
}

/** Draws the selected conversation, unless it is on show already with nothing new in it. */
async function show() {
  const summary = selected();
  const { shown } = state;
  const drawn =
    Boolean(shown && summary) && keyOf(shown.summary) === keyOf(summary) && shown.summary.endedAt === summary.endedAt;
  if (drawn && shown.query === state.query) return;
  if (!drawn) {
    let full = null;
    let unread = '';
    try {
      full = summary && (await readOne(summary));
      if (summary && !full) unread = 'This conversation is gone.';
    } catch (err) {
      unread = errorText(err);
    }
    // You picked another one while this one was being fetched, or the list was drawn again.
    if (summary ? keyOf(summary) !== state.selectedKey : state.selectedKey !== null) return;
    conversation.clear();
    $('#about').hidden = !full;
    state.shown = full ? { summary, query: '' } : null;
    if (!full) {
      highlight(conversation.root, '');
      // Not an empty transcript: one that could not be read says why.
      if (unread) conversation.root.append(el(html`<div class="hs-empty hs-unread">${unread}</div>`));
      return;
    }
    // One held outside the app in a folder no contact works in is drawn as its agent's, by its service's name.
    const contact = contactOf(summary) ?? heldBy(summary);
    ctx.contact = { ...contact, cwd: full.cwd };
    ctx.participants = speakersIn(full.entries, contact);
    renderAbout(full, contactOf(summary));
    renderEntries(full.entries, pane);
    // A transcript is read from the start, unlike a conversation that is going on.
    conversation.root.scrollTop = 0;
  }
  state.shown.query = state.query;
  // A match in the lines a run of tool calls is folded over is shown there.
  pane.activities.unfold(state.query);
  const [first] = highlight(conversation.root, state.query);
  first?.startContainer.parentElement.scrollIntoView({ block: 'center' });
}

/**
 * One conversation, whole: as its contact has it, or for one held outside the app under its folder, as its
 * agent keeps it there.
 * @param {Listed} c
 */
const readOne = (c) =>
  c.folder ? api.history.readHeld(c.folder.provider, c.cwd, c.id) : api.history.read(c.contactId, c.id);

/** Whose a conversation held outside the app is, with no contact in its folder: its service's, by name. */
function heldBy(c) {
  const name = state.adding.providers.find((p) => p.id === c.folder?.provider)?.name ?? c.where;
  return { id: '', name, provider: c.folder?.provider };
}

/** Asks for the conversations again and redraws whatever changed. */
async function refresh() {
  const request = ++asked;
  const { query } = state;
  // A contact's own come with where the ones held outside the app could not be read from.
  const ask = async (text) => {
    if (!only) return { conversations: await api.history.listAll(text), unreadable: [] };
    return api.history.list(only, text);
  };
  // Every folder's held outside the app are asked for beside them, and drawn once they are there.
  const asking = only ? null : Promise.all([api.history.listHeld(''), query ? api.history.listHeld(query) : null]);
  const [all, found] = await Promise.all([ask(''), query ? ask(query) : null]);
  if (request !== asked) return;
  // A contact's own say whose they are like every contact's do. One whose contact just went is left out.
  const known = (listed) =>
    listed.map((c) => ({ contactId: only, ...c })).filter((c) => state.contacts.has(c.contactId));
  state.all = known(all.conversations);
  state.listed = found ? known(found.conversations) : state.all;
  if (only) state.unreadable = (found ?? all).unreadable;
  drawn();
  if (!asking) return show();
  const [heldAll, heldFound] = await asking;
  if (request !== asked) return;
  state.heldAll = heldAll.folders;
  state.held = heldFound ? heldFound.folders : heldAll.folders;
  state.unreadable = (heldFound ?? heldAll).unreadable;
  drawn();
  await show();
}

/** The list and what is around it drawn again, with a conversation picked if there is one to pick. */
function drawn() {
  if (!selected()) state.selectedKey = rows()[0] ? keyOf(rows()[0]) : null;
  drawList();
  renderChrome();
}

// ---- actions ---------------------------------------------------------------------------------

function select(key) {
  state.selectedKey = key;
  list.select(key);
  renderChrome();
  show();
}

function search(text) {
  state.query = text.trim();
  return refresh();
}

/**
 * Searches for `text` as if you had typed it in the box. The contact list does this when
 * you open a conversation its own search found.
 */
function searchFor(text) {
  /** @type {HTMLInputElement} */ ($('#search')).value = text;
  clearTimeout(typing);
  return search(text);
}

/**
 * Comes up on what the window was asked to: the search the contact list's found a conversation with,
 * which goes on in here, or a conversation picked in the palette (⌘K), selected where it is in the list.
 * @param {{ query?: string, conversation?: string }} asked
 */
async function openOn({ query = '', conversation = '' }) {
  if (conversation) state.selectedKey = keyOf({ contactId: only, id: conversation });
  await searchFor(query);
  list.root.querySelector('.hs-item.selected')?.scrollIntoView({ block: 'nearest' });
}

/** Picks the selected conversation up again, in its conversation window. */
async function continueConversation() {
  const one = selected();
  if (!continuable()) return;
  const going = state.all.find((c) => c.current && c.contactId === one.contactId);
  if (going && keyOf(going) !== keyOf(one)) {
    const ok = await confirmDialog(
      `Continue this conversation with ${contactOf(one).name}?\n\nThe current conversation moves to your message history.`,
      { ok: 'Continue' }
    );
    if (!ok) return;
  }
  resuming = true;
  renderChrome();
  try {
    await api.history.resume(one.contactId, one.id);
  } catch (err) {
    infoDialog('Message History', messageBody(errorText(err)));
  } finally {
    resuming = false;
    renderChrome();
  }
}

/**
 * Continue in a new contact there: one held outside the app goes on only in the folder it was held in, so a
 * new contact of its service is made to work in that folder itself, not in a worktree of its own, and picks it
 * up. Its conversation window comes up with it.
 * @param {Listed} one
 */
async function continueThere(one) {
  const provider = one.folder?.provider ?? contactOf(one)?.provider;
  if (!provider || resuming) return;
  const ok = await confirmDialog(
    `Continue this conversation in a new contact?\n\nThe contact works in ${shortPath(one.cwd)} itself, where the conversation was held, and not in a worktree of its own: what it changes, it changes there.`,
    { ok: 'Continue' }
  );
  if (!ok) return;
  resuming = true;
  renderChrome();
  try {
    await api.history.continueThere(provider, one.cwd, one.id);
  } catch (err) {
    infoDialog('Message History', messageBody(errorText(err)));
  } finally {
    resuming = false;
    renderChrome();
  }
}

/**
 * Add a contact here: Add a Contact, on a folder conversations were held in outside the app, with its
 * service first. In a repository the contact gets a worktree of its own, as any new one does, and its
 * message history lists them. Its conversation window comes up.
 * @param {HeldFolder} folder
 */
async function addHere(folder) {
  const { providers, groups, settings } = state.adding;
  const added = await contactDialog({
    providers: [...providers].sort((a, b) => Number(b.id === folder.provider) - Number(a.id === folder.provider)),
    groups,
    teams: settings.teams ?? [],
    roles: settings.roles ?? [],
    defaults: settings.contactDefaults,
    ...(!state.adding.web && { openTeams: () => api.settings.open({ section: 'teams' }) }),
    folder: folder.cwd,
  });
  if (added) api.chat.open(added.id);
}

async function save() {
  const one = selected();
  if (!savable()) return;
  try {
    if (await api.chat.save(one.contactId, one.id)) $('#statusbar').textContent = 'Conversation saved.';
  } catch (err) {
    infoDialog('Message History', messageBody(errorText(err)));
  }
}

async function remove() {
  if (!deletable()) return;
  const one = selected();
  const ok = await confirmDialog(deleteQuestion(one, contactOf(one)), { ok: 'Delete' });
  if (!ok) return;
  // Its neighbour is selected next, so several can be deleted in a row.
  const at = state.listed.indexOf(one);
  const next = state.listed[at + 1] || state.listed[at - 1];
  state.selectedKey = next ? keyOf(next) : null;
  try {
    await api.history.remove(one.contactId, one.id);
  } catch (err) {
    state.selectedKey = keyOf(one);
    await refresh();
    infoDialog('Message History', messageBody(errorText(err)));
  }
}

async function removeAll() {
  const count = removable().length;
  if (!count) return;
  const contact = state.contacts.get(only);
  const which = contact.archived ? 'conversation' : 'past conversation';
  const ok = await confirmDialog(
    `Delete ${count === 1 ? `the ${which}` : `all ${count} ${which}s`} with ${contact.name}?\n\n${count === 1 ? 'It' : 'They'} cannot be brought back.${contact.archived ? '' : ' The current conversation stays.'}`,
    { ok: 'Delete All' }
  );
  if (!ok) return;
  try {
    await api.history.removeAll(only);
  } catch (err) {
    await refresh();
    infoDialog('Message History', messageBody(errorText(err)));
  }
}

function focusSearch() {
  const input = /** @type {HTMLInputElement} */ ($('#search'));
  input.focus();
  input.select();
}

// ---- boot ------------------------------------------------------------------------------------

function mountChrome() {
  frame = mountFrame({
    title: 'Message History',
    menus: [
      {
        label: 'File',
        items: () => [
          { label: 'Continue conversation', disabled: !continuable(), action: continueConversation },
          ...(noteFor(selected(), selected() && contactOf(selected()))?.there
            ? [
                {
                  label: 'Continue in a new contact there...',
                  disabled: resuming,
                  action: () => continueThere(selected()),
                },
              ]
            : []),
          { separator: true },
          { label: 'Save as...', hint: `${MOD}S`, disabled: !savable(), action: save },
          { label: 'Delete', disabled: !deletable(), danger: true, action: remove },
          // Every past conversation of every contact is too much to delete at a click.
          ...(only ? [{ label: 'Delete all...', disabled: !removable().length, danger: true, action: removeAll }] : []),
          { separator: true },
          { label: 'Close', hint: `${MOD}W`, role: 'close', action: () => api.window.close() },
        ],
      },
      {
        label: 'Edit',
        items: () => [
          { label: 'Copy', hint: `${MOD}C`, role: 'copy', action: () => api.window.edit('copy') },
          { label: 'Select all', hint: `${MOD}A`, role: 'selectAll', action: () => api.window.edit('selectAll') },
          { separator: true },
          { label: 'Find...', hint: `${MOD}F`, action: focusSearch },
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

  $('#continue').addEventListener('click', continueConversation);
  $('#save').addEventListener('click', save);
  $('#delete').addEventListener('click', remove);
  $('#delete-all').addEventListener('click', removeAll);
  $('#delete-all').hidden = !only;
  openLinksInBrowser($('#conversation'));
  // A right-click on a picture offers to copy it or download it, as in its conversation window.
  $('#conversation').addEventListener('contextmenu', (e) => {
    const picture = conversation.pictureUnder(/** @type {HTMLElement} */ (e.target));
    if (!picture) return;
    e.preventDefault();
    openMenu({ x: e.clientX, y: e.clientY }, mediaItems(picture));
  });

  const input = /** @type {HTMLInputElement} */ ($('#search'));
  if (!only) {
    input.placeholder = 'Search history...';
    input.setAttribute('aria-label', 'Search history');
  }
  input.addEventListener('input', () => {
    // A search opens every conversation, so it waits for a pause in the typing.
    clearTimeout(typing);
    typing = setTimeout(() => search(input.value), 150);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) {
      input.value = '';
      clearTimeout(typing);
      search('');
    } else if (e.key === 'ArrowDown') {
      list.root.focus();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || document.querySelector('.modal')) return;
    const key = e.key.toLowerCase();
    if (key !== 'f' && key !== 's') return;
    e.preventDefault();
    if (key === 'f') focusSearch();
    else save();
  });
}

/** @param {any[]} contacts  as the contact list shows them */
function setContacts(contacts) {
  state.contacts = new Map(contacts.filter((c) => !only || c.id === only).map((c) => [c.id, c]));
}

async function main() {
  setPack(await api.pack.list());
  mountChrome();
  const data = await api.history.init(only);
  if (!data) {
    document.body.textContent = 'This contact no longer exists.';
    return;
  }
  setContacts(only ? [data.contact] : data.contacts);
  Object.assign(ctx, { contact: data.contact ?? null, profile: data.profile });
  if (!only) {
    const { providers = [], groups = [], settings, platform } = data;
    state.adding = { providers, groups, settings, web: platform === 'web' };
  }
  sounds.setEnabled(data.settings.sounds);
  if (only) frame.setTitle(`${data.contact.name} - Message History`);
  // Opened on a search the contact list found a conversation with, or on a conversation picked in the palette.
  await openOn({ query: params.get('query') ?? '', conversation: params.get('conversation') ?? '' });
  list.root.focus();

  api.on.history((id) => {
    if (!only || id === only) refresh();
  });
  // The same, for a window that was open already.
  api.on.historyQuery(openOn);
  // The conversation going on grows without anyone saying so; look again when you come back.
  let inFront = true;
  api.on.windowState(({ focused }) => {
    if (focused && !inFront) refresh();
    inFront = focused;
  });
  api.on.contacts((contacts) => {
    const before = state.contacts;
    setContacts(contacts);
    if (only && !state.contacts.has(only)) return api.window.close();
    // Added and deleted contacts are renamed too: from nothing, and to nothing.
    const renamed = (id) => before.get(id)?.name !== state.contacts.get(id)?.name;
    if (only && renamed(only)) frame.setTitle(`${state.contacts.get(only).name} - Message History`);
    // Every "says:" line carries the name, so the transcript is drawn again.
    if (state.shown && renamed(state.shown.summary.contactId)) state.shown = null;
    if ([...before.keys(), ...state.contacts.keys()].some(renamed)) return refresh();
    // Archived or restored, a contact's conversations can or can't go on.
    renderChrome();
    // Every contact's rows wear their buddies, which only change with a status. The list is told far more often.
    const standing = (c) => `${c?.status} ${Boolean(c?.archived)}`;
    if (!only && [...state.contacts.keys()].some((id) => standing(before.get(id)) !== standing(state.contacts.get(id))))
      drawList();
  });
  api.on.profile((profile) => {
    ctx.profile = profile;
  });
  api.on.settings((settings) => {
    sounds.setEnabled(settings.sounds);
    state.adding.settings = settings;
  });
  api.on.groups((groups) => {
    state.adding.groups = groups;
  });
  window.addEventListener('blur', closeMenu);
}

main();
