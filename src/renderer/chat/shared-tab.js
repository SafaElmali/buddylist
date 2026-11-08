// The Shared tab beside a conversation: what was shared in it. Its pull requests and issues,
// the web pages linked, the files linked or sent and the pictures sent, each once, the newest
// first, with who shared it and when. A click on one goes to the message it was shared in, and
// the button at the end of its row opens it, as a click on it in the conversation does. Like the
// pins, it is read from the conversation itself (see Conversation.sharedMessages). A pull request
// wears the tags a contact's does in the contact list, as GitHub says it stands.
import { isWebAddress } from '../../shared/browser.js';
import { fileLabel } from '../../shared/file-mentions.js';
import { parseReference } from '../../shared/github-item.js';
import { linkedFile } from '../../shared/links.js';
import { pullRequestLine, pullRequestTags } from '../../shared/pull-request-text.js';
import { el, html, raw } from '../lib/dom.js';
import { listIcon, smallIcon, tagIcon } from '../lib/icons.js';
import { openMenu } from '../lib/menu.js';

/** @typedef {import('../../main/contact-card.js').PullRequest} PullRequest */

const TAB = 'shared';
// How long what GitHub said of a pull request stands before the tab, painted again, asks again.
// A merged one is merged for good, and is not asked about again.
const PULL_REQUEST_FRESH_MS = 60 * 1000;

/**
 * What a message shared, as the conversation shows it.
 * @typedef {Object} Said
 * @property {string} id  the message, by its id in the conversation's history
 * @property {string} who
 * @property {string} when
 * @property {{ url: string, href: string | null }[]} links  in the order they are in it. `url`: the address
 *   the page made of the link; `href`: the link as it was written
 * @property {string[]} files  the files and folders it names, by their paths
 * @property {string[]} pictures  the pictures sent with it, as the addresses of their previews
 */

/**
 * Something that was shared, once: as it was the last time.
 * @typedef {Object} Shared
 * @property {'github' | 'link' | 'file' | 'picture'} kind
 * @property {string} key  what it is: an issue or pull request, an address, a path, a picture
 * @property {string} id  the message it was shared in
 * @property {string} who
 * @property {string} when
 * @property {{ url: string, href: string | null }} [link]  what it opens, for one that was a link
 * @property {boolean} [pull]  an issue or pull request is a pull request
 * @property {number} [picture]  which of the message's pictures it is
 */

/** The kinds of thing shared, in the order the tab lists them, each with what its card is called. */
const KINDS = [
  { kind: 'github', title: 'Pull requests and issues' },
  { kind: 'link', title: 'Links' },
  { kind: 'file', title: 'Files' },
  { kind: 'picture', title: 'Pictures' },
];

/** What the tab says while nothing has been shared. */
export const NOTHING_SHARED =
  'Nothing has been shared here yet. The links, files and pictures sent in this conversation are listed here.';

/**
 * What a link in a message shares: a file an agent linked by its path, an issue or pull request, a
 * web page, or nothing kept here, as an e-mail address or a place on the page.
 * @param {{ url: string, href: string | null }} link
 * @param {Pick<Shared, 'id' | 'who' | 'when'>} from
 * @returns {Shared | null}
 */
function sharedLink(link, from) {
  const file = linkedFile(link.href);
  if (file) return { kind: 'file', key: file, link, ...from };
  // As it was written: "#top" is no page, also where the window is one.
  if (!isWebAddress(link.href)) return null;
  const reference = parseReference(link.url);
  // Its files, or a comment on it, are the same pull request.
  if (reference?.repo) {
    const key = `${reference.repo}#${reference.number}`;
    return { kind: 'github', key, link, pull: /\/pull\/\d/.test(link.url), ...from };
  }
  return { kind: 'link', key: link.url, link, ...from };
}

/**
 * What one message shared, in the order it is in it.
 * @param {Said} said
 * @returns {Shared[]}
 */
function sharedIn({ id, who, when, links, files, pictures }) {
  const from = { id, who, when };
  return [
    ...links.map((link) => sharedLink(link, from)).filter(Boolean),
    ...files.map((path) => ({ kind: /** @type {const} */ ('file'), key: path, ...from })),
    ...pictures.map((src, picture) => ({ kind: /** @type {const} */ ('picture'), key: src, picture, ...from })),
  ];
}

/**
 * What was shared in a conversation, on a card for each kind: each thing once, as it was shared
 * the last time, and the newest first. What one message shared stays in the order it is in it.
 * @param {Said[]} said  the messages, in the order they were said
 * @returns {{ kind: Shared['kind'], title: string, items: Shared[] }[]}  only the kinds there are
 */
export function sharedOf(said) {
  const seen = new Map();
  for (const message of said.toReversed()) {
    for (const item of sharedIn(message)) {
      const at = `${item.kind} ${item.key}`;
      if (!seen.has(at)) seen.set(at, item);
    }
  }
  const all = [...seen.values()];
  return KINDS.map(({ kind, title }) => ({ kind, title, items: all.filter((item) => item.kind === kind) })).filter(
    ({ items }) => items.length
  );
}

/** A path, or an address's, as it reads: "My%20Proof.mp4" is "My Proof.mp4". */
function readable(path) {
  try {
    return decodeURI(path);
  } catch {
    return path;
  }
}

/**
 * What a row says of what was shared: what it is, and where that is, which gives way first. The
 * whole of it is there when the pointer is on the row.
 * @param {Shared} item
 * @returns {{ name: string, where: string, title: string }}
 */
export function sharedLabel(item) {
  switch (item.kind) {
    case 'github':
      return { name: item.key, where: '', title: `${item.pull ? 'Pull request' : 'Issue'} ${item.link.url}` };
    case 'link': {
      const { host, pathname } = new URL(item.key);
      const page = pathname === '/' ? '' : readable(pathname);
      return { name: `${host.replace(/^www\./, '')}${page}`, where: '', title: item.key };
    }
    case 'file': {
      const { name } = fileLabel(item.key);
      const folder = item.key
        .replace(/[\\/]+$/, '')
        .slice(0, -name.length)
        .replace(/[\\/]+$/, '');
      return { name, where: folder, title: item.key };
    }
    default:
      return { name: 'Picture', where: '', title: 'Picture' };
  }
}

/** The icon a row has, in front of what it says: a picture has its own. @param {Shared} item */
function iconOf(item) {
  switch (item.kind) {
    case 'github':
      return raw(item.pull ? listIcon.pullRequest() : listIcon.issue());
    case 'link':
      return raw(smallIcon.globe());
    case 'file':
      return raw(/[\\/]$/.test(item.key) ? smallIcon.folder() : smallIcon.doc());
    default:
      return html`<img class="shared-picture" src="${item.key}" alt="" />`;
  }
}

/**
 * @typedef {Object} SharedHandlers
 * @property {() => Said[]} said  what the conversation's messages shared, in the order they were said
 * @property {(id: string) => void} goTo  brings a message into sight
 * @property {(url: string, href: string | null) => void} openLink  as a click on the link in the conversation does
 * @property {(path: string) => void} openFile  a file you sent, as a link to it opens: a text file beside the
 *   conversation, the rest in the app the computer opens it with
 * @property {(id: string, index: number) => void} viewPicture  a picture sent with a message, over the window
 * @property {(url: string) => import('../lib/menu.js').MenuItem[]} linkMenu  what a right-click on a web page's
 *   row offers, as it does on the link in the conversation
 * @property {(path: string) => import('../lib/menu.js').MenuItem[] | null} fileMenu  and on a file's, as on a link
 *   to it: to open it, and to download a video
 * @property {(id: string, index: number) => import('../lib/menu.js').MenuItem[]} pictureMenu  and on a picture's,
 *   as on the picture under its message: to copy it or download it
 * @property {(url: string) => Promise<PullRequest | null>} pullRequest  how the pull request on a page stands, as
 *   GitHub says; rejects when there is no telling
 */

export class SharedTab {
  /** @type {Shared[]} what the tab lists, for the row a click is on */
  #shown = [];
  /** @type {Map<string, { pr: PullRequest | null, at: number }>} a pull request shared here, by its key -> what
   *  GitHub last said of it, and when it was asked */
  #pulls = new Map();

  /**
   * @param {import('./side-pane.js').SidePane} pane
   * @param {{ web: boolean }} ctx  `web`: the browser preview, which can't open a file
   * @param {SharedHandlers} handlers
   */
  constructor(pane, ctx, handlers) {
    this.pane = pane;
    this.ctx = ctx;
    this.handlers = handlers;
    this.body = el('<div class="shared-tab"></div>');
    this.body.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      const item = this.#itemAt(target);
      if (!item) return;
      if (target.closest('[data-do="open"]')) this.#open(item);
      else this.#goTo(item);
    });
    this.body.addEventListener('contextmenu', (e) => {
      const item = this.#itemAt(/** @type {HTMLElement} */ (e.target));
      const items = item && this.#menu(item);
      if (!items?.length) return;
      e.preventDefault();
      openMenu({ x: e.clientX, y: e.clientY }, items);
    });
  }

  /**
   * What a right-click on a row offers: what one on what it lists does in the conversation. A file is not on
   * the computer of the web preview.
   * @param {Shared} item
   */
  #menu(item) {
    if (item.link && isWebAddress(item.link.url)) return this.handlers.linkMenu(item.link.url);
    if (item.kind === 'file') return this.ctx.web ? null : this.handlers.fileMenu(item.key);
    if (item.kind === 'picture') return this.handlers.pictureMenu(item.id, item.picture);
    return null;
  }

  get kind() {
    return { label: 'Shared', icon: smallIcon.link(), open: () => this.show() };
  }

  show() {
    this.pane.open({
      id: TAB,
      title: 'Shared',
      icon: smallIcon.link(),
      body: this.body,
      onSelect: () => this.paint(),
    });
    this.paint();
  }

  /** A message came or went: the tab on show lists what is shared now. */
  changed() {
    if (this.pane.shows(TAB)) this.paint();
  }

  /** The window came to the front: the tab on show asks how its pull requests stand now, as checks may have finished. */
  focused() {
    this.changed();
  }

  /** @param {HTMLElement} target @returns {Shared | undefined} */
  #itemAt(target) {
    const row = /** @type {HTMLElement | null} */ (target.closest('[data-item]'));
    return row ? this.#shown[Number(row.dataset.item)] : undefined;
  }

  /** The message it was shared in. With the pane over the whole window, the conversation is seen again first. */
  #goTo(item) {
    if (this.pane.full) this.pane.toggleFull();
    this.handlers.goTo(item.id);
  }

  /** @param {Shared} item */
  #open(item) {
    if (item.link) this.handlers.openLink(item.link.url, item.link.href);
    else if (item.kind === 'file') this.handlers.openFile(item.key);
    else this.handlers.viewPicture(item.id, item.picture);
  }

  /** Whether the row's button opens it: a file you sent is opened from your computer, which the preview has not. */
  #opens(item) {
    return Boolean(item.link) || item.kind === 'picture' || !this.ctx.web;
  }

  /**
   * Asks GitHub how a pull request shared here stands, unless it was asked a moment ago or is merged.
   * What it says paints the tab again where it reads differently. When it can't tell, what was known stands.
   * @param {Shared} item
   */
  #ask({ key, link }) {
    const known = this.#pulls.get(key);
    const now = Date.now();
    if (known && (known.pr?.state === 'merged' || now - known.at < PULL_REQUEST_FRESH_MS)) return;
    this.#pulls.set(key, { pr: known?.pr ?? null, at: now });
    this.handlers.pullRequest(link.url).then(
      (pr) => {
        const before = this.#pulls.get(key);
        this.#pulls.set(key, { pr, at: before.at });
        if (JSON.stringify(before.pr) !== JSON.stringify(pr)) this.changed();
      },
      () => {}
    );
  }

  paint() {
    const cards = sharedOf(this.handlers.said());
    this.#shown = cards.flatMap(({ items }) => items);
    for (const item of this.#shown) if (item.pull) this.#ask(item);
    let index = 0;
    this.body.replaceChildren(
      ...(cards.length
        ? cards.map(({ title, items }) =>
            el(
              html`<section class="session-card">
                <div class="session-head">${title}<small class="session-whose">${items.length}</small></div>
                ${items.map((item) => this.#row(item, index++))}
              </section>`
            )
          )
        : [el(html`<div class="helpers-note">${NOTHING_SHARED}</div>`)])
    );
  }

  /** @param {Shared} item @param {number} index  where it is among what the tab lists */
  #row(item, index) {
    const { name, where, title } = sharedLabel(item);
    const from = [where, item.who, item.when].filter(Boolean).join(' · ');
    const pr = item.pull ? (this.#pulls.get(item.key)?.pr ?? null) : null;
    const tags = pullRequestTags(pr);
    return html`<div class="shared-row" data-item="${index}">
      <button class="shared-go" type="button" title="${title}. Click to go to the message it was shared in.">
        ${iconOf(item)}
        <span class="shared-text">
          <span class="shared-name">${name}</span>
          <span class="shared-from">${from}</span>
        </span>
        ${
          tags.length
            ? html`<span class="shared-tags" title="${[pullRequestLine(pr), pr.title].filter(Boolean).join('\n')}">
                ${tags.map(
                  ({ kind, text }) =>
                    html`<span class="pr-tag" data-kind="${kind}">${raw(tagIcon[kind]())}${text}</span>`
                )}
              </span>`
            : ''
        }
      </button>
      ${
        this.#opens(item)
          ? html`<button class="shared-open" type="button" data-do="open" title="Open" aria-label="Open ${name}">
              ${raw(smallIcon.external())}
            </button>`
          : ''
      }
    </div>`;
  }
}
