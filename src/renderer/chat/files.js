// The All files tab beside a conversation: the contact's folder as a tree, its
// folders opened where you click them, and a tab for each file you open, which
// shows what it says, line by line in the colours of its language, as the Changes
// tab shows a diff. A Markdown file reads as a document, or as its text with
// Preview unticked. Nothing here changes a file: the folder is only ever read.
// The box over the tree finds a file anywhere in the folder, also in folders not
// opened yet, by its name or the way to it, and lists those it found in place of
// the tree until it is emptied (see shared/file-search.js).
import { asFolder } from '../../shared/file-mentions.js';
import { fileQuery, searchFiles } from '../../shared/file-search.js';
import { fileAddress } from '../../shared/links.js';
import { el, errorText, html, raw } from '../lib/dom.js';
import { fileIcon } from '../lib/file-icons.js';
import { plural } from '../lib/format.js';
import { smallIcon } from '../lib/icons.js';
import { isMarkdownFile, renderMarkdown } from '../lib/markdown.js';
import { mediaItems } from '../lib/media-menu.js';
import { openMenu, stepTo } from '../lib/menu.js';
import { scrolled, scrolledBack } from '../lib/scroll-place.js';
import { codeParts, languageOf } from '../lib/syntax.js';
import { fileMenu, revealLabel } from './changes-view.js';
import { wholeFile } from './diff-view.js';
import { markedText, PaneSearch, searchBox } from './pane-search.js';
import { FileFind } from './file-find.js';
import { FileFindFocus } from './file-find-focus.js';

const TAB = 'files';
/** The tab a file is shown in. @param {string} path */
const fileTab = (path) => `file:${path}`;

/** A path from the top of the folder, made of a folder's and a name in it. */
export const pathIn = (folder, name) => (folder ? `${folder}/${name}` : name);

/**
 * A file a link leads to, named as the tab names it: from the top of the folder, also when the link
 * wrote it from the top of the disk. One that is not in the folder keeps its path.
 * @param {string} root  the contact's folder
 * @param {string} file
 */
export function pathFrom(root, file) {
  const top = `${root.replace(/\/+$/, '')}/`;
  return (file.startsWith(top) ? file.slice(top.length) : file).replace(/^(\.\/)+/, '');
}

/** What a tab that shows a file is called: its name, without the folders it is in. @param {string} path */
export const fileTitle = (path) => path.split('/').pop() || path;

/**
 * What is said in place of a file that is not shown as text, or under one that is shown in part.
 * @param {{ binary: boolean, cut: boolean, size: number }} file
 * @returns {string}  '' when the whole of it is there to read
 */
export function fileNote({ binary, cut, size }) {
  const kb = Math.max(1, Math.round(size / 1024));
  if (binary) return `This is not a text file (${kb} KB).`;
  return cut ? `Only its beginning is shown: the file is ${kb} KB.` : '';
}

/**
 * A file's lines as its tab draws them, each split into the parts its language has names for, as
 * the lines of a diff are (see lib/syntax.js).
 * @param {string} path  tells the language
 * @param {{ text: string, cut: boolean }} file
 * @returns {import('../lib/syntax.js').CodePart[][]}  each line's parts; a line of a file whose language
 *   isn't known, or too long to colour, is one part with no colour
 */
export function codeLines(path, file) {
  const { lines } = wholeFile(file);
  const language = languageOf(path);
  const parts = lines.length && language ? codeParts(lines, language) : null;
  return parts ?? lines.map((text) => [{ text, scope: null }]);
}

/** A file's picture, which says what it is written in, as the Changes tab has it. @param {string} path */
const picture = (path) => `<img class="change-icon" src="${fileIcon(path)}" alt="" />`;

/** A part of a line of code, in its colour. @param {import('../lib/syntax.js').CodePart} part */
const codePart = ({ text, scope }) => (scope ? html`<span class="${scope}">${text}</span>` : text);

/**
 * A file's text, line under line, each with its number, as a diff is drawn. Its numbers are kept apart
 * from its text, so that copying the text leaves them behind.
 * @param {import('../lib/syntax.js').CodePart[][]} lines  as `codeLines` gives them
 */
const codeView = (lines) => {
  // Nothing stands between the lines: a <pre> keeps its white space.
  const drawn = lines.map(
    (parts, i) =>
      html`<span class="file-line"
        ><span class="file-number">${i + 1}</span><span class="file-text">${parts.map(codePart)}</span></span
      >`
  );
  const code = el(html`<pre class="file-code">${drawn}</pre>`);
  // The numbers are as wide as the widest of them (see chat.css).
  code.style.setProperty('--file-digits', String(String(lines.length).length));
  return code;
};

/** What is said in place of a file, or under one. @param {string} text */
const noteView = (text) => el(html`<p class="file-note">${text}</p>`);

const LISTING = 'Listing the folder’s files…';

/**
 * What the search box says of what was found: how many files.
 * @param {number} total
 */
export const foundCount = (total) => `${total.toLocaleString('en-US')} ${plural(total, 'file')}`;

/**
 * What is said under the files a search found, or in their place.
 * @param {object} found
 * @param {string} found.typed  what is in the search box
 * @param {number} found.shown  how many are listed
 * @param {number} found.total  how many it found, also past those
 * @param {number} found.searched  how many files of the folder were looked through
 * @param {boolean} found.limited  the folder has more than were listed to look through
 * @returns {string[]}
 */
export function foundNotes({ typed, shown, total, searched, limited }) {
  const more = total - shown;
  return [
    ...(total ? [] : [`No file’s name or folder has “${typed.trim()}”.`]),
    ...(more > 0 ? [`And ${more.toLocaleString('en-US')} more. Type more of the name to find fewer.`] : []),
    ...(limited ? [`Only the first ${searched.toLocaleString('en-US')} files of this folder are searched.`] : []),
  ];
}

/** No more open folders than this are kept as the window goes on from the contact: the ones opened last. */
const KEPT_FOLDERS = 200;

/**
 * What the All files tab had open inside it as the window went on from its contact, to have open again.
 * @typedef {{ open: string[], top: number }} FilesState  `open`: its folders that were open, by their path.
 *   `top`: how far it was scrolled
 */

export class Files {
  #finders = new WeakMap();
  #findFocus = new FileFindFocus();
  /** @type {Map<string, { entries: { name: string, folder: boolean }[], more: number } | { error: string }>} what each folder that was opened holds, by its path */
  #known = new Map();
  /** The folders that are open, by their path. The top one always is. */
  #open = new Set(['']);
  /** Where to scroll back to once the folders are listed and the tab is on show (see `restore`). */
  #back = null;
  /** How far the tree is scrolled, also while it is behind another tab or the files a search found. @type {() => number} */
  #scrolled;
  /** What is looked for, as fileQuery has what is in the search box; '' while the tree is on show. */
  #query = '';
  /**
   * @type {Promise<{ paths: string[], limited: boolean }> | null} every file of the folder that Git doesn't
   *   ignore, listed as a search starts and looked through for each letter typed, until the box is emptied
   */
  #every = null;
  /** How often something was typed: what is found for any but the last is dropped. */
  #searches = 0;
  /** @type {string[]} the paths of the files found, as they are listed */
  #found = [];
  /** Which of them ↓ and ↑ went to, and Enter opens; -1 for none. */
  #at = -1;

  /**
   * @param {import('./side-pane.js').SidePane} pane
   * @param {{ contactId: string, contact: { cwd: string }, web?: boolean }} ctx
   * @param {{
   *   list: (contactId: string, folder: string) => Promise<any>,
   *   all: (contactId: string) => Promise<{ paths: string[], limited: boolean }>,
   *   read: (contactId: string, file: string) => Promise<any>,
   *   open: (contactId: string, file: string, opts: { inFolder: boolean }) => Promise<void>,
   * }} files
   * @param {{ attach: (path: string) => void }} chat
   */
  constructor(pane, ctx, files, chat) {
    this.pane = pane;
    this.ctx = ctx;
    this.files = files;
    this.chat = chat;
    this.body = el(
      html`<div class="files-pane">
        ${searchBox('Search files')}
        <div class="files-tab" role="tree" aria-label="Files"></div>
        <div class="files-tab files-found" role="listbox" aria-label="Files found" hidden></div>
      </div>`
    );
    this.tree = /** @type {HTMLElement} */ (this.body.querySelector('.files-tab[role="tree"]'));
    this.found = /** @type {HTMLElement} */ (this.body.querySelector('.files-found'));
    this.search = new PaneSearch(/** @type {HTMLElement} */ (this.body.querySelector('.pane-search')), {
      typed: (typed) => this.#search(typed),
      step: (down) => this.#goTo(stepTo(this.#at, this.#found.length, down)),
      open: () => this.#at >= 0 && this.showFile(this.#found[this.#at]),
    });
    this.body.addEventListener('click', (e) => {
      const row = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.files-row'));
      if (!row) return;
      if (row.dataset.folder !== undefined) this.#toggle(row.dataset.folder);
      else this.showFile(row.dataset.file);
    });
    // A right-click on a file or folder offers what the Changes tab's does on a changed file.
    this.body.addEventListener('contextmenu', (e) => {
      const row = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.files-row'));
      if (row) this.#menu(row, e);
    });
    this.found.addEventListener('click', (e) => {
      if (/** @type {HTMLElement} */ (e.target).closest('[data-again]')) this.#search(this.search.typed);
    });
    this.#scrolled = scrolled([this.tree]);
  }

  /** ⌘F in the tab: the keyboard goes to the search box. @returns {boolean}  false while the tab is not on show */
  findList() {
    if (!this.pane.shows(TAB)) return false;
    this.search.focus();
    return true;
  }

  /** What it has open inside it, to open again when a window comes back to this contact (see `restore`). @returns {FilesState} */
  get state() {
    return { open: [...this.#open].filter(Boolean).slice(-KEPT_FOLDERS), top: this.#back ?? this.#scrolled() };
  }

  /**
   * Opens the folders it had open the last time a window showed this contact, and scrolls back to where it was,
   * as it lists them next. Call before the tab is opened.
   * @param {unknown} state  as it was kept (see `state`)
   */
  restore(state) {
    const { open, top } = /** @type {Partial<FilesState>} */ (state ?? {});
    if (Array.isArray(open)) this.#open = new Set(['', ...open.filter((path) => typeof path === 'string')]);
    this.#back = top > 0 ? top : null;
  }

  get kind() {
    return { label: 'All files', icon: smallIcon.folder(), open: () => this.show() };
  }

  /** Claims Find only for an open file, leaving list tabs and the conversation to their own handlers. */
  find(node) {
    const body = this.#findFocus.target(node, this.pane.tabs ?? []);
    return this.#finders.get(body)?.open() ?? false;
  }

  ownsFind(node) {
    return Boolean(this.#findFocus.target(node, this.pane.tabs ?? []));
  }

  rememberFindTarget(node) {
    this.#findFocus.remember(node);
  }

  /** Opens the tab, or goes to it. What it lists is read again: files come and go while a contact works. */
  show() {
    this.pane.open({
      id: TAB,
      title: 'All files',
      icon: smallIcon.folder(),
      body: this.body,
      onSelect: () => this.refresh(),
    });
    this.refresh();
  }

  /** Reads every open folder again, and while something is looked for, lists the folder's files anew to find it in. */
  async refresh() {
    if (this.#query) {
      this.#every = null;
      this.#search(this.search.typed);
    }
    await Promise.all([...this.#open].map((folder) => this.#read(folder)));
    this.#draw();
  }

  async #read(folder) {
    try {
      this.#known.set(folder, await this.files.list(this.ctx.contactId, folder));
    } catch (err) {
      this.#known.set(folder, { error: errorText(err) });
    }
  }

  async #toggle(folder) {
    if (this.#open.has(folder)) this.#open.delete(folder);
    else {
      this.#open.add(folder);
      await this.#read(folder);
    }
    this.#draw();
  }

  #draw() {
    // Behind the files a search found, the tree is not laid out, and says it is scrolled nowhere.
    const scroll = this.#query ? this.#scrolled() : this.tree.scrollTop;
    this.tree.replaceChildren(...this.#rows('', 0));
    this.tree.scrollTop = scroll;
    this.#back = scrolledBack(this.tree, this.#back);
  }

  /**
   * Finds what is typed among every file of the folder, and lists those found in place of the tree. The folder's
   * files are listed once, as a search starts. Emptied, the box has the tree back, as it was.
   * @param {string} typed
   */
  async #search(typed) {
    const search = (this.#searches += 1);
    const query = fileQuery(typed);
    if (!query) return this.#endSearch();
    // What was found stays on show while the files are listed anew: only a search that starts waits for them.
    if (!this.#query) {
      this.tree.hidden = true;
      this.found.hidden = false;
      this.found.replaceChildren(el(html`<div class="files-note">${LISTING}</div>`));
    }
    this.#query = query;
    this.#every ??= this.files.all(this.ctx.contactId);
    let every;
    try {
      every = await this.#every;
    } catch {
      if (search !== this.#searches) return;
      this.#every = null;
      this.#found = [];
      this.#at = -1;
      this.search.say('');
      this.found.replaceChildren(
        el(
          html`<div class="files-note failed">The folder’s files couldn’t be listed. <a data-again>Try again</a></div>`
        )
      );
      return;
    }
    if (search !== this.#searches) return;
    const { found, total } = searchFiles(every.paths, typed);
    this.#found = found.map((file) => file.path);
    this.#at = found.length ? 0 : -1;
    this.search.say(foundCount(total));
    const notes = foundNotes({
      typed,
      shown: found.length,
      total,
      searched: every.paths.length,
      limited: every.limited,
    });
    this.found.replaceChildren(
      ...found.map((file, i) =>
        el(
          html`<button
            class="files-row found-row ${i === this.#at ? 'active' : ''}"
            type="button"
            role="option"
            aria-selected="${i === this.#at}"
            data-file="${file.path}"
            title="${file.path}"
          >
            ${raw(picture(file.path))}<span class="tree-name"
              ><b>${markedText(file.name, file.nameMarks)}</b>${
                file.folder ? html`<span class="change-folder">${markedText(file.folder, file.folderMarks)}</span>` : ''
              }</span
            >
          </button>`
        )
      ),
      ...notes.map((note) => el(html`<div class="files-note">${note}</div>`))
    );
    this.found.scrollTop = 0;
  }

  /** The box is emptied: the tree is on show again, with the folders open that were, and scrolled as far. */
  #endSearch() {
    if (!this.#query) return;
    this.#query = '';
    this.#every = null;
    this.#found = [];
    this.#at = -1;
    this.search.say('');
    this.found.hidden = true;
    this.found.replaceChildren();
    this.tree.hidden = false;
    if (this.#back !== null) this.#back = scrolledBack(this.tree, this.#back);
    else this.tree.scrollTop = this.#scrolled();
  }

  /** Goes to one of the files found, as ↓ and ↑ do. @param {number} at */
  #goTo(at) {
    const rows = /** @type {HTMLElement[]} */ ([...this.found.querySelectorAll('.found-row')]);
    if (!rows[at]) return;
    this.#at = at;
    rows.forEach((row, i) => {
      row.classList.toggle('active', i === at);
      row.setAttribute('aria-selected', String(i === at));
    });
    rows[at].scrollIntoView({ block: 'nearest' });
  }

  /** The rows of a folder that is open, and under each folder in it that is open too, its own. */
  #rows(folder, depth) {
    const known = this.#known.get(folder);
    const indent = `padding-left: ${5 + depth * 14}px`;
    if (!known) return [];
    if ('error' in known) return [el(html`<div class="files-note failed" style="${indent}">${known.error}</div>`)];
    const rows = [];
    for (const { name, folder: isFolder } of known.entries) {
      const path = pathIn(folder, name);
      if (isFolder) {
        const open = this.#open.has(path);
        rows.push(
          el(
            html`<button
              class="files-row"
              type="button"
              role="treeitem"
              aria-expanded="${open}"
              data-folder="${path}"
              title="${path}"
              style="${indent}"
            >
              <span class="change-arrow"></span>${raw(smallIcon.folder())}<span class="tree-name">${name}</span>
            </button>`
          )
        );
        if (open) rows.push(...this.#rows(path, depth + 1));
      } else {
        // A file has no arrow, but keeps its room: its picture stands under its folder's.
        rows.push(
          el(
            html`<button
              class="files-row"
              type="button"
              role="treeitem"
              data-file="${path}"
              title="${path}"
              style="${indent}"
            >
              <span class="change-arrow"></span>${raw(picture(path))}<span class="tree-name">${name}</span>
            </button>`
          )
        );
      }
    }
    if (known.more) rows.push(el(html`<div class="files-note" style="${indent}">and ${known.more} more</div>`));
    if (!known.entries.length) rows.push(el(html`<div class="files-note" style="${indent}">Nothing in here.</div>`));
    return rows;
  }

  /** @param {HTMLElement} row  @param {MouseEvent} e */
  #menu(row, e) {
    e.preventDefault();
    const { folder, file } = row.dataset;
    const path = folder === undefined ? file : asFolder(folder);
    row.classList.add('menu-for');
    openMenu({ x: e.clientX, y: e.clientY }, this.#items(path), { onClose: () => row.classList.remove('menu-for') });
  }

  /** What a right-click on a file or folder offers. @param {string} path  from the top of the folder */
  #items(path) {
    return fileMenu(
      { path },
      { root: this.ctx.contact.cwd, reveal: this.ctx.web ? null : revealLabel(navigator.platform) },
      {
        attach: (whole) => this.chat.attach(whole),
        copy: (text) => navigator.clipboard.writeText(text),
        open: (inFolder) => this.files.open(this.ctx.contactId, path, { inFolder }),
      }
    );
  }

  /**
   * What a right-click on a link to a file of the folder offers: what one on the file here does, as
   * opening it in its app. One outside the folder, as a proof video in /tmp, can be downloaded if it is a
   * picture, a video or a sound, and a picture copied. Null for anything else outside it.
   * @param {string} file  from the top of the folder, or of the disk
   * @returns {import('../lib/menu.js').MenuItem[] | null}
   */
  linkMenu(file) {
    const path = pathFrom(this.ctx.contact.cwd, file);
    if (!/^(\/|\.\.\/)/.test(path)) return this.#items(path);
    const media = mediaItems(fileAddress(path.startsWith('/') ? path : `${this.ctx.contact.cwd}/${path}`));
    return media.length ? media : null;
  }

  /**
   * A file a link leads to: read in a tab of its own when it is text, as one clicked here is. What isn't,
   * as a video, a picture or a folder, opens as Open file opens it, in the app the computer opens it with,
   * which also says why one that is gone can't be opened. One outside the folder, named from the top of
   * the disk, opens there too, as a proof video in /tmp does, unless it would run code.
   * @param {string} file  from the top of the folder, or of the disk
   */
  async openLinked(file) {
    const path = pathFrom(this.ctx.contact.cwd, file);
    const read = await this.files.read(this.ctx.contactId, path).catch(() => null);
    if (read && !read.binary) await this.showFile(path);
    else await this.files.open(this.ctx.contactId, path, { inFolder: false });
  }

  /**
   * Opens a file in a tab of its own, as it reads right now.
   * @param {string} path
   * @param {{ top?: unknown, plain?: unknown }} [again]  as its tab was left, when a window comes back to the
   *   contact: how far it was scrolled, and whether a Markdown file was shown as its text, with Preview unticked
   */
  async showFile(path, { top, plain } = {}) {
    if (this.pane.has?.(fileTab(path))) return this.pane.select(fileTab(path));
    const markdown = isMarkdownFile(path);
    const body = el(
      markdown
        ? `<div class="file-tab">
            <div class="file-bar"><label class="preview-toggle"><input type="checkbox" checked />Preview</label></div>
            <div class="file-doc md md-doc"></div>
            <div class="file-view" hidden></div>
          </div>`
        : '<div class="file-tab"><div class="file-view"></div></div>'
    );
    const view = /** @type {HTMLElement} */ (body.querySelector('.file-view'));
    view.tabIndex = 0;
    view.setAttribute('aria-label', `${fileTitle(path)} contents`);
    const doc = /** @type {HTMLElement | null} */ (body.querySelector('.file-doc'));
    const preview = /** @type {HTMLInputElement | null} */ (body.querySelector('.preview-toggle input'));
    const showDoc = (shown) => {
      doc.hidden = !shown;
      view.hidden = shown;
    };
    const finder = new FileFind(body, view, () => {
      if (preview) {
        preview.checked = false;
        showDoc(false);
      }
    });
    this.#finders.set(body, finder);
    preview?.addEventListener('change', () => {
      finder.close(false);
      showDoc(preview.checked);
    });
    if (preview && plain === true) {
      preview.checked = false;
      showDoc(false);
    }
    /** Which of the two is on show, which is what scrolls. */
    const shown = () => (doc && !doc.hidden ? doc : view);
    const scroll = scrolled(doc ? [doc, view] : [view]);
    let back = typeof top === 'number' && top > 0 ? top : null;
    const read = async () => {
      try {
        const file = await this.files.read(this.ctx.contactId, path);
        const note = fileNote(file);
        const lines = file.binary ? null : codeLines(path, file);
        // Its text is never taken for markup: a file says whatever it likes. Markdown is drawn as a reply is, made safe.
        view.replaceChildren(...(lines ? [codeView(lines)] : []), ...(note ? [noteView(note)] : []));
        if (doc) {
          renderMarkdown(doc, file.binary ? '' : file.text);
          if (note) doc.append(noteView(note));
        }
        finder.update(lines?.map((parts) => parts.map(({ text }) => text).join('')) ?? null, file.cut);
      } catch (err) {
        view.replaceChildren(noteView(errorText(err)));
        doc?.replaceChildren(errorText(err));
        finder.update(null);
      }
      back = scrolledBack(shown(), back);
    };
    this.pane.open({
      id: fileTab(path),
      title: fileTitle(path),
      icon: picture(path),
      body,
      // Gone back to, it is read again: the contact may have changed it since.
      onSelect: read,
      onClose: () => finder.close(false),
      again: () => ({ file: path, top: back ?? scroll(), ...(preview && !preview.checked && { plain: true }) }),
    });
    await read();
  }
}
