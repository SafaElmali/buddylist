// The phone app's Home: who is waiting for you, who is at work, and everyone else (see shared/phone-sections.js). A
// row opens its conversation. Project sections and manager teams fold independently on this phone. A phone set to less
// than full access is told so once, first of the hints (see access.js).
import { el, html, raw } from '../lib/dom.js';
import { pictureArt } from '../lib/pictures.js';
import { CONNECTION } from '../remote/network-ipc.js';
import { access, accessHint } from './access.js';
import { host, yourComputer } from './host.js';
import { installHint } from './install.js';
import {
  asks,
  folderName,
  homeSections,
  projectLabel,
  PROMPT_KINDS,
  roleOf,
  rowNote,
} from '../../shared/phone-sections.js';
import { startedUnder } from '../../shared/list-view.js';

/** The row last opened from Home, which has the focus again once Back brings Home back. */
let opened = null;

/** Above this many contacts, Home has a filter. */
const FILTER_FROM = 10;
/** What the filter has, kept while the app is open: Back from a match comes back to the matches. */
let query = '';
/** Text as the filter compares it: without case or accents. */
const plain = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** What the computer's dot means, said in words to those who don't see it. */
const MAC_STATE = { connected: 'connected', reconnecting: 'reconnecting' };

/** Where it is kept which level's hint was put away: said again once the level changes. */
const ACCESS_SEEN = 'phone:access-hint';

/** What this phone may do, said once for its level until put away: null with full access, or once it was. */
function accessCard() {
  const text = accessHint();
  try {
    if (!text) localStorage.removeItem(ACCESS_SEEN);
    if (!text || localStorage.getItem(ACCESS_SEEN) === access.level) return null;
  } catch {
    // Storage that keeps nothing: said each time Home is drawn.
    if (!text) return null;
  }
  const card = el(
    html`<aside class="ph-hint" data-hint="access" role="note">
      <p>${text}</p>
      <div class="ph-actions">
        <button class="ph-button" type="button" data-do="dismiss" aria-label="Got it, put this away">Got it</button>
      </div>
    </aside>`
  );
  card.addEventListener('click', ({ target }) => {
    if (!(/** @type {HTMLElement} */ (target).closest?.('[data-do="dismiss"]'))) return;
    try {
      localStorage.setItem(ACCESS_SEEN, access.level);
    } catch {
      // Put away until Home is drawn again.
    }
    card.remove();
  });
  return card;
}

/** Phone-only folds survive returning from a conversation and reopening the app. */
const FOLDED_KEY = 'phone:folded';
const keptFolds = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(FOLDED_KEY));
    if (Array.isArray(saved)) return new Set(saved.filter((key) => typeof key === 'string'));
  } catch {
    // Storage can be unavailable; folding still works until this page is closed.
  }
  return new Set(['section:archived']);
};

/** @param {import('../../shared/phone-sections.js').ContactView} contact */
const row = (contact, { projectNote = false, depth = 0, led = false, started = 0, folded = false } = {}) => {
  const role = roleOf(contact);
  const kind = contact.prompt && PROMPT_KINDS[contact.prompt.kind];
  return html`<li class="ph-entry" style="--ph-depth: ${Math.min(depth + Number(led), 2)}">
    <a
      class="ph-row"
      href="#/c/${encodeURIComponent(contact.id)}"
      data-id="${contact.id}"
      ${asks(contact) ? 'data-asks' : ''}
    >
      <span class="ph-avatar ph-${contact.status}">${raw(pictureArt(contact.avatar || 'default'))}</span>
      <span class="ph-row-text">
        <span class="ph-row-name"
          ><span class="ph-name">${contact.name}</span>${role ? html`<span class="ph-badge">${role}</span>` : ''}</span
        >
        ${projectNote ? html`<span class="ph-row-project">${projectLabel(contact)}</span>` : ''}
        <span class="ph-row-note"
          >${kind ? html`<span class="ph-chip ph-chip-${contact.prompt.kind}">${kind}</span>` : ''}${rowNote(contact)}</span
        >
      </span>
      ${contact.unread ? html`<span class="ph-unread" aria-label="${contact.unread} unread">${contact.unread}</span>` : ''}
    </a>
    ${
      started
        ? html`<button
            class="ph-team-fold"
            type="button"
            data-fold="contact:${contact.id}"
            aria-expanded="${String(!folded)}"
            aria-label="${folded ? 'Show' : 'Hide'} contacts under ${contact.name}"
          >
            <span class="ph-chevron" aria-hidden="true"></span><span>${started}</span>
          </button>`
        : ''
    }
  </li>`;
};

/** The bell, struck through while notifications are off. */
const BELL = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/>
  <path d="M10 20.5a2 2 0 0 0 4 0"/><path class="ph-bell-off" d="M4 4l16 16"/></svg>`;

export class Home {
  /**
   * @param {HTMLElement} root
   * @param {{ contacts: import('../../shared/phone-sections.js').ContactView[], signOut: () => void,
   *   notifications: import('./notifications.js').Notifications }} opts
   */
  constructor(root, { contacts, signOut, notifications }) {
    this.root = root;
    this.signOut = signOut;
    this.notifications = notifications;
    this.folded = keptFolds();
    document.title = 'buddylist';
    root.replaceChildren(
      el(
        html`<header class="ph-bar">
          <h1 class="ph-title" tabindex="-1">buddylist</h1>
          <span class="ph-mac" title="${host.name || `Your ${host.noun}`}, which buddylist runs on"
            >${host.noun}<span class="ph-sr" id="mac-state"
              >, ${MAC_STATE[document.documentElement.dataset.connection] ?? MAC_STATE.connected}</span
            ></span
          >
          <button class="ph-icon-button ph-bell" type="button" id="bell" hidden>${raw(BELL)}</button>
          <button class="ph-icon-button" type="button" id="sign-out">Sign out</button>
        </header>`
      ),
      el(html`<div class="ph-scroll" id="home"></div>`),
      // Signing out can't be undone from the phone: it asks first.
      el(
        html`<dialog
          class="ph-sheet"
          data-sheet="sign-out"
          aria-labelledby="sign-out-title"
          aria-describedby="sign-out-text"
        >
          <div class="ph-sheet-body">
            <h2 id="sign-out-title">Sign out on this phone?</h2>
            <p id="sign-out-text">
              To use buddylist here again, you’ll need a new code from ${yourComputer()}, or the password.
            </p>
            <div class="ph-actions">
              <button class="ph-button" type="button" data-do="cancel">Cancel</button>
              <button class="ph-button ph-danger" type="button" data-do="sign-out">Sign out</button>
            </div>
          </div>
        </dialog>`
      ),
      // With notifications on, the bell offers a test, and turning them off.
      el(
        html`<dialog
          class="ph-sheet"
          data-sheet="notifications"
          aria-labelledby="notifications-title"
          aria-describedby="notifications-text"
        >
          <div class="ph-sheet-body">
            <h2 id="notifications-title">Notifications are on</h2>
            <p id="notifications-text">
              This phone gets a notification when an agent needs you, finishes or runs into a problem.
            </p>
            <div class="ph-actions ph-actions-stacked">
              <button class="ph-button ph-primary" type="button" data-do="test">Send a test</button>
              <button class="ph-button" type="button" data-do="off">Turn off</button>
              <button class="ph-button" type="button" data-do="cancel">Cancel</button>
            </div>
          </div>
        </dialog>`
      )
    );
    const signOutButton = /** @type {HTMLButtonElement} */ (root.querySelector('#sign-out'));
    const askSignOut = this.#sheet('sign-out', signOutButton, (action) => action === 'sign-out' && this.signOut());
    signOutButton.addEventListener('click', () => askSignOut('cancel'));
    this.bell = /** @type {HTMLButtonElement} */ (root.querySelector('#bell'));
    const askBell = this.#sheet('notifications', this.bell, (action) => {
      if (action === 'test') this.notifications.test();
      if (action === 'off') this.notifications.turnOff();
    });
    this.bell.addEventListener('click', () => {
      const { state } = this.notifications;
      if (state === 'on') askBell('test');
      else if (state === 'off') this.notifications.turnOn();
      else this.notifications.explain();
    });
    this.#drawBell();
    // Kept in the page as Home is drawn again, so it keeps its words, the focus and the keyboard.
    this.filterBar = el(
      html`<div class="ph-filter-bar">
        <input
          class="ph-filter"
          type="search"
          placeholder="Find a contact or project"
          aria-label="Find a contact or project"
          enterkeyhint="search"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        />
      </div>`
    );
    const field = /** @type {HTMLInputElement} */ (this.filterBar.querySelector('input'));
    field.value = query;
    field.addEventListener('input', () => {
      query = field.value;
      this.contactsChanged(this.contacts);
    });
    this.list = /** @type {HTMLElement} */ (root.querySelector('#home'));
    this.list.addEventListener('click', ({ target }) => {
      opened = /** @type {HTMLElement} */ (target).closest?.('.ph-row')?.dataset.id ?? opened;
      const toggle = /** @type {HTMLElement} */ (target).closest?.('[data-fold]');
      if (!toggle) return;
      const key = toggle.dataset.fold;
      if (this.folded.has(key)) this.folded.delete(key);
      else this.folded.add(key);
      try {
        localStorage.setItem(FOLDED_KEY, JSON.stringify([...this.folded]));
      } catch {
        // A phone that cannot keep preferences can still fold its list.
      }
      this.contactsChanged(this.contacts);
    });
    this.contactsChanged(contacts);
    addEventListener(CONNECTION, this.#connection);
    // Opened, the heading has the focus; back from a conversation, the row it was opened from.
    const back = opened && this.#row(opened);
    if (back) back.focus();
    else root.querySelector('h1').focus({ preventScroll: true });
  }

  /**
   * A sheet from the bottom, opened by a button: its buttons, or a tap beside it (the dialog itself is only its
   * backdrop), close it, and the focus goes back to that button.
   * @param {string} name  its data-sheet
   * @param {HTMLElement} opener
   * @param {(action: string) => void} act  what one of its buttons asks
   * @returns {(first: string) => void}  opens it, with the focus on the button doing `first`
   */
  #sheet(name, opener, act) {
    const sheet = /** @type {HTMLDialogElement} */ (this.root.querySelector(`dialog[data-sheet="${name}"]`));
    sheet.addEventListener('click', ({ target }) => {
      const action = /** @type {HTMLElement} */ (target).closest?.('[data-do]')?.dataset.do;
      if (!action && target !== sheet) return;
      sheet.close();
      if (action && action !== 'cancel') act(action);
    });
    sheet.addEventListener('close', () => opener.focus());
    return (first) => {
      sheet.showModal();
      /** @type {HTMLElement} */ (sheet.querySelector(`[data-do="${first}"]`)).focus();
    };
  }

  /** The connection to the computer changed: the dot's words follow it. */
  #connection = ({ detail }) => {
    this.root.querySelector('#mac-state').textContent = `, ${MAC_STATE[detail] ?? MAC_STATE.connected}`;
  };

  /** A contact's row, if Home shows it. */
  #row(id) {
    return [...this.list.querySelectorAll('.ph-row')].find((row) => row.dataset.id === id);
  }

  /** @param {import('../../shared/phone-sections.js').ContactView[]} contacts */
  contactsChanged(contacts) {
    this.contacts = contacts;
    const filtering = contacts.length > FILTER_FROM;
    if (!filtering) query = '';
    const words = plain(query).split(/\s+/).filter(Boolean);
    const scroll = this.list.scrollTop;
    // What has the focus keeps it as the list is drawn again: a fold, or a row.
    const focused = document.activeElement?.closest?.('[data-fold], .ph-row');
    const focusKey = this.list.contains(focused) ? focused?.dataset.fold : null;
    const focusRow = this.list.contains(focused) ? focused?.dataset.id : null;
    const drawn = words.length ? [this.#matches(contacts, words)] : this.#sections(contacts);
    for (const node of [...this.list.children]) if (node !== this.filterBar) node.remove();
    if (!filtering) this.filterBar.remove();
    else if (this.filterBar.parentElement !== this.list) this.list.prepend(this.filterBar);
    this.list.append(...drawn);
    this.list.scrollTop = scroll;
    if (focusKey) {
      [...this.list.querySelectorAll('[data-fold]')]
        .find((button) => button.dataset.fold === focusKey)
        ?.focus({ preventScroll: true });
    } else if (focusRow) {
      this.#row(focusRow)?.focus({ preventScroll: true });
    }
  }

  /** Home as it is: its sections, with one hint under Waiting. */
  #sections(contacts) {
    // Waiting stays, saying when nothing needs you, while there is anyone at all.
    const sections = homeSections(contacts).filter(
      (section) => section.members.length || (section.id === 'waiting' && contacts.length)
    );
    // One hint at a time, under Waiting: what this phone may do first, as it explains what isn't there, then
    // notifications, as they need a tap, then adding the app.
    const hint = accessCard() ?? this.notifications.card() ?? installHint();
    const contactsFolded = new Set(
      [...this.folded].filter((key) => key.startsWith('contact:')).map((key) => key.slice('contact:'.length))
    );
    const drawn = sections.map((section) => {
      const priority = section.id === 'waiting' || section.id === 'working';
      const key = `section:${section.id}`;
      const open = priority || !this.folded.has(key);
      const label = section.project ? folderName(section.label) : section.label;
      const members = priority
        ? section.members.map((contact) => row(contact, { projectNote: true }))
        : startedUnder(section.members, contactsFolded).map(({ contact, ...place }) =>
            row(contact, { projectNote: !section.project, ...place })
          );
      return el(
        html`<section class="ph-section" data-section="${section.id}">
          <h2 class="ph-heading">
            ${
              priority
                ? html`${label} <span class="ph-count">${section.members.length}</span>`
                : html`<button
                    class="ph-fold"
                    type="button"
                    data-fold="${key}"
                    aria-expanded="${String(open)}"
                    aria-controls="rows-${encodeURIComponent(section.id)}"
                  >
                    <span class="ph-chevron" aria-hidden="true"></span><span class="ph-group-name">${label}</span>
                    <span class="ph-count">${section.members.length}</span>
                  </button>`
            }
          </h2>
          ${
            section.members.length
              ? html`<ul class="ph-rows" id="rows-${encodeURIComponent(section.id)}" ${open ? '' : ' hidden'}>
                  ${open ? members : ''}
                </ul>`
              : html`<p class="ph-none">Nothing needs you right now.</p>`
          }
        </section>`
      );
    });
    return [
      ...drawn.slice(0, 1),
      ...(hint ? [hint] : []),
      ...drawn.slice(1),
      ...(contacts.length
        ? []
        : [el(html`<p class="ph-empty">Nobody here yet. Add a contact in buddylist on ${yourComputer()}.</p>`)]),
    ];
  }

  /** Everyone the filter's words find, each in their name or project, archived too, by name. */
  #matches(contacts, words) {
    const found = contacts
      .filter((contact) => {
        const text = plain(`${contact.name} ${projectLabel(contact)}`);
        return words.every((word) => text.includes(word));
      })
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return el(
      html`<section class="ph-section" data-section="matches">
        <h2 class="ph-heading">Matches <span class="ph-count">${found.length}</span></h2>
        ${
          found.length
            ? html`<ul class="ph-rows">
                ${found.map((contact) => row(contact, { projectNote: true }))}
              </ul>`
            : html`<p class="ph-none">Nobody matches “${query.trim()}”.</p>`
        }
      </section>`
    );
  }

  /** What this phone may do changed on the computer: Home says so at once. */
  accessChanged() {
    this.contactsChanged(this.contacts);
  }

  /** Notifications went on or off, or can't be turned on: the bell and the card say so. */
  notificationsChanged() {
    this.#drawBell();
    this.contactsChanged(this.contacts);
  }

  #drawBell() {
    const { state } = this.notifications;
    const on = state === 'on' || (state === 'busy' && this.notifications.turning === 'on');
    this.bell.hidden = state === 'unsupported' || state === 'home-screen';
    this.bell.disabled = state === 'busy';
    // On, it opens a sheet (a test, or off); off, it turns them on.
    for (const [name, value] of [
      ['data-on', ''],
      ['aria-haspopup', 'dialog'],
    ])
      if (on) this.bell.setAttribute(name, value);
      else this.bell.removeAttribute(name);
    this.bell.setAttribute('aria-label', on ? 'Notifications are on' : 'Turn notifications on');
  }

  close() {
    removeEventListener(CONNECTION, this.#connection);
  }
}
