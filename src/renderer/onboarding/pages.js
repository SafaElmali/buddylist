// The pages of the welcome wizard, in the order Next goes through them. Each draws
// itself from what the window knows; what a click does is the window's to say.
import { el, html, raw } from '../lib/dom.js';
import { listNames } from '../lib/format.js';
import { buddy, smallIcon, toolbarIcon } from '../lib/icons.js';
import { DEFAULT_LOOK, LOOKS, schemeOf, themeIn } from '../../shared/theme.js';
import { readyAgents, setupLook, setupSummary, signInWays } from './setup.js';

/** @typedef {import('../../main/setup-check.js').SetupItem} SetupItem */

/**
 * A sign-in started from the wizard.
 * @typedef {Object} SignIn
 * @property {boolean} running    the browser is open, and the user is not done there yet
 * @property {string} [problem]   why the last one did not work, in the CLI's words
 */

/**
 * What a page is drawn from.
 * @typedef {Object} PageContext
 * @property {import('../../providers/contract.js').ProviderDescriptor[]} providers  the services a contact can be of
 * @property {SetupItem[] | null} setup  what the setup check found; null while it is still asking
 * @property {Record<string, SignIn>} signIns  the sign-ins started here, by service
 * @property {boolean} mac
 * @property {import('../../shared/theme.js').Look} look  what the windows are drawn as
 * @property {import('../../shared/theme.js').Theme} theme  and in which theme
 * @property {(patch: { look: string } | { theme: string }) => void} appearance  change the look or the theme
 * @property {number} feature  which of "What it can do"'s is shown, by its place in FEATURES
 * @property {(index: number) => void} showFeature  show another of them
 * @property {(avatar: string) => string} picture  a service's display picture, as markup
 * @property {() => void} recheck  ask the CLIs again
 * @property {(id: string, button: HTMLElement) => void} signIn  sign a service in, starting at its button
 * @property {(id: string) => void} cancelSignIn  call a service's sign-in off
 * @property {(way: 'open' | 'clone' | 'create') => void} addProject  one of the ways to a project, then its contact
 */

/** One thing worth knowing, with its picture. */
const point = (icon, title, text) =>
  html`<li class="ob-point">
    <span class="ob-point-icon">${raw(icon)}</span>
    <span class="ob-point-text"><b>${title}</b> ${text}</span>
  </li>`;

/** @param {PageContext} ctx */
function welcome({ providers }) {
  return el(
    html`<div>
      <p class="ob-lead">Your coding agents, side by side.</p>
      <p>
        A <b>contact</b> is an AI agent working in one of your project folders, or on this computer with none:
        ${listNames(providers.map((p) => p.name))}, the same ones you run in a terminal, with the same sign-in and
        settings.
      </p>
      <p>
        <b>Double-click</b> a contact to talk to it. It reads the project, runs commands and changes files, and you
        follow along in a conversation window.
      </p>
      <p>
        The next pages pick how it looks, check that your agents are ready, show what they can do and end in your first
        project. It takes about a minute.
      </p>
    </div>`
  );
}

/** What each look is like, beside a picture of a conversation drawn in it. */
const LOOK_TEXT = {
  professional: 'Flat and quiet, in your system’s own type. By day or at night.',
  messenger: 'The 2005 buddy list: Luna blue, emoticons, winks, nudges and the sounds.',
};

/** The colour schemes a theme comes in, as Day, Night and the computer's own. */
const SCHEMES = [
  { scheme: 'light', label: 'Day' },
  { scheme: 'dark', label: 'Night' },
  { scheme: 'system', label: 'Match system' },
];

/** The looks, the one a new install starts in first. */
const OFFERED = [...LOOKS].sort((a, b) => Number(b.id === DEFAULT_LOOK) - Number(a.id === DEFAULT_LOOK));

/** @param {PageContext} ctx */
function looks({ look, theme, appearance }) {
  const page = el(
    html`<div>
      <p class="ob-lead">Same app, same buttons: two ways to draw it.</p>
      <div class="ob-looks" role="group" aria-label="Look">
        ${OFFERED.map(
          ({ id, label }) =>
            html`<button class="ob-look" type="button" data-look="${id}" aria-pressed="${String(id === look)}">
              <img src="onboarding/pictures/look-${id}.webp" alt="" />
              <span class="ob-look-name"
                ><b>${label}</b>${id === DEFAULT_LOOK && html`<span class="ob-look-tag">Default</span>`}</span
              >
              <span class="ob-look-text">${LOOK_TEXT[id]}</span>
            </button>`
        )}
      </div>
      <p class="ob-schemes">
        <span>Colours</span>
        <span class="ob-seg" role="group" aria-label="Colours">
          ${SCHEMES.map(
            ({ scheme, label }) =>
              html`<button type="button" data-scheme="${scheme}" aria-pressed="${String(schemeOf(theme) === scheme)}">
                ${label}
              </button>`
          )}
        </span>
      </p>
      <p class="ob-hint">
        Change them whenever you like, with <b>Look</b> and <b>Theme</b> under <b>Tools</b> in the contact list.
      </p>
    </div>`
  );
  for (const button of /** @type {NodeListOf<HTMLElement>} */ (page.querySelectorAll('[data-look]'))) {
    button.addEventListener('click', () => appearance({ look: button.dataset.look }));
  }
  for (const button of /** @type {NodeListOf<HTMLElement>} */ (page.querySelectorAll('[data-scheme]'))) {
    button.addEventListener('click', () =>
      appearance({ theme: themeIn(theme, /** @type {any} */ (button.dataset.scheme)) })
    );
  }
  return page;
}

/** Under a line that can be signed in from here: the way in, or how that is going. */
const signInLine = (item, { running = false, problem = '' } = {}) =>
  running
    ? html`<span class="ob-agent-signin">
        <span class="busy-bar"></span> Finish signing in in your browser.
        <button class="link" type="button" data-cancel-sign-in="${item.id}">Cancel</button>
      </span>`
    : html`<span class="ob-agent-signin">
        <button class="btn" type="button" data-sign-in="${item.id}">Sign in...</button>
        ${problem && html`<span class="ob-agent-problem">${problem}</span>`}
      </span>`;

/**
 * A line of the setup check: who, how it stands, and what to do about it.
 * @param {SetupItem} item
 * @param {PageContext} ctx
 */
const setupRow = (item, { picture, providers, signIns }) => {
  const { presence, label } = setupLook(item.state);
  return html`<li class="ob-agent ${item.state}">
    <span class="ob-agent-picture">${raw(item.avatar ? picture(item.avatar) : toolbarIcon.pullRequest())}</span>
    <span class="ob-agent-text">
      <span class="ob-agent-name"
        ><b>${item.name}</b>${item.optional ? html` <span class="ob-optional">(optional)</span>` : ''}</span
      >
      <span class="ob-agent-state">${raw(buddy(presence, 14))} ${label}</span>
      ${item.note && html`<span class="ob-agent-note">${item.note}</span>`}
      ${signInWays(item, providers).length ? signInLine(item, signIns[item.id]) : ''}
    </span>
  </li>`;
};

/** @param {PageContext} ctx */
function agents(ctx) {
  const { setup, recheck, signIn, cancelSignIn } = ctx;
  const page = el(
    html`<div>
      <p>
        Each service is the command-line agent on this computer, with its own sign-in. Nothing is sent to any of them to
        find this out.
      </p>
      ${
        setup
          ? html`<ul class="ob-agents">
                ${setup.map((item) => setupRow(item, ctx))}
              </ul>
              <p class="ob-summary ${readyAgents(setup).length ? '' : 'nobody'}">
                ${setupSummary(setup)} <button class="link" id="recheck" type="button">Check again</button>
              </p>`
          : html`<p class="ob-checking"><span class="busy-bar"></span> Looking for your agents...</p>`
      }
      <p class="ob-hint">
        The GitHub CLI is nobody to talk to. With it, a contact shows how its pull request stands, and you can pick one
        of your repositories to clone.
      </p>
    </div>`
  );
  page.querySelector('#recheck')?.addEventListener('click', recheck);
  for (const button of /** @type {NodeListOf<HTMLElement>} */ (page.querySelectorAll('[data-sign-in]'))) {
    button.addEventListener('click', () => signIn(button.dataset.signIn, button));
  }
  for (const button of /** @type {NodeListOf<HTMLElement>} */ (page.querySelectorAll('[data-cancel-sign-in]'))) {
    button.addEventListener('click', () => cancelSignIn(button.dataset.cancelSignIn));
  }
  return page;
}

/** @param {PageContext} ctx */
function basics({ mac }) {
  const alt = mac ? '⌥' : 'Alt+';
  return el(
    html`<ul class="ob-points">
      ${point(
        toolbarIcon.folder(),
        'A copy of its own.',
        'In a git repository every contact works in its own worktree, on its own branch. The folder you picked is never touched, and two contacts never change each other’s files.'
      )}
      ${point(
        toolbarIcon.shield(),
        'It asks first.',
        html`Before it runs a command or changes a file you get an invitation in the conversation:
          <b>Accept</b> (${alt}C), <b>Always allow</b> or <b>Decline</b> (${alt}D). The <b>Mode</b> menu sets how much
          it may do without asking.`
      )}
      ${point(
        smallIcon.nudge(),
        'Nudge to stop.',
        html`<b>Nudge</b>, or <b>Esc</b> twice, shakes the window and stops whatever your contact is doing.`
      )}
      ${point(
        buddy('away', 28),
        'The list is a status board.',
        html`<b>Online</b> is ready, <b>Busy</b> is working, <b>Away</b> is waiting for you to approve something. A
          toast and the ${mac ? 'menu bar' : 'system tray'} tell you when a contact needs you.`
      )}
    </ul>`
  );
}

/**
 * What "What it can do" shows, one at a time: a picture of each, in the look the windows are in and,
 * for the professional look, by day or at night. Short clips of the app take the pictures' place once
 * there are some.
 */
export const FEATURES = Object.freeze([
  {
    id: 'parallel',
    label: 'In parallel',
    title: 'Several at once, never in each other’s way',
    text: html`Add a contact for every project, or point at one and click <b>+</b> for another on the same project. In a
      git repository each works in its own worktree, on its own branch. The list says who is busy, who is waiting for
      you, and how each pull request stands.`,
  },
  {
    id: 'group',
    label: 'Group chats',
    title: 'Agents that review each other',
    text: html`<b>Invite</b> brings a second agent into a conversation: a Codex next to a Claude, say. They answer in
      turn, one building and one reviewing, and a message that starts with <b>@</b> and a name asks just that one.`,
  },
  {
    id: 'manager',
    label: 'Managers',
    title: 'A manager that keeps the project on track',
    text: html`Right-click a project and choose <b>Add a manager...</b>. It knows the PRDs and tickets you point it to,
      looks at every change against them, and tells each conversation what has to change.`,
  },
  {
    id: 'changes',
    label: 'Changes and PRs',
    title: 'From the diff to the pull request',
    text: html`The <b>Changes</b> tab lists the files a contact changed, each with its diff. <b>Create PR</b> asks it to
      commit, push and open a pull request, and its line in the list says how the checks stand. Your own
      <b>terminal</b>, a <b>browser</b> and <b>Run</b> are beside the conversation too.`,
  },
]);

/** @param {PageContext} ctx */
function features({ look, feature, showFeature }) {
  const { id, title, text } = FEATURES[feature] ?? FEATURES[0];
  const picture = `onboarding/pictures/${id}-${look}`;
  const page = el(
    html`<div>
      <figure class="ob-feature-picture">
        <picture>
          ${look === 'professional' && html`<source srcset="${picture}-night.webp" media="(prefers-color-scheme: dark)" />`}
          <img src="${picture}.webp" alt="" />
        </picture>
      </figure>
      <p class="ob-feature-title">${title}</p>
      <p>${text}</p>
      <div class="ob-seg ob-features" role="group" aria-label="What it can do">
        ${FEATURES.map(
          ({ label }, i) =>
            html`<button type="button" data-feature="${i}" aria-pressed="${String(i === feature)}">${label}</button>`
        )}
      </div>
    </div>`
  );
  for (const button of /** @type {NodeListOf<HTMLElement>} */ (page.querySelectorAll('[data-feature]'))) {
    button.addEventListener('click', () => showFeature(Number(button.dataset.feature)));
  }
  return page;
}

/** The ways to a project, as the contact list's own menu names them, and the way to a contact on none. */
const WAYS = [
  { way: 'open', icon: smallIcon.folder, title: 'Open project...', text: 'A folder that is on this computer.' },
  {
    way: 'clone',
    icon: smallIcon.globe,
    title: 'Open GitHub project...',
    text: 'Clone a repository: type its address, or pick one of your own.',
  },
  {
    way: 'create',
    icon: smallIcon.folderPlus,
    title: 'Quick start...',
    text: 'A new folder with a git repository and a first commit.',
  },
  {
    way: 'computer',
    icon: smallIcon.computer,
    title: 'No project, just chat...',
    text: 'For questions, research and writing. It gets an empty folder of its own.',
  },
];

/** @param {PageContext} ctx */
function project({ setup, addProject }) {
  const nobody = Boolean(setup) && !readyAgents(setup).length;
  const page = el(
    html`<div>
      <p>A contact works on a project, or on this computer with none. Pick how to start:</p>
      <div class="ob-ways">
        ${WAYS.map(
          ({ way, icon, title, text }) =>
            html`<button class="ob-way" type="button" data-way="${way}">
              <span class="ob-way-icon">${raw(icon())}</span>
              <span class="ob-way-text"><b>${title}</b><span>${text}</span></span>
            </button>`
        )}
      </div>
      <p class="ob-hint">
        Each ends in <b>Add a Contact</b> with where it works filled in: pick the service and press <b>Enter</b>. Its
        conversation opens, and this window closes.
      </p>
      ${
        nobody &&
        html`<p class="ob-summary nobody">
          Nobody is ready yet, so a contact you add now can’t answer until its agent is set up.
        </p>`
      }
    </div>`
  );
  for (const button of page.querySelectorAll('.ob-way')) {
    button.addEventListener('click', () => addProject(/** @type {HTMLElement} */ (button).dataset.way));
  }
  return page;
}

/**
 * `label` is what the list at the side calls the page, `title` what stands over it.
 * @type {readonly { id: string, label: string, title: string, draw: (ctx: PageContext) => HTMLElement }[]}
 */
export const PAGES = Object.freeze([
  { id: 'welcome', label: 'Welcome', title: 'Welcome to buddylist', draw: welcome },
  { id: 'look', label: 'Your look', title: 'Pick your look', draw: looks },
  { id: 'agents', label: 'Your agents', title: 'Who can you talk to?', draw: agents },
  { id: 'basics', label: 'A conversation', title: 'How a conversation works', draw: basics },
  { id: 'features', label: 'What it can do', title: 'What it can do', draw: features },
  { id: 'project', label: 'A project', title: 'Add a project', draw: project },
]);

/**
 * The page Back (-1) or Next (1) leads to from page `index`. Neither leads out of the wizard.
 * @param {number} index
 * @param {1 | -1} by
 */
export const step = (index, by) => Math.min(PAGES.length - 1, Math.max(0, index + by));
