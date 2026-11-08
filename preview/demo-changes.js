// What the Changes tab shows in the browser preview. There is no git here, so
// the example folders have a few made-up files that changed, each with a
// made-up diff, and a file a scripted agent edited while you watched joins them.
// The contact card counts the same files (see host.js). One folder's branch has
// made-up commits too, each with files of its own, for the tab to list one by one.
import { mayGoOn } from '../src/renderer/chat/diff-view.js';
import { UNCOMMITTED } from '../src/shared/changes.js';
import { cutOff, lineNumbers, parseDiff } from '../src/shared/unified-diff.js';

/**
 * @typedef {Object} DemoChange
 * @property {string} path
 * @property {string} [from]      where it was, for a renamed file
 * @property {'modified' | 'new' | 'deleted' | 'renamed' | 'conflicted'} status
 * @property {boolean} [untracked]
 * @property {boolean} [binary]
 * @property {string} [diff]      its hunks, as git prints them
 */

const hunks = (...lines) => `${lines.join('\n')}\n`;

/** A lockfile that took in a package and everything it needs: more lines than the tab shows of one diff. */
function lockfileDiff() {
  const added = [];
  for (let i = 1; i <= 434; i += 1) {
    const name = `retry-helper-${String(i).padStart(3, '0')}`;
    added.push(
      `+    "node_modules/${name}": {`,
      '+      "version": "2.1.0",',
      `+      "resolved": "https://registry.npmjs.org/${name}/-/${name}-2.1.0.tgz",`,
      '+      "license": "MIT",',
      '+      "engines": { "node": ">=20" }',
      '+    },'
    );
  }
  return hunks(
    `@@ -1204,6 +1204,${added.length + 6} @@`,
    '       "license": "MIT"',
    '     },',
    '     "node_modules/p-limit": {',
    ...added,
    '       "version": "6.2.0",',
    '       "resolved": "https://registry.npmjs.org/p-limit/-/p-limit-6.2.0.tgz",',
    '       "license": "MIT"'
  );
}

/** @type {Record<string, DemoChange[]>} by the name of the example folder, each in the order the tab lists them */
export const DEMO_CHANGES = {
  buddylist: [
    {
      path: 'src/renderer/contacts/hover-card.js',
      status: 'new',
      untracked: true,
      diff: hunks(
        '@@ -0,0 +1,14 @@',
        '+// What the contact list shows when you hover a contact.',
        "+import { el, html } from '../lib/dom.js';",
        "+import { timeAgo } from '../lib/format.js';",
        '+',
        '+/** @param {{ branch: string, changes: number, lastActivity: number }} card */',
        '+export function hoverCard(card) {',
        '+  return el(',
        '+    html`<div class="hover-card">',
        '+      <div class="card-branch">${card.branch}</div>',
        '+      <div class="card-changes">${card.changes} uncommitted</div>',
        '+      <div class="card-seen">Active ${timeAgo(card.lastActivity)}</div>',
        '+    </div>`',
        '+  );',
        '+}'
      ),
    },
    {
      path: 'src/renderer/contacts/main.js',
      status: 'modified',
      diff: hunks(
        '@@ -3,6 +3,7 @@',
        " import { $, el } from '../lib/dom.js';",
        " import { mountFrame } from '../lib/frame.js';",
        " import { openMenu } from '../lib/menu.js';",
        "+import { hoverCard } from './hover-card.js';",
        " import { renderContacts } from './list.js';",
        ' ',
        ' const state = { contacts: [], groups: [] };',
        '@@ -41,7 +42,11 @@ function mountList() {',
        "   const list = $('#contacts');",
        "   list.addEventListener('dblclick', (e) => openChat(contactOf(e)));",
        "   list.addEventListener('contextmenu', (e) => openContactMenu(e));",
        "-  list.addEventListener('mouseover', (e) => showTitle(contactOf(e)));",
        "+  list.addEventListener('mouseover', async (e) => {",
        '+    const contact = contactOf(e);',
        '+    if (!contact) return;',
        '+    showCard(contact, hoverCard(await api.contacts.card(contact.id)));',
        '+  });',
        ' }',
        ' ',
        ' function openChat(contact) {'
      ),
    },
    {
      path: 'src/renderer/styles/contacts.css',
      status: 'modified',
      diff: hunks(
        '@@ -212,3 +212,16 @@',
        '   color: var(--muted);',
        '   font-style: italic;',
        ' }',
        '+',
        '+/* The card that comes up when the mouse rests on a contact. */',
        '+.hover-card {',
        '+  padding: 7px 9px;',
        '+  border: 1px solid var(--pane-border);',
        '+  border-radius: 3px;',
        '+  background: linear-gradient(180deg, #ffffff 0%, #eef4fc 100%);',
        '+  box-shadow: 2px 2px 4px rgba(0, 0, 0, 0.25);',
        '+}',
        '+',
        '+.card-branch {',
        '+  font-weight: bold;',
        '+}'
      ),
    },
  ],
  api: [
    { path: 'docs/rate-limits.png', status: 'modified', binary: true },
    { path: 'package-lock.json', status: 'modified', diff: lockfileDiff() },
    {
      path: 'src/backoff.js',
      status: 'new',
      untracked: true,
      diff: hunks(
        '@@ -0,0 +1,12 @@',
        '+// How long to wait before asking again, once the API said to slow down.',
        '+const FIRST_WAIT_MS = 500;',
        '+const LONGEST_WAIT_MS = 30 * 1000;',
        '+',
        '+/**',
        '+ * @param {number} attempt  0 for the first retry',
        '+ * @param {number} [retryAfter]  seconds, when the API named a time itself',
        '+ */',
        '+export function waitFor(attempt, retryAfter) {',
        '+  if (retryAfter > 0) return retryAfter * 1000;',
        '+  return Math.min(LONGEST_WAIT_MS, FIRST_WAIT_MS * 2 ** attempt);',
        '+}'
      ),
    },
    {
      path: 'src/client.js',
      status: 'modified',
      diff: hunks(
        '@@ -1,5 +1,6 @@',
        ' // Every request to the API goes through here.',
        "-import { retry } from './retry.js';",
        "+import { waitFor } from './backoff.js';",
        "+import { MAX_ATTEMPTS } from './config/limits.js';",
        ' ',
        " const BASE = 'https://api.example.com/v2';",
        ' ',
        '@@ -18,9 +19,13 @@ export async function request(path, options = {}) {',
        '   const url = `${BASE}${path}`;',
        '-  const response = await retry(() => fetch(url, options));',
        '-  if (!response.ok) {',
        '-    throw new Error(`${response.status} from ${path}`);',
        '+  for (let attempt = 0; ; attempt += 1) {',
        '+    const response = await fetch(url, options);',
        '+    if (response.ok) return response.json();',
        '+    // 429: slow down. The API may say for how long.',
        '+    const slowDown = response.status === 429 && attempt < MAX_ATTEMPTS;',
        '+    if (!slowDown) throw new Error(`${response.status} from ${path}`);',
        "+    const retryAfter = Number(response.headers.get('retry-after'));",
        '+    await new Promise((done) => setTimeout(done, waitFor(attempt, retryAfter)));',
        '   }',
        '-  return response.json();',
        ' }',
        ' ',
        ' export const get = (path) => request(path);'
      ),
    },
    {
      path: 'src/config/limits.js',
      from: 'src/limits.js',
      status: 'renamed',
      diff: hunks(
        '@@ -1,4 +1,4 @@',
        ' // How hard the client may lean on the API.',
        ' export const REQUESTS_PER_MINUTE = 120;',
        '-export const MAX_ATTEMPTS = 3;',
        '+export const MAX_ATTEMPTS = 5;',
        ' export const TIMEOUT_MS = 10 * 1000;'
      ),
    },
    {
      path: 'src/retry.js',
      status: 'deleted',
      diff: hunks(
        '@@ -1,9 +0,0 @@',
        '-// Tries again at once, three times. The API does not like that.',
        '-export async function retry(call, attempts = 3) {',
        '-  for (let i = 0; i < attempts; i += 1) {',
        '-    const response = await call();',
        '-    if (response.status !== 429) return response;',
        '-  }',
        '-  return call();',
        '-}',
        '-'
      ),
    },
    {
      path: 'test/backoff.test.js',
      status: 'new',
      diff: hunks(
        '@@ -0,0 +1,10 @@',
        "+import { test } from 'node:test';",
        "+import assert from 'node:assert/strict';",
        "+import { waitFor } from '../src/backoff.js';",
        '+',
        "+test('each wait is twice the one before, up to half a minute', () => {",
        '+  assert.deepEqual([0, 1, 2, 3].map((n) => waitFor(n)), [500, 1000, 2000, 4000]);',
        '+  assert.equal(waitFor(20), 30000);',
        '+});',
        '+',
        "+test('the time the API names wins', () => assert.equal(waitFor(0, 7), 7000));"
      ),
    },
  ],
};

// ---- what reviewers said about the pull request ---------------------------------------------------
// There is no GitHub here either: the example folders with a pull request have a few
// made-up threads on the lines of their made-up diffs.

const MINUTE = 60 * 1000;

/**
 * A made-up thread on lines a folder's diff has: what its line reads and the lines above it
 * come from that diff, as GitHub keeps them with a comment.
 * @param {string} project
 * @param {{ path: string, line: number, startLine?: number, resolved?: boolean, comments: [string, string][] }} said
 *   `comments`: who and what, the first one and its replies
 * @returns {import('../src/main/review-threads.js').ReviewThread}
 */
function threadOn(project, { path, line, startLine = null, resolved = false, comments }) {
  const lines = parseDiff(DEMO_CHANGES[project].find((change) => change.path === path).diff);
  const at = lineNumbers(lines).findIndex(({ after }) => after === line);
  const shown = Math.max(4, startLine === null ? 0 : line - startLine + 1);
  const snippet = lines.slice(Math.max(0, at - shown + 1), at + 1).filter(({ kind }) => kind !== 'hunk');
  return thread({ path, line, startLine, text: lines[at].text, snippet, resolved, comments });
}

/** A made-up thread, written a few minutes ago. */
function thread({ comments, ...rest }) {
  const id = `demo-thread-${rest.path}-${rest.line}`;
  return {
    id,
    url: 'https://github.com/pulls',
    side: 'new',
    startLine: null,
    resolved: false,
    outdated: false,
    ...rest,
    comments: comments.map(([author, body], i) => ({ author, body, time: Date.now() - (40 - i * 12) * MINUTE })),
  };
}

/** @type {Record<string, import('../src/main/review-threads.js').ReviewThread[]>} by the name of the example folder */
const DEMO_THREADS = {
  buddylist: [
    threadOn('buddylist', {
      path: 'src/renderer/contacts/hover-card.js',
      line: 10,
      comments: [['mira', '"1 uncommitted" reads oddly. `plural()` from `lib/format.js` would say "1 change".']],
    }),
    threadOn('buddylist', {
      path: 'src/renderer/contacts/main.js',
      line: 49,
      startLine: 45,
      comments: [
        ['tobias', 'nit: every move of the mouse over the list asks for a card. Can we wait until it rests?'],
        ['mira', 'Agreed. 300 ms is what the tooltips use.'],
      ],
    }),
    // The line it was about has changed since: it stands above the file's diff.
    thread({
      path: 'src/renderer/contacts/main.js',
      line: 44,
      outdated: true,
      text: "  list.addEventListener('mouseover', (e) => showCard(contactOf(e)));",
      snippet: [
        { kind: 'context', text: "  list.addEventListener('dblclick', (e) => openChat(contactOf(e)));" },
        { kind: 'context', text: "  list.addEventListener('contextmenu', (e) => openContactMenu(e));" },
        { kind: 'del', text: "  list.addEventListener('mouseover', (e) => showTitle(contactOf(e)));" },
        { kind: 'add', text: "  list.addEventListener('mouseover', (e) => showCard(contactOf(e)));" },
      ],
      comments: [['tobias', 'This shows a card before there is anything to put in it.']],
    }),
    threadOn('buddylist', {
      path: 'src/renderer/styles/contacts.css',
      line: 222,
      resolved: true,
      comments: [
        ['mira', 'The menus cast the same shadow. Worth a variable?'],
        ['tobias', 'Not for two uses.'],
      ],
    }),
  ],
  api: [
    threadOn('api', {
      path: 'src/client.js',
      line: 24,
      comments: [['tobias', 'A `503` deserves another try as well. Should this be a list of statuses?']],
    }),
  ],
};

const demoThread = (project, id) => {
  const found = (DEMO_THREADS[project] || []).find((one) => one.id === id);
  if (!found) throw new Error('This comment is not among those GitHub listed for this pull request.');
  return found;
};

/**
 * A reply to a made-up thread, kept with it as GitHub would keep it. Nothing is posted anywhere.
 * @param {string | null} project  the folder's name
 * @param {string} id    the thread's
 * @param {string} body
 * @returns {import('../src/main/review-threads.js').ReviewComment}
 */
export function demoReply(project, id, body) {
  const said = String(body ?? '').trim();
  if (!said) throw new Error('Type a reply first.');
  const reply = { author: 'you', body: said, time: Date.now() };
  demoThread(project, id).comments.push(reply);
  return reply;
}

/**
 * Marks a made-up thread as resolved, or as not resolved after all.
 * @param {string | null} project  the folder's name
 * @param {string} id  the thread's
 * @param {boolean} resolved
 * @returns {boolean}  how it stands now
 */
export function demoResolve(project, id, resolved) {
  const found = demoThread(project, id);
  found.resolved = resolved === true;
  return found.resolved;
}

/**
 * The review threads of an example folder's pull request, as the app's main process would list them.
 * @param {string | null} project  the folder's name
 * @returns {import('../src/main/review-threads.js').ReviewThreads}
 */
export const demoThreads = (project) => ({
  // Copies, as a real answer is: what a window does with a thread is not done to the ones kept here.
  threads: (DEMO_THREADS[project] || []).map((one) => ({ ...one, comments: [...one.comments] })),
  more: 0,
});

/**
 * @typedef {Object} DemoCommit
 * @property {string} sha
 * @property {string} subject     the first line of its message
 * @property {string} author
 * @property {number} minutesAgo  how long ago it was made, whenever the tab is looked at
 * @property {DemoChange[]} files what it changed: files no other commit touched, and none that changed since
 */

/** @type {Record<string, DemoCommit[]>} the commits an example folder's branch made, the newest first */
export const DEMO_COMMITS = {
  api: [
    {
      sha: '9c41e07b2d6f5a3381c0e94d7b12f6a05d3e8c74',
      subject: 'docs: say how long the client waits after a 429',
      author: 'you',
      minutesAgo: 6,
      files: [
        {
          path: 'README.md',
          status: 'modified',
          diff: hunks(
            '@@ -31,6 +31,10 @@ ## Errors',
            ' Every request goes through `src/client.js`, which throws on any answer',
            ' that is not a 2xx.',
            ' ',
            '+A 429 is the exception: the client waits and asks again, up to five times.',
            '+It waits as long as the `Retry-After` header says, and without one twice as',
            '+long each time, starting at half a second.',
            '+',
            ' ## Tests',
            ' ',
            ' `npm test` runs them all.'
          ),
        },
      ],
    },
    {
      sha: '2f8a6d135be94c07a1d2e6f3908b7c54d1a0e9b6',
      subject: 'test: let the fake API say when to come back',
      author: 'you',
      minutesAgo: 47,
      files: [
        {
          path: 'test/helpers/fake-api.js',
          status: 'modified',
          diff: hunks(
            '@@ -8,8 +8,10 @@ export function fakeApi(answers) {',
            '   const calls = [];',
            '   globalThis.fetch = async (url, options) => {',
            '     calls.push({ url, options });',
            '-    const { status = 200, body = {} } = answers.shift() ?? {};',
            '-    return new Response(JSON.stringify(body), { status });',
            '+    const { status = 200, body = {}, retryAfter } = answers.shift() ?? {};',
            '+    // The real API names a time to come back at with some of its 429s.',
            "+    const headers = retryAfter ? { 'retry-after': String(retryAfter) } : {};",
            '+    return new Response(JSON.stringify(body), { status, headers });',
            '   };',
            '   return calls;',
            ' }'
          ),
        },
        {
          path: 'test/helpers/slow-down.json',
          status: 'new',
          diff: hunks(
            '@@ -0,0 +1,4 @@',
            '+{',
            '+  "error": "rate_limited",',
            '+  "message": "Too many requests. Slow down."',
            '+}'
          ),
        },
      ],
    },
  ],
};

/**
 * A file a scripted agent edited, as a change of its own: what it took out and what it put
 * in, a hunk for each place. Where in the file that was is made up.
 * @param {{ path: string, changes?: { before: string, after: string }[] }} edit  the activity you accepted
 * @param {string} cwd  the folder it was made in
 * @returns {DemoChange}
 */
export function editedFile({ path, changes = [] }, cwd) {
  const root = cwd.endsWith('/') ? cwd : `${cwd}/`;
  const lines = (text, sign) => (text ? text.split('\n').map((line) => `${sign}${line}`) : []);
  const diff = changes.flatMap(({ before, after }, i) => {
    const out = lines(before, '-');
    const put = lines(after, '+');
    const at = 12 + i * 20;
    return [`@@ -${at},${out.length} +${at},${put.length} @@`, ...out, ...put];
  });
  return { path: path.startsWith(root) ? path.slice(root.length) : path, status: 'modified', diff: hunks(...diff) };
}

const inOrder = (changes) => [...changes].sort((a, b) => (a.path < b.path ? -1 : 1));

/** A folder's made-up changes and the files edited in it since, by path. An edited file is listed once, as it is now. */
function changesIn(project, edited) {
  const again = edited.map((change) => change.path);
  const made = (DEMO_CHANGES[project] || []).filter((change) => !again.includes(change.path));
  return inOrder([...made, ...edited]);
}

/**
 * What the Changes tab is about: the files of one of the branch's commits, what changed since
 * the last one, or everything the branch changed, which is what its commits changed and what
 * changed since.
 * @param {string | null} project  the folder's name
 * @param {DemoChange[]} edited
 * @param {string | null} [commit]  one of the folder's made-up commits, or UNCOMMITTED. Any other is
 *   answered with everything, and so is UNCOMMITTED in a folder whose branch made no commits and
 *   that has nothing to commit
 * @returns {{ commit: string | null, changes: DemoChange[] }}  `commit`: what was listed
 */
function changesOf(project, edited, commit = null) {
  const commits = DEMO_COMMITS[project] || [];
  const chosen = commits.find((made) => made.sha === commit);
  if (chosen) return { commit: chosen.sha, changes: inOrder(chosen.files) };
  const since = changesIn(project, edited);
  if (commit === UNCOMMITTED && (commits.length || since.length)) return { commit, changes: since };
  const committed = commits.flatMap((made) => made.files);
  return { commit: null, changes: inOrder([...committed, ...since]) };
}

/** Changes as the app lists files: without their diffs, with the lines each gained and lost. @param {DemoChange[]} changes */
function counted(changes) {
  return changes.map(({ diff = '', ...file }) => {
    if (file.binary) return { ...file, added: null, removed: null };
    const lines = parseDiff(diff);
    const count = (kind) => lines.filter((line) => line.kind === kind).length;
    return { ...file, added: count('add'), removed: count('del') };
  });
}

/**
 * The files of an example folder that are not committed, as its contact card counts them
 * and its pretend shell lists them.
 * @param {string | null} project  the folder's name
 * @param {DemoChange[]} [edited]  the files a scripted agent edited there (see `editedFile`)
 * @returns {import('../src/main/changes.js').ChangedFile[]}
 */
export const demoFiles = (project, edited = []) => counted(changesIn(project, edited));

/**
 * What the Changes tab lists for an example folder, as the app's main process would: its
 * branch's commits, and the files of all of them and what changed since, of one alone, or of
 * what changed since the last.
 * @param {string | null} project
 * @param {DemoChange[]} [edited]
 * @param {string | null} [commit]  the commit to list the files of, by its whole name, or UNCOMMITTED
 * @param {number} [now]
 * @returns {Omit<import('../src/main/changes.js').Listing, 'repository' | 'branch' | 'more'>}
 */
export function demoListing(project, edited = [], commit = null, now = Date.now()) {
  const commits = (DEMO_COMMITS[project] || []).map(({ sha, subject, author, minutesAgo }) => ({
    sha,
    short: sha.slice(0, 7),
    subject,
    author,
    at: now - minutesAgo * 60000,
  }));
  const { commit: listed, changes } = changesOf(project, edited, commit);
  return {
    mainLine: commits.length ? 'origin/main' : null,
    commits,
    moreCommits: 0,
    uncommitted: changesIn(project, edited).length,
    commit: listed,
    files: counted(changes),
  };
}

/**
 * One of those files' diff, cut off like a real one when it is very large.
 * @param {string | null} project
 * @param {string} path
 * @param {DemoChange[]} [edited]
 * @param {string | null} [commit]  the commit the file was listed for
 * @returns {import('../src/main/changes.js').FileDiff}
 */
export function demoDiff(project, path, edited = [], commit = null) {
  const file = changesOf(project, edited, commit).changes.find((change) => change.path === path);
  return { ...cutOff(file?.diff || ''), binary: Boolean(file?.binary) };
}

/** How many made-up lines a file has past its diff's last hunk, where that hunk does not end the file. */
const DEMO_TAIL = 12;

/** A made-up line of a file, where its diff has none: one that did not change. */
const fillerLine = (path, line) => (path.endsWith('.css') ? `/* line ${line} */` : `// line ${line}`);

/**
 * One of those files whole, as its diff leads to it, for the unchanged lines the diff left
 * out: the diff's own lines where it has them, and made-up ones everywhere else.
 * @param {string | null} project
 * @param {string} path
 * @param {DemoChange[]} [edited]
 * @param {string | null} [commit]  the commit the file was listed for
 * @returns {{ text: string, cut: boolean }}
 */
export function demoFile(project, path, edited = [], commit = null) {
  const file = changesOf(project, edited, commit).changes.find((change) => change.path === path);
  const lines = parseDiff(file?.diff || '');
  const numbers = lineNumbers(lines);
  /** @type {Map<number, string>} what the diff says each line of the new file reads */
  const known = new Map();
  lines.forEach(({ text }, i) => {
    if (numbers[i].after !== null) known.set(numbers[i].after, text);
  });
  const length = Math.max(0, ...known.keys()) + (mayGoOn(lines) ? DEMO_TAIL : 0);
  const whole = Array.from({ length }, (_, i) => `${known.get(i + 1) ?? fillerLine(path, i + 1)}\n`);
  return { text: whole.join(''), cut: false };
}
