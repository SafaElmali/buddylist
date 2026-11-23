// What a reply shows of a picture it can't show: a card in its place, with what the reply calls it, where it is and
// why it isn't shown, and Open link to see one on the web in your browser. A picture on GitHub is asked of the app
// (load) and shown once it came: one of the conversation's own repository by itself, one of another once Load with
// GitHub is pressed. See shared/web-pictures.js. The phone shows its GitHub pictures in tiles (see phone/transcript.js)
// and the same card.
import { el, html, raw } from './dom.js';
import { basename } from '../../shared/activity-text.js';
import { githubPicture, isWebPicture, NOT_SHOWN, onGithubHost } from '../../shared/web-pictures.js';

/** A picture in a frame: a hill and the sun. */
const ICON =
  '<svg class="picture-card-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="5.5" cy="6" r="1.3" fill="currentColor"/><path d="M2 12.2l3.8-3.6 2.6 2.4 2.2-1.9 3.4 3.1" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';

/**
 * What a reply's GitHub picture came to: the picture as a data: address and its file's name, or why not (see
 * windowAnswer in main/github-pictures.js).
 * @typedef {{ picture: string, name: string } | { problem: import('../../shared/web-pictures.js').NotShown }} Answer
 */

/** @typedef {(address: string, asked: boolean) => Promise<Answer>} Load */

/** The site a picture on the web is on, as "cdn.example.com"; '' for anything else. */
function hostOf(address) {
  if (!isWebPicture(address)) return '';
  try {
    return new URL(address).host;
  } catch {
    return '';
  }
}

/** A picture's name: what its reply calls it, else its file's. */
function nameOf(alt, address) {
  if (alt.trim()) return alt.trim();
  try {
    return decodeURIComponent(basename(new URL(address).pathname)) || 'Picture';
  } catch {
    return 'Picture';
  }
}

/**
 * A card in place of a reply's picture that isn't shown.
 * @param {object} opts
 * @param {string} opts.alt  what the reply calls it
 * @param {string} opts.address  where it is: one on the web has Open link
 * @param {import('../../shared/web-pictures.js').NotShown} opts.reason
 * @param {boolean} [opts.inLink]  it is in a link, which goes where that does: no Open link of its own
 * @param {(() => void) | null} [opts.onLoad]  what Load with GitHub does; none without it
 */
export function pictureCard({ alt, address, reason, inLink = false, onLoad = null }) {
  const name = nameOf(alt, address);
  const why = NOT_SHOWN[reason];
  const host = hostOf(address);
  const open = Boolean(host) && !inLink;
  const card = el(
    html`<span class="picture-card" role="group" aria-label="Picture: ${name}. ${why}"
      >${raw(ICON)}<span class="picture-card-words"
        ><span class="picture-card-alt">${name}</span
        ><span class="picture-card-why">${host ? `${why} · ${host}` : why}</span></span
      >${
        onLoad || open
          ? html`<span class="picture-card-actions"
              >${onLoad ? html`<button class="btn picture-card-load" type="button">Load with GitHub</button>` : ''}${
                open ? html`<a class="picture-card-open" href="${address}">Open link</a>` : ''
              }</span
            >`
          : ''
      }</span
    >`
  );
  if (onLoad) card.querySelector('.picture-card-load').addEventListener('click', onLoad);
  return card;
}

/** Reasons that may pass: a picture that couldn't load for one of them is asked for again when it is drawn again. */
const PASSING = new Set(['offline', 'slow']);

/** What each conversation's GitHub pictures came to, or are coming to, by address: by its `load`, while it is open. */
const answers = new WeakMap();

/**
 * What a GitHub picture comes to: what it came to before, or is coming to, unless that may have passed (offline);
 * else asked anew. Load with GitHub always asks anew.
 * @param {Load} load
 * @param {string} address
 * @param {boolean} asked  Load with GitHub was pressed
 * @returns {Promise<Answer>}
 */
function answerFor(load, address, asked) {
  const kept = answers.get(load) ?? answers.set(load, new Map()).get(load);
  if (!asked && kept.has(address)) return Promise.resolve(kept.get(address));
  const answer = Promise.resolve()
    .then(() => load(address, asked))
    .catch(() => /** @type {Answer} */ ({ problem: 'not-found' }))
    .then((said) => {
      if ('problem' in said && PASSING.has(said.problem)) kept.delete(address);
      else kept.set(address, said);
      return said;
    });
  kept.set(address, answer);
  return answer;
}

/** What a GitHub picture came to already, to show at once; null while it is still coming, or never asked. */
function cameTo(load, address) {
  const said = answers.get(load)?.get(address);
  return said && !(said instanceof Promise) ? said : null;
}

/**
 * A GitHub picture where its card was, or the card it comes to.
 * @param {Element} at  what it takes the place of
 * @param {Answer} said
 * @param {{ alt: string, address: string, inLink: boolean, load: Load }} picture
 */
function show(at, said, picture) {
  if (!at.parentElement) return;
  if ('picture' in said) {
    const img = el(html`<img alt="${picture.alt}" />`);
    img.setAttribute('src', said.picture);
    img.dataset.name = said.name;
    at.replaceWith(img);
    return;
  }
  const { alt, address, inLink, load } = picture;
  const onLoad =
    said.problem === 'ask'
      ? () => {
          const waiting = pictureCard({ alt, address, inLink, reason: 'loading' });
          card.replaceWith(waiting);
          answerFor(load, address, true).then((answer) => show(waiting, answer, picture));
        }
      : null;
  const card = pictureCard({ alt, address, inLink, reason: said.problem, onLoad });
  at.replaceWith(card);
}

/** The pictures of files already watched for not being there. */
const watched = new WeakSet();

/**
 * How a Markdown's GitHub pictures are shown: asked of the app (`load`), as a conversation window does, or put in
 * place by `github`, as the phone does with a tile of its own (see phone/transcript.js). With neither, as in a file a
 * tab shows, one is a card like any picture on the web.
 * @typedef {{ load?: Load | null, github?: ((address: string, alt: string) => Element) | null }} PictureWays
 */

/**
 * Has a Markdown's pictures that can't be shown say so, each in a card in its place (see pictureCard), as it is drawn:
 * one on the web (`data-web`, see placeSources in markdown.js), one on another computer (`data-not-shown`), and a file
 * that turns out not to be there. One on GitHub is shown as `ways` says. Drawn again, as a reply that is still arriving
 * is, a picture that came is there at once.
 * @param {ParentNode} root  the Markdown, as it was drawn
 * @param {PictureWays} [ways]
 */
export function showReplyPictures(root, { load = null, github = null } = {}) {
  for (const img of root.querySelectorAll('img')) {
    if (img.classList.contains('emoticon')) continue;
    const alt = img.getAttribute('alt') ?? '';
    const address = img.getAttribute('data-web');
    if (img.hasAttribute('data-not-shown')) img.replaceWith(pictureCard({ alt, address: '', reason: 'elsewhere' }));
    else if (address !== null) {
      const picture = { alt, address, inLink: Boolean(img.closest('a[href]')), load };
      const onGithub = Boolean(githubPicture(address));
      if (onGithub && github) img.replaceWith(github(address, alt));
      // One gh can't read, as an uploaded attachment, opens in your browser, where you are signed in to GitHub.
      else if (!onGithub || !load)
        img.replaceWith(pictureCard({ ...picture, reason: onGithubHost(address) ? 'github' : 'web' }));
      else if (cameTo(load, address)) show(img, /** @type {Answer} */ (cameTo(load, address)), picture);
      else {
        const waiting = pictureCard({ ...picture, reason: 'loading' });
        img.replaceWith(waiting);
        answerFor(load, address, false).then((said) => show(waiting, said, picture));
      }
    } else if (/^file:/i.test(img.getAttribute('src') ?? '') && !watched.has(img)) {
      watched.add(img);
      img.addEventListener('error', () =>
        (img.closest('.picture-reply-at') ?? img).replaceWith(pictureCard({ alt, address: '', reason: 'gone' }))
      );
    }
  }
}
