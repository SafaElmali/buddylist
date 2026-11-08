// The palette ⌘K opens in the contact list and in a conversation window: a box to type in over
// your contacts, your past conversations and what was said in them, the files of a conversation's
// folder, everything the window's menus do and the pages of Settings. The arrows and
// Enter pick from it as in a menu (see menu.js), and Esc puts it away. What it lists for what is
// typed, and in which order, is in shared/palette.js.
import { api } from './api.js';
import { el, html, raw } from './dom.js';
import { fileIcon } from './file-icons.js';
import { shortAgo } from './format.js';
import { buddy, smallIcon } from './icons.js';
import { closeMenu, openPopover } from './menu.js';
import {
  KEYWORDS,
  contactsToGoTo,
  conversationGoesTo,
  conversationsToGoTo,
  fileToGoTo,
  menuActions,
  paletteSections,
  searchHistoryName,
  settingsToGoTo,
} from '../../shared/palette.js';
import { searchTerms } from '../../shared/search.js';

/** @typedef {import('./menu.js').MenuItem} MenuItem */

/**
 * Something the palette lists: what it is found by, how its row looks, and what picking it does.
 * @typedef {Object} Entry
 * @property {string} id  stable while the conversations refresh
 * @property {string} name
 * @property {string} [also]  the rest of what it is found by
 * @property {readonly string[]} [keywords]  other words it is found by (see KEYWORDS in shared/palette.js)
 * @property {string} [foundBy]  of a conversation: the search that found it by what was said in it
 * @property {string} [path]  of an action: the menus it is in, written before its name
 * @property {string} icon  trusted markup
 * @property {string} [hint]
 * @property {string} [title]  what pointing at its row says, when its name and hint are not it
 * @property {boolean} [bold]
 * @property {boolean} [danger]
 * @property {() => void} pick
 * @property {{ kind: string, command?: string }} counted  what picking it is counted as: the kind of row, and a
 *   menu's choice by its name in KEYWORDS (see USED in main/analytics.js)
 */

/**
 * What a window lists in its palette, and what it does with a contact.
 * @typedef {Object} PaletteSources
 * @property {{ label: string, items: () => MenuItem[] }[]} menus  the window's menus: what they do is listed
 * @property {() => any[]} contacts  every contact, as the contact list has them
 * @property {string | null} [current]  the contact whose conversation the window shows: there is no going to it
 * @property {(contact: any) => void} jump  a contact was picked, or the conversation going on with one
 * @property {{ list: () => Promise<string[]>, open: (path: string) => void }} [files]  the files of the folder
 *   the window's contact works in, and what opens one: the contact list has none
 * @property {(page: import('../../shared/palette.js').SettingsToGoTo) => void} [settings]  opens Settings on a
 *   page: the browser preview has no Settings window, and lists none of its pages
 */

/** How long a pause in the typing is before what was said in every conversation is searched: each search reads them all. */
const SEARCH_PAUSE_MS = 150;
/** Shorter than this, what is typed names things but is not looked for in what was said, as in the contact list's search. */
const SEARCH_MIN = 2;

/** @type {HTMLElement | null} the palette while it is open */
let opened = null;
/**
 * Every contact's conversations, as they were listed the last time the palette was open. The next one
 * starts with them, while it asks again: there can be many, and the palette is wanted at once.
 * @type {any[] | null}
 */
let lastListed = null;
/**
 * The files of the folder the palette last looked through, and the contact whose conversation it was over.
 * The next one over that conversation starts with them, while it asks again.
 * @type {{ of: string | null, paths: string[] } | null}
 */
let lastFiles = null;
/** How many times the palette has asked for what it lists: an older asking's answer is not kept over a newer one's. */
let listRequest = 0;

/** Opens the palette, or puts it away when it is open. @param {PaletteSources} sources */
export function togglePalette(sources) {
  if (opened) closeMenu();
  else openPalette(sources);
}

/** @param {any} contact @param {(contact: any) => void} jump @returns {Entry} */
const contactEntry = (contact, jump) => ({
  id: `contact:${contact.id}`,
  name: contact.name,
  also: [contact.project, contact.providerName].filter(Boolean).join(' '),
  icon: buddy(contact.status),
  hint: contact.project || '',
  // Something you have not seen yet, as the contact list has it.
  bold: Boolean(contact.unread),
  pick: () => jump(contact),
  counted: { kind: 'contact' },
});

/** A conversation's row, told from the others: a contact's current one and its past ones. */
const conversationKey = (row) => `${row.contactId}:${row.id}`;

/**
 * A conversation, by what you said first in it, with whose it is and how long ago it was last added to.
 * @param {any} row  as every contact's message history lists it
 * @param {any} contact
 * @param {(contact: any) => void} jump
 * @param {string} [foundBy]  the search that found it by what was said in it
 * @returns {Entry}
 */
const conversationEntry = (row, contact, jump, foundBy) => ({
  id: `conversation:${conversationKey(row)}`,
  name: row.preview || '(no text)',
  also: [contact.name, row.project, row.branch].filter(Boolean).join(' '),
  ...(foundBy !== undefined && { foundBy }),
  icon: smallIcon.comment(),
  hint: [contact.name, row.endedAt && shortAgo(row.endedAt)].filter(Boolean).join(' · '),
  pick: () =>
    conversationGoesTo(row, contact) === 'contact' ? jump(contact) : api.history.open(row.contactId, '', row.id),
  counted: { kind: 'conversation' },
});

/**
 * A file of the conversation's folder, by its name, with the folders it is in.
 * @param {string} path  from the top of the folder
 * @param {(path: string) => void} open
 * @returns {Entry}
 */
const fileEntry = (path, open) => {
  const { name, also, folder } = fileToGoTo(path);
  return {
    id: `file:${path}`,
    name,
    also,
    // A data address: nothing in it needs escaping.
    icon: `<img src="${fileIcon(path)}" alt="" />`,
    hint: folder,
    title: path,
    pick: () => open(path),
    counted: { kind: 'file' },
  };
};

/**
 * A menu's choice, as its menu shows it: its picture or tick, and its shortcut.
 * @param {{ item: MenuItem, path: string[], keywords: readonly string[] }} action
 * @returns {Entry}
 */
const actionEntry = ({ item, path, keywords }) => {
  const tickAtEnd = Boolean(item.checked && item.icon);
  // Its own words only: a slash command under Commands has the menu's, and is no choice the app names.
  const command = Object.keys(KEYWORDS).find((id) => KEYWORDS[id] === item.keywords);
  return {
    id: `action:${JSON.stringify([...path, item.label])}`,
    name: item.label ?? '',
    also: path.join(' '),
    keywords,
    path: path.join(' › '),
    icon: item.checked && !tickAtEnd ? '✓' : item.icon || '',
    hint: tickAtEnd ? '✓' : item.hint || '',
    danger: Boolean(item.danger),
    pick: () => item.action?.(),
    counted: { kind: 'action', ...(command && { command }) },
  };
};

/**
 * A page of Settings, by its name: a project's says which project it is of first, as an action says its menu.
 * @param {import('../../shared/palette.js').SettingsToGoTo} page
 * @param {(page: import('../../shared/palette.js').SettingsToGoTo) => void} open
 * @returns {Entry}
 */
const settingsEntry = (page, open) => ({
  id: `settings:${JSON.stringify([page.project, page.section])}`,
  name: page.name,
  also: page.also,
  keywords: page.keywords,
  path: page.project,
  icon: '',
  title: page.project ? `Settings › ${page.project} › ${page.name}` : `Settings › ${page.name}`,
  pick: () => open(page),
  counted: { kind: 'setting' },
});

/**
 * The row for when nothing is found: every contact's message history, searching for what was typed.
 * @param {string} query
 * @returns {Entry}
 */
const searchHistoryEntry = (query) => ({
  id: 'search-history',
  name: searchHistoryName(query),
  icon: smallIcon.search(),
  pick: () => api.history.openAll(query),
  counted: { kind: 'history' },
});

/** Over the middle of the window, just under its menu bar. */
function place(node) {
  const top = document.querySelector('.menubar')?.getBoundingClientRect().bottom ?? 0;
  node.style.top = `${Math.round(top) + 8}px`;
  node.style.left = `${Math.max(4, Math.round((window.innerWidth - node.offsetWidth) / 2))}px`;
}

/** @param {PaletteSources} sources */
function openPalette({ menus, contacts, current = null, jump, files = null, settings = null }) {
  const everyone = contacts();
  const byId = new Map(everyone.map((contact) => [contact.id, contact]));
  /** Every conversation, as they were listed. */
  let listed = lastListed ?? [];
  /**
   * The conversations what was said in them was searched for, and the search: those are named by it
   * even where their names don't say it.
   * @type {{ query: string, rows: any[] }}
   */
  let said = { query: '', rows: [] };
  const conversationsOf = () => {
    const found = new Set(said.rows.map(conversationKey));
    const known = new Set(listed.map(conversationKey));
    // One the search found that the listing doesn't have yet, as while it is still on its way, comes too.
    const rows = [...listed, ...said.rows.filter((row) => !known.has(conversationKey(row)))];
    return conversationsToGoTo(rows, byId, current).map((row) =>
      conversationEntry(row, byId.get(row.contactId), jump, found.has(conversationKey(row)) ? said.query : undefined)
    );
  };
  /** @param {string[]} paths */
  const filesOf = (paths) => (files ? paths.map((path) => fileEntry(path, files.open)) : []);
  const findables = {
    contacts: contactsToGoTo(everyone, current).map((contact) => contactEntry(contact, jump)),
    conversations: conversationsOf(),
    files: filesOf(lastFiles?.of === current ? lastFiles.paths : []),
    actions: menuActions(menus).map(actionEntry),
    settings: settings ? settingsToGoTo(everyone, current).map((page) => settingsEntry(page, settings)) : [],
    searchHistory: searchHistoryEntry,
  };
  const named = ['contact', 'conversation', ...(files ? ['file'] : []), 'action', ...(settings ? ['setting'] : [])];
  const kinds = `${named.slice(0, -1).join(', ')} or ${named.at(-1)}`;
  const placeholder = `Jump to a ${kinds}`;

  const box = el(
    html`<div>
      <label class="menu-search">
        ${raw(smallIcon.search())}
        <input type="text" spellcheck="false" aria-label="${placeholder}" placeholder="${placeholder}" />
      </label>
    </div>`
  );
  const input = /** @type {HTMLInputElement} */ (box.querySelector('input'));
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'palette-results');
  const list = el('<div class="menu" id="palette-results" role="listbox" aria-label="Jump to"></div>');
  const status = el('<div class="palette-status" role="status" aria-atomic="true"></div>');
  const foot = el('<div class="palette-foot">↑ ↓ Choose · Enter Open · Esc Close</div>');
  box.append(list, status, foot);
  let historyState = 'loading';
  let filesState = files ? 'loading' : 'ready';
  /** While what was said in the conversations is being searched for what is typed. */
  let searching = false;
  let searchTimer = 0;
  /** How many searches of what was said were asked for: an older one's answer is not kept over a newer one's. */
  let searchRequest = 0;
  /** @type {Map<Element, Entry>} the rows on show, and what each is */
  let shown = new Map();
  // Entries stay the same while typing. Keep their DOM and handlers too; only matching/ranking changes.
  const rows = new WeakMap();
  let rowId = 0;
  let drawnSections = [];
  let drawnNote = null;

  /** What is still on its way, what could not come, or how many rows there are. */
  const statusText = () => {
    const loading = [];
    if (historyState === 'loading') loading.push('conversations');
    if (filesState === 'loading') loading.push('files');
    if (loading.length) return `Loading ${loading.join(' and ')}...`;
    if (searching) return 'Searching what was said in your conversations...';
    if (historyState === 'failed') return 'Couldn’t refresh conversations. Reopen to try again.';
    if (filesState === 'failed') return 'Couldn’t list the files. Reopen to try again.';
    return `${shown.size} ${shown.size === 1 ? 'result' : 'results'}`;
  };

  // Focus stays in the search field. Tell assistive technology which result the arrows chose.
  const announceSelection = () => {
    const active = list.querySelector('.menu-item.active');
    for (const node of shown.keys()) node.setAttribute('aria-selected', String(node === active));
    if (active) input.setAttribute('aria-activedescendant', active.id);
    else input.removeAttribute('aria-activedescendant');
  };

  /** @param {Entry} entry */
  const row = (entry) => {
    const cached = rows.get(entry);
    if (cached) {
      shown.set(cached, entry);
      cached.classList.remove('active');
      return cached;
    }
    // An action says which menu it is in first, lighter: "Tools › Theme › Dark".
    const label = html`${entry.path && html`<span class="palette-path">${entry.path} › </span>`}<span
        class="palette-name"
        >${entry.name}</span
      >`;
    const node = el(
      html`<div
        class="menu-item${entry.bold ? ' bold' : ''}${entry.danger ? ' danger' : ''}"
        role="option"
        id="palette-option-${rowId++}"
        title="${entry.title ?? [entry.path, entry.name, entry.hint].filter(Boolean).join(' › ')}"
      >
        <span class="menu-check">${raw(entry.icon)}</span>
        <span class="menu-label">${label}</span>
        <span class="menu-hint">${entry.hint}</span>
      </div>`
    );
    node.addEventListener('mousemove', (e) => {
      // Redrawing under a resting pointer must not override the best match picked by typing.
      if (!e.movementX && !e.movementY) return;
      list.querySelector('.menu-item.active')?.classList.remove('active');
      node.classList.add('active');
      announceSelection();
    });
    node.addEventListener('click', () => {
      closeMenu();
      entry.pick();
      // Told to the app only to be counted. What was typed stays here.
      api.app.used('palette item picked', entry.counted).catch(() => {});
    });
    shown.set(node, entry);
    rows.set(entry, node);
    return node;
  };

  /**
   * Lists what is typed names, and marks the best of it for Enter.
   * @param {{ keep?: boolean }} [opts]  `keep`: the row marked stays marked, as when the conversations come
   *   in under it, and the list where it was scrolled to
   */
  const draw = ({ keep = false } = {}) => {
    const marked = keep ? shown.get(list.querySelector('.menu-item.active')) : null;
    const scrollTop = list.scrollTop;
    const query = input.value.trim();
    const sections = paletteSections(findables, query);
    // Nothing found, so far: the row that searches every contact's message history comes under a note
    // saying so, without a heading of its own.
    const nothing = !sections.length || sections[0].kind === 'history';
    const looking = (historyState === 'loading' && !lastListed) || searching;
    const note = looking ? 'Looking through your conversations...' : `No ${kinds} matches “${query}”.`;
    const same =
      drawnNote === (nothing ? note : null) &&
      sections.length === drawnSections.length &&
      sections.every(
        (section, at) =>
          section.kind === drawnSections[at].kind &&
          section.entries.length === drawnSections[at].entries.length &&
          section.entries.every((entry, i) => entry === drawnSections[at].entries[i])
      );
    if (same) {
      status.textContent = statusText();
      if (!keep) {
        list.querySelector('.menu-item.active')?.classList.remove('active');
        list.querySelector('.menu-item')?.classList.add('active');
        announceSelection();
        list.scrollTop = 0;
      }
      return;
    }
    drawnSections = sections;
    drawnNote = nothing ? note : null;
    shown = new Map();
    list.replaceChildren(
      ...(nothing ? [el(html`<div class="item-note">${note}</div>`)] : []),
      ...sections.flatMap(({ kind, heading, entries }) => [
        ...(kind === 'history' ? [] : [el(html`<div class="menu-heading" role="presentation">${heading}</div>`)]),
        ...entries.map(row),
      ])
    );
    status.textContent = statusText();
    const active = [...shown].find(([, entry]) => entry.id === marked?.id)?.[0] ?? list.querySelector('.menu-item');
    active?.classList.add('active');
    announceSelection();
    list.scrollTop = keep ? scrollTop : 0;
  };

  // The box takes the focus, and gives it back to where it was when the palette goes.
  const before = document.activeElement;
  const node = openPopover({ x: 0, y: 0 }, box, {
    className: 'palette',
    onClose: () => {
      opened = null;
      clearTimeout(searchTimer);
      window.removeEventListener('resize', reposition);
      const lost = !document.activeElement || document.activeElement === document.body;
      if (lost && before instanceof HTMLElement) before.focus();
    },
  });
  node.setAttribute('role', 'dialog');
  node.setAttribute('aria-label', 'Command palette');
  const reposition = () => place(node);
  window.addEventListener('resize', reposition);
  opened = node;
  draw();
  place(node);
  /** Looks for what is typed in what was said in every conversation, once the typing pauses. */
  const searchSaid = () => {
    clearTimeout(searchTimer);
    const query = input.value.trim();
    const asked = ++searchRequest;
    searching = searchTerms(query).length > 0 && query.length >= SEARCH_MIN;
    if (!searching) {
      if (said.rows.length) {
        said = { query: '', rows: [] };
        findables.conversations = conversationsOf();
      }
      return;
    }
    searchTimer = setTimeout(() => {
      api.history
        .listAll(query)
        .then((rows) => {
          if (asked !== searchRequest) return;
          said = { query, rows };
          findables.conversations = conversationsOf();
        })
        // Without it, what the conversations are called is still looked through.
        .catch(() => {})
        .finally(() => {
          if (asked !== searchRequest || opened !== node) return;
          searching = false;
          draw({ keep: true });
        });
    }, SEARCH_PAUSE_MS);
  };
  input.addEventListener('input', () => {
    searchSaid();
    draw();
  });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    // menu.js handles the arrows in capture phase; reflect its selection before the key bubbles.
    if (['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
      announceSelection();
      e.stopPropagation();
    } else if (e.key === 'Tab') closeMenu();
  });
  // Clicking a row must not take the caret out of the box first.
  box.addEventListener('mousedown', (e) => {
    if (!(/** @type {Element} */ (e.target).closest('.menu-search'))) e.preventDefault();
  });
  input.focus();

  const request = ++listRequest;
  api.history
    .listAll('')
    .then((rows) => {
      if (request === listRequest) lastListed = rows;
      listed = rows;
      findables.conversations = conversationsOf();
      historyState = 'ready';
    })
    // Without them, there are still the contacts and the actions to go to.
    .catch(() => {
      historyState = 'failed';
    })
    .finally(() => {
      if (opened === node) draw({ keep: true });
    });
  // The folder's files come apart from the conversations: either can be slow, or fail, without the other.
  files
    ?.list()
    .then((paths) => {
      if (request === listRequest) lastFiles = { of: current, paths };
      findables.files = filesOf(paths);
      filesState = 'ready';
    })
    .catch(() => {
      filesState = 'failed';
    })
    .finally(() => {
      if (opened === node) draw({ keep: true });
    });
}
