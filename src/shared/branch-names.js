// A new contact's branch starts out named after its project and a number, so
// adding a contact takes no typing and its name says which project it works on.
// The first thing the contact is asked to do then names the branch after the work,
// and the nickname made up from the branch follows it there.
// The user can still type a name of their own over it, and a prefix for all of them.

/** The words of a title or a message that go into a branch name: enough to tell branches apart at a glance. */
const WORDS_LIMIT = 40;
/** The prefix field takes this many characters. */
export const BRANCH_PREFIX_MAX = 40;

// Letters that are not a plain one with a mark on it, and the plain ones they are written as.
const PLAIN = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', þ: 'th', ł: 'l', ı: 'i' };
// What starts a message that is a command for the agent, such as "/review", and no task to name a branch after.
const COMMAND = /^\/[\w:.-]+(?:\s|$)/;
const LINK = /\bhttps?:\/\/\S+/gi;

/**
 * Words as a branch can carry them: "My Shop" becomes "my-shop", and "Mağaza Önü" becomes
 * "magaza-onu". Only plain letters and numbers are kept, so that every shell, address and
 * check a branch name ends up in can carry it too.
 * @param {unknown} text
 * @returns {string}  '' when there is no letter or number in it that can be written plainly
 */
export const branchWords = (text) =>
  String(text ?? '')
    // A letter with a mark on it comes apart into the letter and its mark.
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}+/gu, '')
    .replace(/[ßæœøđðþłı]/g, (letter) => PLAIN[letter])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Words as a branch can carry them, cut at a word when there are too many of them.
 * @param {unknown} text
 * @returns {string}
 */
export function shortBranchWords(text) {
  const words = branchWords(text);
  if (words.length <= WORDS_LIMIT) return words;
  const kept = words.slice(0, WORDS_LIMIT + 1);
  const dash = kept.lastIndexOf('-');
  return dash > 0 ? kept.slice(0, dash) : words.slice(0, WORDS_LIMIT);
}

/**
 * What the user wants in front of the branches made here, as a branch can carry it:
 * " Safa / Feature " becomes "safa/feature".
 * @param {unknown} text  what was typed for it
 * @returns {string}  '' for no prefix
 */
export const branchPrefix = (text) =>
  String(text ?? '')
    .slice(0, BRANCH_PREFIX_MAX)
    .split('/')
    .map(branchWords)
    .filter(Boolean)
    .join('/');

/**
 * A name under the user's prefix, if they have one.
 * @param {string} prefix  as `branchPrefix` gives it
 * @param {string} name
 */
export const prefixed = (prefix, name) => (prefix ? `${prefix}/${name}` : name);

/** A branch's name without the user's prefix: the part that tells it from their other branches. */
export const withoutPrefix = (prefix, branch) =>
  prefix && branch.startsWith(`${prefix}/`) ? branch.slice(prefix.length + 1) : branch;

/**
 * The nickname made up for a contact: its service, and what tells it from the user's other
 * contacts on that service, such as its branch. "Claude (shop-2)".
 * @param {string} service  the service's name
 * @param {string} [detail]
 */
export const madeUpNickname = (service, detail) => (detail ? `${service} (${detail})` : service);

/**
 * The nickname a contact gets as its branch is named after its work, when the one it has was
 * made up from the branch's first name: "Claude (shop-2)" becomes "Claude (fix-the-login-redirect)".
 * @param {string} nickname  the one it has
 * @param {string} service  its service's name
 * @param {{ from: string, name: string, prefix?: string }} branch  the name made up for the branch,
 *   the one it has now, and the user's prefix as `branchPrefix` gives it
 * @returns {string | null}  null for a nickname that says something else, which was typed or
 *   comes from an issue: that one is kept
 */
export function followedNickname(nickname, service, { from, name, prefix = '' }) {
  // Whatever prefix the first name was made under, it is some of the folders in front of it.
  const folders = String(from ?? '').split('/');
  const madeUp = folders.some((_, at) => nickname === madeUpNickname(service, folders.slice(at).join('/')));
  if (!madeUp) return null;
  const followed = madeUpNickname(service, withoutPrefix(prefix, name));
  return followed === nickname ? null : followed;
}

/**
 * The nickname a contact gets as an agent on another service answers as it, when the one it has was
 * made up from its service's name: "Codex (shop-2)" becomes "Claude (shop-2)".
 * @param {string} nickname  the one it has
 * @param {string} from  the service it was on
 * @param {string} to  the one it is on now
 * @returns {string | null}  null for a nickname that says something else, which was typed: that one is kept
 */
export function nicknameOnService(nickname, from, to) {
  if (from === to) return null;
  if (nickname === from) return to;
  const detail = nickname.startsWith(`${from} (`) && nickname.endsWith(')') && nickname.slice(from.length + 2, -1);
  return detail ? madeUpNickname(to, detail) : null;
}

/** A project's name as a branch can carry it. */
const slug = (project) => branchWords(project) || 'contact';

/**
 * A branch name nothing uses yet: the project's name with the lowest number that is free.
 * @param {string} project  the project's name, as its folder is called
 * @param {(name: string) => boolean} taken  whether a name is in use
 * @param {string} [prefix]  as `branchPrefix` gives it
 * @returns {string}
 */
export function freeBranchName(project, taken, prefix = '') {
  const name = prefixed(prefix, slug(project));
  for (let number = 1; ; number++) {
    if (!taken(`${name}-${number}`)) return `${name}-${number}`;
  }
}

/**
 * The words of the first thing a contact is asked to do that its branch is named after:
 * those of the first line that has any, without its links.
 * @param {unknown} message
 * @returns {string}  '' when the message names no task: a command, a link on its own, or a single
 *   word such as "hi"
 */
export function taskWords(message) {
  const text = String(message ?? '').trim();
  if (COMMAND.test(text)) return '';
  for (const line of text.split(/\r?\n/)) {
    const words = shortBranchWords(line.replace(LINK, ' '));
    // One word says too little about the work to be worth a name.
    if (words) return words.includes('-') ? words : '';
  }
  return '';
}

/**
 * A branch name for a task that nothing uses yet: its words, with a number only when
 * they are taken.
 * @param {string} words  as `taskWords` gives them
 * @param {(name: string) => boolean} taken  whether a name is in use
 * @param {string} [prefix]  as `branchPrefix` gives it
 * @returns {string}
 */
export function taskBranchName(words, taken, prefix = '') {
  const name = prefixed(prefix, words);
  if (!taken(name)) return name;
  for (let number = 2; ; number++) {
    if (!taken(`${name}-${number}`)) return `${name}-${number}`;
  }
}
