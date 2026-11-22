// Download where what an agent shares is seen, each as it was sent or written (see media-menu.js and main/media.js):
// in a picture's corner, before Reply, while you point at the picture or Tab to it; after a link in a reply to a video
// or a sound; and under a row of two or more pictures a call handed back, Download all, to a folder you pick. A picture
// on the web is not on this computer to download, and has none.
import { basename } from '../../shared/activity-text.js';
import { isWebAddress } from '../../shared/browser.js';
import { linkedFile } from '../../shared/links.js';
import { mediaKind } from '../../shared/media.js';
import { el, html, raw } from '../lib/dom.js';
import { smallIcon } from '../lib/icons.js';
import { download, downloadAll, pictureName } from '../lib/media-menu.js';
import { sourceOf } from './conversation.js';
import { cornerOf, PICTURES, pictureIn } from './picture-reply.js';

/** The links of an agent's reply: one to a video or a sound on this computer has Download after it. */
const LINKS = '.msg.them .md a[href]';
/** A row of pictures a call handed back: under its line, or under the folded line of its run. */
const ROWS = '.tool-pictures';

/**
 * What the conversation says once Download all is done.
 * @param {{ saved: number, failed: number, folder: string }} done
 */
export function savedSays({ saved, failed, folder }) {
  const all = saved + failed;
  if (!saved) return `None of the ${all} pictures could be saved.`;
  const to = `to the “${folder}” folder.`;
  return failed
    ? `Downloaded ${saved} of ${all} pictures ${to} ${failed} could not be saved.`
    : `Downloaded ${saved} pictures ${to}`;
}

/** The elements of `node` that `selector` picks, `node` too. @param {Element} node @param {string} selector */
const within = (node, selector) => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)];

/**
 * A Download button that does `action` on its own: not the picture it is on, which would open over the window, nor
 * the link it is in. A press leaves the focus where it was, in the message box say.
 * @param {string} className
 * @param {string} label  what a screen reader calls it, and its tip unless `title` says more
 * @param {() => void} action
 * @param {{ text?: string, title?: string }} [opts]  `text`: words after its drawing
 */
function downloadButton(className, label, action, { text, title = label } = {}) {
  const button = el(
    html`<button class="${className}" type="button" title="${title}" aria-label="${label}">
      ${raw(smallIcon.download())}${text ? html`<span>${text}</span>` : ''}
    </button>`
  );
  button.addEventListener('mousedown', (e) => e.preventDefault());
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    action();
  });
  return button;
}

export class MediaDownloads {
  /**
   * @param {HTMLElement} root  the conversation: what it shows gets its buttons as it comes
   * @param {object} handlers
   * @param {((file: string) => string) | null} handlers.fileAddress  the file: address of a file a link leads to, by
   *   its path from the contact's folder or from the top of the disk. Null where there are no files, as in the
   *   browser preview
   * @param {(text: string) => void} handlers.notice  says in the conversation how Download all went
   */
  constructor(root, { fileAddress, notice }) {
    this.fileAddress = fileAddress;
    this.notice = notice;
    // A reply draws its pictures and links again as it comes in, and a run's row as its calls hand back more.
    new MutationObserver((changes) => this.#offer(changes.flatMap(({ addedNodes }) => [...addedNodes]))).observe(root, {
      childList: true,
      subtree: true,
    });
    this.#offer([root]);
  }

  /** @param {any[]} nodes  what was added */
  #offer(nodes) {
    const rows = new Set();
    for (const node of nodes) {
      if (!node.querySelectorAll) continue;
      for (const img of within(node, PICTURES)) this.#onPicture(img);
      if (this.fileAddress) for (const link of within(node, LINKS)) this.#afterLink(link);
      // What was added to a row, as its thumbnails drawn again, has it say how many it has now.
      for (const row of [node.closest(ROWS), ...within(node, ROWS)]) if (row) rows.add(row);
    }
    for (const row of rows) this.#underRow(row);
  }

  /** @param {HTMLImageElement} img */
  #onPicture(img) {
    if (!pictureIn(img) || isWebAddress(img.src)) return;
    const corner = cornerOf(img);
    if (corner.querySelector('.picture-download')) return;
    corner.prepend(
      downloadButton('picture-download', 'Download picture', () => download(sourceOf(img), pictureName(img)))
    );
  }

  /** @param {HTMLAnchorElement} link */
  #afterLink(link) {
    if (link.nextElementSibling?.classList.contains('link-download')) return;
    const file = linkedFile(link.getAttribute('href'));
    if (!file || !['video', 'audio'].includes(mediaKind(file))) return;
    link.after(downloadButton('link-download', `Download ${basename(file)}`, () => download(this.fileAddress(file))));
  }

  /**
   * Download all, right under a row of two or more pictures, saying how many: hidden with the row, as the folded
   * line's is while its calls are on show. Drawn again only when that changes.
   * @param {HTMLElement} row
   */
  #underRow(row) {
    const count = row.querySelectorAll('.tool-picture img').length;
    const next = row.nextElementSibling;
    const foot = next?.classList.contains('tool-pictures-all') ? next : null;
    if (foot?.dataset.count === String(count)) return;
    foot?.remove();
    if (count < 2) return;
    const all = el(html`<div class="tool-pictures-all" data-count="${count}"></div>`);
    all.append(
      downloadButton('pictures-download', `Download all ${count} pictures`, () => void this.#downloadAll(row), {
        text: `Download all ${count}`,
        title: `Download all ${count} pictures to a folder you pick`,
      })
    );
    row.after(all);
  }

  /** Each picture of the row, under its name, in a folder asked for once; the conversation says how it went. */
  async #downloadAll(row) {
    const pictures = [...row.querySelectorAll('.tool-picture img')].map((img) => ({
      address: sourceOf(img),
      name: pictureName(img),
    }));
    const done = await downloadAll(pictures);
    if (done) this.notice(savedSays(done));
  }
}
