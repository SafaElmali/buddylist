// Settings: the app's own settings, and under each project what that project is set up with. It is drawn in
// the window it was opened from, the contact list or a conversation, over what that window shows: Back, or
// Esc, gives it back as it was, its scroll, the message being typed and the panes open beside it, and what
// the window was doing goes on meanwhile (see main/windows/settings-view.js). There is no OK: a switch or a
// box says what it was changed to as soon as it was, and the bar at the bottom says how that went.
import { api } from '../lib/api.js';
import { $, el, errorText, html, raw } from '../lib/dom.js';
import { groupArrow, smallIcon } from '../lib/icons.js';
import { onLook } from '../lib/look.js';
import { putDialogsAside } from '../lib/dialog.js';
import { closeMenu, isMenuOpen } from '../lib/menu.js';
import { setModelSettings } from '../contacts/models.js';
import { pageId, projectPages } from '../../shared/settings-pages.js';
import { APP_PAGES } from './app-pages.js';
import { navRows } from './nav.js';
import { PROJECT_PAGES } from './project-pages.js';

/** @typedef {import('../../main/project-settings.js').ProjectView} ProjectView */

/**
 * One page of Settings.
 * @typedef {Object} Page
 * @property {string} id
 * @property {string} [heading]  the part of the list it is under; a project's pages are under the project
 * @property {string} label
 * @property {string} lead   what it is about, under its title
 * @property {(ctx: PageContext) => (HTMLElement | null | false | undefined)[]} render
 */

/**
 * What a page is drawn from, and how it says what was changed.
 * @typedef {Object} PageContext
 * @property {Record<string, any>} settings  the app's settings
 * @property {import('../../providers/contract.js').ProviderDescriptor[]} providers
 * @property {string} platform
 * @property {ProjectView} [project]  the project a project's page is of
 * @property {(patch: object) => Promise<boolean>} save  changes the app's settings; false when that was refused
 * @property {(patch: object) => Promise<boolean>} saveProject  changes what the project is set up with
 * @property {(text: string, failed?: boolean) => void} said  puts a line in the bar at the bottom
 * @property {(section: string) => void} go  turns to another page, of the same project for a project's page
 * @property {string} manager  on a project's Manager page, the manager it opens on, by its contact; '' for none
 * @property {() => void} reload  asks for everything again and draws the page anew, such as once a manager was added
 */

const state = {
  settings: {},
  providers: [],
  /** @type {ProjectView[]} */
  projects: [],
  platform: '',
  /**
   * What is on show: a page, and for a project's page, the project by its key, and on its Manager page which of
   * its managers, by its contact.
   */
  page: { section: '', project: '', manager: '' },
  /** The pages of the project on show are folded away under it, by a click on its line. */
  folded: false,
  open: false,
};

/**
 * What Settings is drawn in, once it was first opened: its row in the title bar, which the professional look
 * shows, and the rest, over the window's own page. @type {{ bar: HTMLElement, view: HTMLElement } | null}
 */
let drawn = null;
/** What had the focus before Settings opened: it has it again after. @type {HTMLElement | null} */
let before = null;
/** Gives back the dialogs that were open over the window as Settings opened. */
let giveBack = () => {};
/** What Back goes back to, as its button says. */
let backTo = () => '';
/** What the window is doing under Settings, such as an agent at work: '' for nothing. */
let busy = '';

/** What matches `selector` in the title bar's row and the rest: each Back button, and each line of what goes on under it. */
const inBoth = (selector) => [drawn.bar, drawn.view].flatMap((part) => [...part.querySelectorAll(selector)]);

const projectOf = (key) => state.projects.find((project) => project.key === key);
const isProjectPage = (section) => PROJECT_PAGES.some((page) => page.id === section);

// ---- the bar at the bottom ------------------------------------------------------------------
let fading = 0;

/** @param {string} text @param {boolean} [failed]  a refusal stays until the next change; anything else fades */
function said(text, failed = false) {
  const bar = $('.st-status', drawn.view);
  clearTimeout(fading);
  bar.textContent = text;
  bar.classList.toggle('failed', failed);
  if (!failed) fading = setTimeout(() => (bar.textContent = ''), 2500);
}

/** Runs a change, and says how it went. @returns {Promise<boolean>} false when it was refused */
async function saving(change) {
  try {
    await change();
    said('Saved.');
    return true;
  } catch (err) {
    said(errorText(err), true);
    return false;
  }
}

const save = (patch) =>
  saving(async () => {
    state.settings = await api.app.updateSettings(patch);
  });

const saveProject = (key) => (patch) =>
  saving(async () => {
    const settings = await api.projects.update(key, patch);
    const project = projectOf(key);
    if (project) project.settings = settings;
  });

// ---- the list on the left -------------------------------------------------------------------

function navItem(label, { key, selected = false, project = false, open = false, expanded = false, go }) {
  const classes = ['st-nav-item', selected && 'selected', project && 'project', open && 'open']
    .filter(Boolean)
    .join(' ');
  const item = el(
    html`<button class="${classes}" type="button" title="${label}">
      ${raw(project ? groupArrow() : '')}<span>${label}</span>
    </button>`
  );
  item.dataset.key = key;
  if (selected) item.setAttribute('aria-current', 'page');
  if (project) item.setAttribute('aria-expanded', String(expanded));
  item.addEventListener('click', go);
  return item;
}

function renderNav() {
  const nav = $('.st-nav', drawn.view);
  const focused = nav.contains(document.activeElement) ? document.activeElement.dataset.key : null;
  const nodes = navRows(state).map((row) => {
    if (row.kind === 'heading') return el(html`<div class="st-nav-heading">${row.label}</div>`);
    if (row.kind === 'empty')
      return el('<div class="st-nav-empty">A project shows here once a contact works on it.</div>');
    if (row.kind === 'page') {
      const item = navItem(row.label, {
        key: row.section,
        selected: row.selected,
        go: () => show({ section: row.section }),
      });
      if (!row.pages.length) return item;
      const children = el(html`<div class="st-nav-pages" role="group" aria-label="${row.label}"></div>`);
      children.append(
        ...row.pages.map((page) =>
          navItem(page.label, {
            key: page.section,
            selected: page.selected,
            go: () => show({ section: page.section }),
          })
        )
      );
      return [item, children];
    }
    const { project, open, expanded, selected } = row;
    // A project's own line opens its overview, which says how it is set up and leads to each page. On the one
    // open, it folds its pages away under it, or brings them back.
    const item = navItem(row.label, {
      key: project,
      project: true,
      open,
      expanded,
      selected,
      go: open ? fold : () => show({ section: 'overview', project }),
    });
    if (!expanded) return item;
    const pages = el(html`<div class="st-nav-pages" role="group" aria-label="${row.label}"></div>`);
    pages.append(
      ...row.pages.map((page) =>
        navItem(page.label, {
          key: JSON.stringify([project, page.section]),
          selected: page.selected,
          go: () => show({ section: page.section, project }),
        })
      )
    );
    return [item, pages];
  });
  nav.replaceChildren(...nodes.flat());
  // Replacing the rows must not drop keyboard focus when Enter or Space opens or folds a project.
  if (focused)
    [...nav.querySelectorAll('.st-nav-item')]
      .find((item) => item.dataset.key === focused)
      ?.focus({ preventScroll: true });
  // Turned to from another window, such as a project's from its contact, the line on show may be further down.
  $('[aria-current]', nav)?.scrollIntoView({ block: 'nearest' });
}

/** Folds the open project's pages away under it, or brings them back. */
function fold() {
  state.folded = !state.folded;
  renderNav();
}

// ---- the page on the right ------------------------------------------------------------------

function renderPage() {
  const { section, project: key } = state.page;
  const project = projectOf(key);
  const page = [...APP_PAGES, ...PROJECT_PAGES].find((p) => p.id === section);
  const title = project ? `${project.name}: ${page.label}` : page.label;
  const ctx = {
    // As they are when they are read: a dialog opened from a page that has been up a while shows today's.
    get settings() {
      return state.settings;
    },
    providers: state.providers,
    platform: state.platform,
    project,
    save,
    saveProject: saveProject(key),
    said,
    go: (to) => show({ section: to, project: key }),
    manager: state.page.manager,
    reload: () => load().then(() => show(state.page)),
  };
  const shown = $('.st-page', drawn.view);
  shown.replaceChildren(
    el(html`<h1>${title}</h1>`),
    el(html`<p class="st-lead">${page.lead}</p>`),
    ...page.render(ctx).filter(Boolean)
  );
  shown.scrollTop = 0;
}

/**
 * Turns to a page. One that moved, such as Misc, is the one its settings went to. One that isn't there, such
 * as a project's whose project is gone, is the first instead, and a project's that this project doesn't
 * have, such as the Manager of a folder outside git, its Overview, which says why. On a project's Manager page,
 * `manager` says which of its managers, by its contact.
 * @param {{ section?: string, project?: string, manager?: string }} page
 */
function show({ section = '', project = '', manager = '' }) {
  const asked = pageId(section);
  const ofProject = isProjectPage(asked) && projectOf(project);
  const has = ofProject && projectPages(ofProject.key).some((page) => page.id === asked);
  const known = ofProject || APP_PAGES.some((page) => page.id === asked);
  state.page = !known
    ? { section: APP_PAGES[0].id, project: '', manager: '' }
    : {
        section: ofProject && !has ? 'overview' : asked,
        project: ofProject ? project : '',
        manager: ofProject ? manager : '',
      };
  state.folded = false;
  closeMenu();
  renderNav();
  renderPage();
}

// ---- over the window ------------------------------------------------------------------------

/** What there is to set, as it is now. */
async function load() {
  const { settings, providers, projects, platform } = await api.settings.init();
  Object.assign(state, { settings, providers, projects, platform });
  setModelSettings(settings);
}

/** Draws what Settings is in, the first time it opens: the window's frame is there by then. */
function draw() {
  const back = () =>
    el(html`<button class="st-back" type="button">${raw(smallIcon.back())}<span class="st-back-to"></span></button>`);
  const bar = el(
    html`<div class="st-titlebar">
      <span class="st-title">Settings<span class="st-title-of"></span></span>
      <kbd class="st-esc">esc</kbd>
      <button class="st-busy" type="button" hidden></button>
    </div>`
  );
  bar.prepend(back());
  const view = el(
    html`<section class="st-view" aria-label="Settings">
      <div class="st-strip">
        <span class="st-strip-hint">or press Esc</span>
        <button class="st-busy" type="button" hidden></button>
      </div>
      <div class="st-main">
        <nav class="st-nav" aria-label="Settings"></nav>
        <main class="st-page" tabindex="-1"></main>
      </div>
      <footer class="st-status" role="status"></footer>
    </section>`
  );
  const strip = $('.st-strip', view);
  strip.prepend(back());
  $('.st-back', strip).classList.add('btn');
  // A key pressed in Settings is its own: the window's shortcuts, such as a new chat tab, wait until it is closed.
  view.addEventListener('keydown', (e) => e.stopPropagation());
  // In the title's place: the messenger's title bar keeps the window's buttons after it.
  $('.titlebar-text').after(bar);
  $('.window').append(view);
  drawn = { bar, view };
  for (const button of inBoth('.st-back, .st-busy')) button.addEventListener('click', close);
  showBusy();
}

/** Says what goes on under Settings, in the title bar's row and in the messenger's strip. */
function showBusy() {
  for (const line of inBoth('.st-busy')) {
    line.hidden = !busy;
    line.textContent = busy;
    line.title = busy && `${busy} Back to ${backTo()}`;
  }
}

/**
 * Opens Settings over the window, or turns it to a page where it is open already.
 * @param {{ section?: string, project?: string, manager?: string }} page  no section: the page it is on, or the first
 */
async function open(page) {
  await load();
  if (!drawn) draw();
  if (!state.open) {
    state.open = true;
    before = /** @type {HTMLElement | null} */ (document.activeElement);
    const to = backTo();
    for (const label of inBoth('.st-back-to')) label.textContent = to;
    for (const button of inBoth('.st-back')) button.title = `Back to ${to} (Esc)`;
    $('.st-title-of', drawn.bar).textContent = ` - ${to}`;
    place();
    // What the window had stays as it was underneath, and nothing in it can be reached meanwhile. So does a
    // dialog open over it, such as Add a Contact's that Edit teams... opened Settings from: it would hide Settings.
    /** @type {HTMLElement} */ ($('.window-body')).inert = true;
    giveBack = putDialogsAside();
    $('.window').classList.add('st-open');
  }
  // Asked for without a page, it shows the one it was on last here, or the first.
  show(page.section ? page : state.page);
  $('.st-page', drawn.view).focus({ preventScroll: true });
}

/**
 * Has Settings start where the window's own body does. In the messenger that is under the title and the menus,
 * and the professional look puts it in the body's place itself (see pro.css).
 */
function place() {
  drawn.view.style.setProperty('--st-top', `${/** @type {HTMLElement} */ ($('.window-body')).offsetTop}px`);
}

/** Gives the window back what it had, as it was. */
function close() {
  if (!state.open) return;
  state.open = false;
  closeMenu();
  $('.window').classList.remove('st-open');
  /** @type {HTMLElement} */ ($('.window-body')).inert = false;
  giveBack();
  giveBack = () => {};
  // Unless it went meanwhile, such as Set up a team... once there is a team: then the dialog it was in has it.
  if (before?.isConnected) before.focus({ preventScroll: true });
  before = null;
  api.settings.closed();
}

/**
 * Settings in this window, the contact list or a conversation: shown when the main process says which page,
 * and closed with Back or Esc.
 * @param {object} opts
 * @param {() => string} opts.backTo  what Back goes back to, as its button says: Contacts, or the conversation
 * @returns {{ isOpen: () => boolean, setBusy: (text: string) => void }}  `setBusy`: what the window is doing
 *   under Settings meanwhile, such as an agent at work, or '' for nothing. A click on it goes back to it
 */
export function mountSettings(opts) {
  backTo = opts.backTo;

  // The main process asks for a page, and says when Settings was opened in another window instead.
  api.on.settingsPage((page) => open(page));
  api.on.settingsClose(() => close());
  // The look changed in Settings itself: the title and the menus over the body are another height.
  onLook((look) => {
    // Keep the semantics in step with the CSS without redrawing a box the user is editing.
    for (const box of drawn?.view.querySelectorAll('.st-toggle input') ?? []) {
      box.setAttribute('role', look === 'professional' ? 'switch' : 'checkbox');
    }
    if (state.open) place();
  });
  // Esc closes Settings, and nothing else: an agent at work under it is not nudged. A menu or a dialog open
  // over it, such as one of its own, is closed first, as is a line of a list that is open where the focus is
  // (foldList), and a word being put together is the input method's. A dialog put aside under it waits.
  window.addEventListener(
    'keydown',
    (e) => {
      if (
        !state.open ||
        e.key !== 'Escape' ||
        e.isComposing ||
        isMenuOpen() ||
        document.querySelector('.modal:not([hidden])') ||
        (e.target instanceof Element && e.target.closest('.st-fold.open'))
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      close();
    },
    true
  );

  /** Which of each service's accounts is in use, as one string to compare. */
  const accountsInUse = (settings) =>
    JSON.stringify(Object.entries(settings.accounts || {}).map(([id, kept]) => [id, kept.inUse]));

  // A change made somewhere else, such as a run command typed in another conversation, is drawn while the
  // window is in the background. One made here is on the page already, where it was typed. Another account
  // put in use is marked at once, also with the window in front: a conversation switches by itself when one
  // reaches a limit.
  api.on.settings((settings) => {
    if (!state.open) return;
    const switched = state.page.section === 'accounts' && accountsInUse(settings) !== accountsInUse(state.settings);
    state.settings = settings;
    setModelSettings(settings);
    if (!document.hasFocus() || switched) renderPage();
  });
  api.on.project(({ key, settings }) => {
    const project = state.open && projectOf(key);
    if (!project) return;
    project.settings = settings;
    if (!document.hasFocus() && state.page.project === key) renderPage();
  });
  // A contact added meanwhile may have brought a project.
  window.addEventListener('focus', async () => {
    if (!state.open) return;
    const known = state.projects.map((project) => project.key).join('\n');
    const { projects } = await api.settings.init();
    if (!state.open || projects.map((project) => project.key).join('\n') === known) return;
    state.projects = projects;
    renderNav();
  });

  return {
    isOpen: () => state.open,
    setBusy(text) {
      if (text === busy) return;
      busy = text;
      if (drawn) showBusy();
    },
  };
}
