// Web addresses in plain text. What you type is never read as markup, so the
// addresses in it are found here, for the window to draw each one as a link.
// And the files on this computer that links in a reply lead to.

const ADDRESS = /\b(https?:\/\/)[^\s<>"]+/gi;
// What ends the sentence an address is in, not the address: "see https://example.com."
const ENDS_A_SENTENCE = /[.,;:!?'*_~]/;
const OPENED_BY = { ')': '(', ']': '[', '}': '{' };

const count = (text, char) => text.split(char).length - 1;

/** An address without what was written around it: "(https://example.com)." is "https://example.com". */
function address(written) {
  let url = written;
  for (;;) {
    const last = url.at(-1);
    const opener = OPENED_BY[last];
    // A bracket the address opened itself is its own: https://en.wikipedia.org/wiki/Luna_(theme)
    const closesNothing = opener && count(url, last) > count(url, opener);
    if (!ENDS_A_SENTENCE.test(last) && !closesNothing) return url;
    url = url.slice(0, -1);
  }
}

/**
 * Where a text has web addresses, in order.
 * @param {string} text
 * @returns {{ start: number, end: number }[]}
 */
export function linkRanges(text) {
  const ranges = [];
  for (const match of text.matchAll(ADDRESS)) {
    const url = address(match[0]);
    // "https://" with nothing behind it leads nowhere.
    if (url.length > match[1].length) ranges.push({ start: match.index, end: match.index + url.length });
  }
  return ranges;
}

// "https:", "mailto:", "javascript:". Not "app.js:12": a line number follows that colon.
const SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;
// The line a link points at in its file: "app.js:12", "app.js:12:5", "app.js#L12-L20".
const LINE = /(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$/i;

/**
 * The file a link in a reply leads to: an agent links one by its path, from the top
 * (/Users/me/proof.mp4) or from its folder (src/app.js). The line it points at is left off,
 * and the file opens whole.
 * @param {string | null} href  the link's href as written, not the address the page made of it
 * @returns {string | null}  null for a web page, an e-mail address, or a place on the page
 */
export function linkedFile(href) {
  const written = String(href ?? '').trim();
  // "#top" and "?page=2" are places on the page, and "//example.com" is a site.
  if (!written || /^([#?]|\/\/)/.test(written) || SCHEME.test(written)) return null;
  return unescaped(written).replace(LINE, '');
}

// From the top of a Windows disk: "C:\shots", "C:/shots".
const DRIVE = /^[a-z]:[\\/]/i;

/**
 * Where a picture in a reply is, as the window is to load it. One named by its path from the contact's folder
 * (shots/c.png, ./docs/shot.png, ../shot.png) is in that folder, not beside the window's own page, where the page
 * would look for it. One from the top of a Windows disk (C:\shots\c.png) is a file: address too, which the page
 * would take for one of a site called "C:". A web address, a data: picture or a path from the top (/tmp/shot.png)
 * is loaded as it was written. One on another computer is not loaded at all (see onAnotherComputer), and a path
 * written as a Windows share's (\\server\share\c.png) is one.
 * @param {string} src  as the reply wrote it, escaped as Markdown escapes it: "My%20Shot.png"
 * @param {string} [folder]  the contact's. Without it, a picture named from a folder is left as it was written
 * @returns {string | null}  null for one not to load
 */
export function pictureAddress(src, folder) {
  const written = String(src ?? '').trim();
  const path = unescaped(written);
  if (/^[\\/]{2}/.test(path)) return null;
  const address = DRIVE.test(path) ? fileAddress(path) : (fromFolder(written, folder) ?? src);
  return onAnotherComputer(address) ? null : address;
}

/** A picture's address from the contact's folder, or null for one not named from a folder. */
function fromFolder(written, folder) {
  if (!folder || !written || /^[#?]/.test(written) || SCHEME.test(written)) return null;
  try {
    return new URL(written, fileAddress(`${folder.replace(/[\\/]+$/, '')}/`)).href;
  } catch {
    return null;
  }
}

/**
 * Whether the window would load an address from another computer. Its page is a file: one, so it reads
 * "//server/a.png", "\\server\a.png" and "file://server/a.png" all as a file on a computer called "server", and on
 * Windows it would fetch that from the network share, saying who you are to whatever computer a reply names. A
 * reply can be steered by what the agent read, and a picture loads with no click, so nothing is loaded from one.
 * A web address is loaded from a site as ever, and one the window can't read is not loaded at all.
 * @param {string | null | undefined} address  as written, or as made from the contact's folder
 */
export function onAnotherComputer(address) {
  let url;
  try {
    url = new URL(String(address ?? ''), 'file:///');
  } catch {
    return true;
  }
  return url.protocol === 'file:' && (url.host !== '' || /^[\\/]{2}/.test(unescapedAll(url.pathname)));
}

/**
 * A path on this computer as a file: address, each of its names escaped: "C:\My Shots\c.png" is
 * "file:///C:/My%20Shots/c.png".
 * @param {string} path  from the top: its first name is a Windows disk's, or nothing
 */
export function fileAddress(path) {
  const slashed = DRIVE.test(path) ? path.replace(/\\/g, '/') : path;
  const escaped = slashed
    .split('/')
    .map((name, i) => (i ? encodeURIComponent(name) : name))
    .join('/');
  return escaped.startsWith('/') ? `file://${escaped}` : `file:///${escaped}`;
}

/** A path with every escape undone, "%5C" and "%2F" too: what Windows reads it as. */
function unescapedAll(path) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** A path as it was before Markdown escaped what an address can't hold, as a space: "My%20Proof.mp4". */
function unescaped(path) {
  try {
    return decodeURI(path);
  } catch {
    // A % that escapes nothing stays: "100%.txt".
    return path;
  }
}
