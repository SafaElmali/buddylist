// The pictures a reply shows from the web. No window loads one by itself: that would let any reply, which what the
// agent read can steer, reach any site with no click. Each is a card that says what it is and opens it in your
// browser (see renderer/lib/reply-pictures.js). One in a GitHub repository is read through the GitHub CLI instead:
// by itself in the conversation's own repository, else once you ask (see main/github-pictures.js).

/** Whether a picture's address is on the web. @param {unknown} address */
export const isWebPicture = (address) => /^https?:\/\//i.test(String(address ?? '').trim());

/** An owner's or a repository's name, as GitHub has them. */
const NAME = /^[\w.-]+$/;

/**
 * A picture in a GitHub repository, as an agent links one: its page (github.com/…/blob/…), its file
 * (github.com/…/raw/…) or raw.githubusercontent.com. On github.com only, by https, with no sign-in or port of its own.
 * @param {unknown} address
 * @returns {{ repository: string, rest: string[] } | null}  "owner/name", and the names after it: its branch, tag or
 *   commit and then the file's path, whose slashes can't be told apart from a branch's
 */
export function githubPicture(address) {
  let url;
  try {
    url = new URL(String(address ?? ''));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  let names;
  try {
    names = url.pathname.slice(1).split('/').map(decodeURIComponent);
  } catch {
    return null;
  }
  if (names.some((name) => ['', '.', '..'].includes(name) || name.includes('/'))) return null;
  const host = url.hostname.toLowerCase();
  const [owner, repo, ...after] = names;
  let rest = null;
  if (host === 'github.com' && ['blob', 'raw'].includes(after[0])) rest = after.slice(1);
  else if (host === 'raw.githubusercontent.com') rest = after;
  if (!rest || rest.length < 2 || !NAME.test(owner ?? '') || !NAME.test(repo ?? '')) return null;
  return { repository: `${owner}/${repo}`, rest };
}

/**
 * Why a reply's picture isn't shown, as its card says it (see reply-pictures.js), by its reason. The phone hears the
 * reason as an error's words (see reasonOf). A plain object, so the main process, which needs none of the words, is
 * built without them.
 */
export const NOT_SHOWN = {
  web: 'Couldn’t load: pictures on the web open in your browser',
  loading: 'Loading from GitHub…',
  ask: 'Couldn’t load: it needs a GitHub sign-in',
  'signed-out': 'Couldn’t load: the GitHub CLI isn’t signed in',
  missing: 'Couldn’t load: it needs the GitHub CLI',
  offline: 'Couldn’t load: GitHub can’t be reached',
  slow: 'Couldn’t load: GitHub took too long',
  'not-found': 'Couldn’t load: GitHub has no such picture you can see',
  refused: 'Couldn’t load: GitHub refused it',
  'not-picture': 'Couldn’t load: it isn’t a picture',
  'too-big': 'Couldn’t load: it’s too big',
  'not-here': 'Couldn’t load: it isn’t in this conversation',
  gone: 'Couldn’t load: the file isn’t there',
  elsewhere: 'Not loaded: it’s on another computer',
};

/** @typedef {keyof typeof NOT_SHOWN} NotShown */

/**
 * The reason an error is, as the Mac gives it (see main/github-pictures.js); null for any other error, such as a lost
 * connection.
 * @param {unknown} said  an error's message
 * @returns {NotShown | null}
 */
export const reasonOf = (said) =>
  typeof said === 'string' && Object.hasOwn(NOT_SHOWN, said) ? /** @type {NotShown} */ (said) : null;
