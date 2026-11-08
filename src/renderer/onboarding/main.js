// The welcome wizard: what a new install opens with, and what Help > Getting started
// brings back. Its pages are in pages.js; this is the window around them. It ends in
// the first contact, added with the contact list's own dialogs.
// First, so that an error in what the lines below load is reported too.
import '../lib/error-reports.js';
// Next, so that the window is drawn in its look from the start.
import '../lib/look.js';
import { api } from '../lib/api.js';
import { $, el, html, raw } from '../lib/dom.js';
import { mountFrame } from '../lib/frame.js';
import { openMenu } from '../lib/menu.js';
import { setPack } from '../lib/pack.js';
import { pictureHtml } from '../lib/pictures.js';
import { contactDialog } from '../contacts/contact-dialog.js';
import { githubDialog } from '../contacts/github-dialog.js';
import { setModelSettings } from '../contacts/models.js';
import { cloneDialog, quickStartDialog } from '../contacts/project-dialogs.js';
import { lookOf, schemeOf, themeOf } from '../../shared/theme.js';
import { PAGES, step } from './pages.js';
import { GITHUB, readyFirst } from './setup.js';

const state = {
  page: 0,
  providers: [],
  groups: [],
  settings: { projectsFolder: '' },
  /** @type {import('../../main/setup-check.js').SetupItem[] | null} what the setup check found; null while it asks */
  setup: null,
  /** @type {Record<string, import('./pages.js').SignIn>} the sign-ins started here, by service */
  signIns: {},
  /** which of "What it can do"'s is shown */
  feature: 0,
};

const isLast = () => state.page === PAGES.length - 1;

/**
 * The ways to a project. Each answers with its folder, or with nothing when the user thought better of it. This
 * computer needs none: its contact works on no project.
 */
const WAYS = {
  open: () => api.contacts.pickFolder(state.settings.projectsFolder),
  clone: () => cloneDialog({ folder: state.settings.projectsFolder }),
  create: () => quickStartDialog({ folder: state.settings.projectsFolder }),
};

/** A project, then the contact that works on it, or a contact on This computer. Its conversation takes over from the wizard. */
async function addProject(way) {
  const computer = way === 'computer';
  const folder = computer ? '' : await WAYS[way]();
  if (!folder && !computer) return;
  const added = await contactDialog({
    // A service that is ready comes first, so pressing Enter makes a contact that can answer.
    providers: readyFirst(state.providers, state.setup),
    groups: state.groups,
    // The first contact can bring a reviewer along, as any other can.
    teams: state.settings.teams ?? [],
    roles: state.settings.roles ?? [],
    defaults: state.settings.contactDefaults,
    openTeams: () => api.settings.open({ section: 'teams' }),
    ...(computer ? { computer } : { folder }),
  });
  if (!added) return;
  await api.chat.open(added.id);
  api.window.close();
}

/** Asks every CLI how it stands. The page says that it is asking, then what was found. */
async function checkSetup() {
  state.setup = null;
  show();
  state.setup = await api.onboarding.setup();
  show();
}

/**
 * Signs a service in with its CLI's own sign-in. The line says that the browser is waiting, and
 * once that is over, however it ended, every CLI is asked again how it stands.
 */
async function signIn(id, way) {
  state.signIns[id] = { running: true };
  show();
  const { ok, message } = await api.onboarding.signIn(id, way);
  state.signIns[id] = { running: false, problem: ok ? '' : message };
  await checkSetup();
}

/** "Sign in..." on a line of the check: which way, where its service has more than one. */
function pickSignIn(id, button) {
  // GitHub's has a code to show, and a dialog for it. However that ends, every CLI is asked again.
  if (id === GITHUB) return githubDialog().then(checkSetup);
  const ways = state.providers.find((provider) => provider.id === id)?.signIn ?? [];
  if (ways.length === 1) return signIn(id, ways[0].id);
  openMenu(
    button,
    ways.map(({ id: way, label, hint }) => ({ label, hint, action: () => signIn(id, way) }))
  );
}

/**
 * A look or a theme picked on its page. Every window, this one too, changes to it as the settings
 * say so, and the page shows it picked at once.
 */
function appearance(patch) {
  state.settings = { ...state.settings, ...patch };
  show();
  $('look' in patch ? `[data-look="${patch.look}"]` : `[data-scheme="${schemeOf(patch.theme)}"]`)?.focus();
  api.app.updateSettings(patch);
}

/** Another of "What it can do"'s, with the focus still on its button. */
function showFeature(index) {
  state.feature = index;
  show();
  $(`[data-feature="${index}"]`)?.focus();
}

/** @returns {import('./pages.js').PageContext} */
const context = () => ({
  providers: state.providers,
  setup: state.setup,
  signIns: state.signIns,
  mac: navigator.platform.toLowerCase().includes('mac'),
  look: lookOf(state.settings.look),
  theme: themeOf(state.settings.theme),
  appearance,
  feature: state.feature,
  showFeature,
  picture: (avatar) => pictureHtml({ avatar, size: 'tiny' }),
  recheck: checkSetup,
  signIn: pickSignIn,
  cancelSignIn: (id) => api.onboarding.cancelSignIn(id),
  addProject,
});

/** Draws the page the wizard is on, and what the list at the side and the buttons say about it. */
function show() {
  const page = PAGES[state.page];
  $('#steps').replaceChildren(
    ...PAGES.map(({ label }, i) => {
      const where = i === state.page ? 'current' : i < state.page ? 'done' : '';
      return el(html`<li class="${where}" ${i === state.page ? raw('aria-current="step"') : ''}>${label}</li>`);
    })
  );
  $('#page').replaceChildren(el(html`<h1>${page.title}</h1>`), page.draw(context()));
  $('#back').disabled = state.page === 0;
  $('#next').textContent = isLast() ? 'Finish' : 'Next >';
  $('#skip').hidden = isLast();
}

/** @param {1 | -1} by */
function go(by) {
  state.page = step(state.page, by);
  show();
  $('#page').scrollTop = 0;
  // Enter goes on to the next page. On the last one it picks a project: Finish would end the wizard without one.
  (isLast() ? $('.ob-way') : $('#next')).focus();
}

async function main() {
  mountFrame({ title: 'Welcome to buddylist', maximizable: false });
  // A contact's picture can be one from the user's pack, which "Add a Contact" offers.
  setPack(await api.pack.list());
  const data = await api.app.init();
  Object.assign(state, { providers: data.providers, groups: data.groups, settings: data.settings });
  setModelSettings(data.settings);

  $('#back').addEventListener('click', () => go(-1));
  $('#next').addEventListener('click', () => (isLast() ? api.window.close() : go(1)));
  $('#skip').addEventListener('click', () => api.window.close());
  // A project cloned or made here moves where the next one is offered to go.
  api.on.settings((settings) => {
    const changed = settings.look !== state.settings.look || settings.theme !== state.settings.theme;
    state.settings = settings;
    setModelSettings(settings);
    // Its look and theme, also as Tools picks them, are shown on the page that offers them, and its pictures are of the look.
    if (changed) show();
  });
  api.on.groups((groups) => {
    state.groups = groups;
  });

  show();
  $('#next').focus();
  checkSetup();
}

main();
