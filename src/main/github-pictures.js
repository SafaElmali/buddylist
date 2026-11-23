// A picture a reply shows from a GitHub repository, read through the GitHub CLI: in the conversation's own repository
// by itself, in another only once the user asks (Load with GitHub). Only github.com is asked, only for a file of a
// repository, and only for one a reply of the conversation shows. Its sign-in stays in gh: nothing here reads it, and a
// window or a phone is given the picture's bytes or why not, never what gh said. See shared/web-pictures.js.
import os from 'node:os';
import { sameRepository } from '../shared/github-item.js';
import { repositoryPage } from '../shared/pull-request-button.js';
import { githubPicture, isWebPicture } from '../shared/web-pictures.js';
import { ghProblem, runGh } from './github-lookup.js';
import { FULL_MOST_BYTES, pictureType, repliesOf, showsAddress } from './remote/pictures.js';
import { git as gitIn } from './worktrees.js';

/** How long gh gets to answer for one: a big picture takes a while. */
const TIMEOUT_MS = 30 * 1000;
/** How many places a file's path may start are tried, for a branch with slashes in its name. */
const MOST_TRIES = 4;

/** @typedef {import('../shared/web-pictures.js').NotShown} NotShown */
/** @typedef {{ bytes: Buffer, type: string, name: string }} GithubPicture */

/** Why a picture isn't given: its reason, which a phone hears as the error's words (see reasonOf). @param {NotShown} reason */
const problem = (reason) => Object.assign(new Error(reason), { reason });

/**
 * The repository a folder is on github.com, as "owner/name", by its origin; null for none, or one on another host.
 * @param {string} folder
 * @param {{ run?: (cwd: string, args: string[]) => Promise<string> }} [opts]  a stand-in for git in tests
 */
export async function ownRepository(folder, { run = gitIn } = {}) {
  if (!folder) return null;
  const page = repositoryPage(await run(folder, ['remote', 'get-url', 'origin']).catch(() => ''));
  const [, owner, name] = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i.exec(page ?? '') ?? [];
  return owner ? `${owner}/${name}` : null;
}

/** Why gh gave no picture, from how it gave up. */
function reasonFor(error) {
  if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'too-big';
  const said = String(error?.stderr ?? '');
  if (/HTTP 401/.test(said)) return 'signed-out';
  if (/HTTP 403/.test(said)) return 'refused';
  return ghProblem(error) ?? 'not-found';
}

/**
 * A picture of a GitHub repository, read through gh from github.com as the file it is. One of another repository than
 * the folder's is read only when `asked`.
 * @param {string} address  as the reply wrote it
 * @param {object} opts
 * @param {string} opts.folder  the conversation's: its origin is its own repository
 * @param {boolean} [opts.asked]  the user asked for it: Load with GitHub
 * @param {typeof runGh} [opts.gh]  stand-ins for gh and git in tests
 * @param {(cwd: string, args: string[]) => Promise<string>} [opts.git]
 * @returns {Promise<GithubPicture>}  rejects with the `reason` it couldn't be read for
 */
export async function loadGithubPicture(address, { folder, asked = false, gh = runGh, git = gitIn }) {
  const picture = githubPicture(address);
  if (!picture) throw problem(isWebPicture(address) ? 'web' : 'not-here');
  if (!asked) {
    const own = await ownRepository(folder, { run: git });
    if (!own || !sameRepository(own, picture.repository)) throw problem('ask');
  }
  const { rest } = picture;
  for (let at = 1; at < rest.length && at <= MOST_TRIES; at += 1) {
    const ref = rest.slice(0, at).join('/');
    const path = rest.slice(at);
    let bytes;
    try {
      bytes = await gh(
        os.homedir(),
        [
          'api',
          '--hostname',
          'github.com',
          '-H',
          'Accept: application/vnd.github.raw',
          `repos/${picture.repository}/contents/${path.map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
        ],
        TIMEOUT_MS,
        // No bigger than a phone opens whole.
        { encoding: 'buffer', maxBuffer: FULL_MOST_BYTES }
      );
    } catch (error) {
      // Not there with this much of it as the branch: maybe with more.
      if (/HTTP 404/.test(String(error?.stderr ?? ''))) continue;
      throw problem(reasonFor(error));
    }
    const type = pictureType(bytes);
    if (!type) throw problem('not-picture');
    return { bytes, type, name: /** @type {string} */ (path.at(-1)) };
  }
  throw problem('not-found');
}

/**
 * A conversation's GitHub pictures: only one a reply of it shows, those still arriving too.
 * @param {object} deps
 * @param {(contactId: string) => { kind: string, text?: unknown }[]} deps.history  a conversation's entries
 * @param {(contactId: string) => string[]} deps.live  its replies still arriving
 * @param {(contactId: string) => string | null} deps.folderOf  the contact's folder, null for one not there
 * @param {typeof loadGithubPicture} [deps.load]
 * @returns {(contactId: string, address: string, options: { asked?: boolean }) => Promise<GithubPicture>}
 */
export function githubPictures({ history, live, folderOf, load = loadGithubPicture }) {
  return async (contactId, address, { asked = false }) => {
    const folder = folderOf(contactId);
    if (folder === null || !showsAddress(repliesOf(history(contactId), live(contactId)), address))
      throw problem('not-here');
    return load(address, { folder, asked });
  };
}

/**
 * What a conversation window is answered for a GitHub picture: the picture as a data: address with its file's name,
 * or the reason it isn't shown. Nothing else gh said reaches the window.
 * @param {(contactId: string, address: string, options: { asked?: boolean }) => Promise<GithubPicture>} picture
 * @returns {(contactId: unknown, address: unknown, asked: unknown) => Promise<{ picture: string, name: string } | { problem: NotShown }>}
 */
export const windowAnswer = (picture) => async (contactId, address, asked) => {
  try {
    const { bytes, type, name } = await picture(String(contactId), String(address), { asked: asked === true });
    return { picture: `data:${type};base64,${bytes.toString('base64')}`, name };
  } catch (error) {
    return { problem: error?.reason ?? 'not-found' };
  }
};
