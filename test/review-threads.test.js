import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoDiff, demoReply, demoResolve, demoThreads } from '../preview/demo-changes.js';
import { parseThreads, replyToThread, resolveThread, reviewThreads, threadsArgs } from '../src/main/review-threads.js';
import { shownLines } from '../src/renderer/chat/diff-view.js';
import { placesOf } from '../src/renderer/chat/line-comments.js';
import {
  excerpt,
  inTabOrder,
  linesLabel,
  neighbour,
  threadMessage,
  threadPlace,
} from '../src/renderer/chat/review-threads.js';
import { parseDiff } from '../src/shared/unified-diff.js';

// ---- reading what GitHub says -----------------------------------------------------------------------

const HUNK = [
  '@@ -101,6 +101,15 @@ describe("lightbox", () => {',
  '   });',
  ' ',
  '+  it("disables the arrows at the ends", () => {',
  '+    renderLightbox();',
  '+',
  "+    expect(button('previous_image')).toBeDisabled();",
].join('\n');

const said = (fields = {}) => ({
  url: 'https://github.com/acme/shop/pull/94#discussion_r1',
  body: 'nit: can we split this one in two (first and last image)?',
  createdAt: '2026-10-07T09:30:00Z',
  diffHunk: HUNK,
  author: { login: 'cauethenorio', avatarUrl: 'https://avatars.githubusercontent.com/u/12?s=48&v=4' },
  ...fields,
});

const node = (fields = {}, comments = [said()]) => ({
  id: 'PRRT_1',
  isResolved: false,
  isOutdated: false,
  path: 'test/lightbox.test.tsx',
  diffSide: 'RIGHT',
  line: 106,
  startLine: null,
  originalLine: 106,
  originalStartLine: null,
  comments: { nodes: comments },
  ...fields,
});

const GH = (nodes = [node()], totalCount = nodes.length) =>
  JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { totalCount, nodes } } } } });

const one = (fields, comments) => parseThreads(GH([node(fields, comments)])).threads[0];

test('what gh prints becomes threads: where each is, what its line reads, and who said what', () => {
  assert.deepEqual(parseThreads(GH()), {
    threads: [
      {
        id: 'PRRT_1',
        url: 'https://github.com/acme/shop/pull/94#discussion_r1',
        path: 'test/lightbox.test.tsx',
        side: 'new',
        line: 106,
        startLine: null,
        text: "    expect(button('previous_image')).toBeDisabled();",
        // The four lines GitHub shows above a comment, its own line last.
        snippet: [
          { kind: 'add', text: '  it("disables the arrows at the ends", () => {' },
          { kind: 'add', text: '    renderLightbox();' },
          { kind: 'add', text: '' },
          { kind: 'add', text: "    expect(button('previous_image')).toBeDisabled();" },
        ],
        resolved: false,
        outdated: false,
        comments: [
          {
            author: 'cauethenorio',
            avatar: 'https://avatars.githubusercontent.com/u/12?s=48&v=4',
            body: 'nit: can we split this one in two (first and last image)?',
            time: Date.parse('2026-10-07T09:30:00Z'),
          },
        ],
      },
    ],
    more: 0,
  });
});

test('a thread about several lines says where they start, and keeps every one of them, up to twelve', () => {
  const several = one({ line: 106, startLine: 103 });
  assert.equal(several.startLine, 103);
  assert.equal(several.snippet.length, 4);

  const hunk = ['@@ -1,0 +1,40 @@', ...Array.from({ length: 40 }, (_, i) => `+line ${i + 1}`)].join('\n');
  const long = one({ line: 40, startLine: 10 }, [said({ diffHunk: hunk })]);
  assert.equal(long.snippet.length, 12);
  assert.equal(long.snippet.at(-1).text, 'line 40');
  assert.equal(long.text, 'line 40');
  // "From line 5 to line 5" is one line.
  assert.equal(one({ line: 106, startLine: 106 }).startLine, null);
});

test('a comment on a removed line is one on the file as it was', () => {
  const removed = one({ diffSide: 'LEFT', line: 12 }, [said({ diffHunk: '@@ -12 +11,0 @@\n-gone' })]);
  assert.equal(removed.side, 'old');
  assert.deepEqual(removed.snippet, [{ kind: 'del', text: 'gone' }]);
});

test('an outdated thread says where its line was, and a resolved one that it is', () => {
  const outdated = one({ isOutdated: true, line: null, startLine: null, originalLine: 88, originalStartLine: 85 });
  assert.equal(outdated.outdated, true);
  assert.equal(outdated.line, 88);
  assert.equal(outdated.startLine, 85);
  assert.equal(one({ isResolved: true }).resolved, true);
});

test('a comment on a file as a whole has no line, and nothing of the diff', () => {
  const whole = one({ line: null, originalLine: null }, [said({ diffHunk: '' })]);
  assert.equal(whole.line, null);
  assert.equal(whole.text, '');
  assert.deepEqual(whole.snippet, []);
});

test('replies come after the comment, oldest first, each with who wrote it', () => {
  const { comments } = one({}, [
    said(),
    said({ body: 'Sure.', author: { login: 'safa' }, createdAt: 'never' }),
    said({ body: 'Thanks!', author: null }),
  ]);
  assert.deepEqual(
    comments.map(({ author, body }) => [author, body]),
    [
      ['cauethenorio', 'nit: can we split this one in two (first and last image)?'],
      ['safa', 'Sure.'],
      // An account that is gone.
      ['ghost', 'Thanks!'],
    ]
  );
  assert.equal(comments[1].time, null);
  assert.equal('avatar' in comments[1], false);
});

test('a comment of a review of yours that is not submitted yet says that it is pending', () => {
  const { comments } = one({}, [said(), said({ state: 'PENDING' }), said({ state: 'SUBMITTED' })]);
  assert.deepEqual(
    comments.map((comment) => comment.pending),
    [undefined, true, undefined]
  );
});

test('a picture is taken only from GitHub’s own picture host', () => {
  for (const avatarUrl of ['http://avatars.githubusercontent.com/u/1', 'https://example.com/a.png', 'data:x', 12]) {
    assert.equal('avatar' in one({}, [said({ author: { login: 'a', avatarUrl } })]).comments[0], false, avatarUrl);
  }
});

test('what is no thread is left out, and what is no answer is none', () => {
  const nodes = [
    node(),
    node({ id: undefined }),
    node({ path: '' }),
    node({ comments: { nodes: [] } }),
    node({ comments: null }),
    node({}, [said({ body: null })]),
    node({}, [said({ url: 'javascript:alert(1)' })]),
    null,
  ];
  assert.equal(parseThreads(GH(nodes)).threads.length, 1);
  for (const output of ['', 'gh: not found', '{}', '[]', JSON.stringify({ data: { repository: null } })]) {
    assert.equal(parseThreads(output), null, output);
  }
});

test('threads GitHub did not list are counted', () => {
  assert.equal(parseThreads(GH([node()], 104)).more, 103);
  assert.equal(parseThreads(GH([node()], undefined)).more, 0);
});

// ---- asking gh ----------------------------------------------------------------------------------------

const PR = { number: 94, url: 'https://github.com/acme/shop/pull/94' };

test('gh is asked for the threads of the pull request, where the pull request is', () => {
  const args = threadsArgs(PR);
  assert.deepEqual(args.slice(0, 4), ['api', 'graphql', '--hostname', 'github.com']);
  assert.match(args[5], /^query=query\(\$owner: String!, \$name: String!, \$number: Int!\)/);
  assert.match(args[5], /reviewThreads\(first: 100\)/);
  assert.deepEqual(args.slice(6), ['-f', 'owner=acme', '-f', 'name=shop', '-F', 'number=94']);
  // A company's own GitHub.
  assert.equal(threadsArgs({ number: 3, url: 'https://git.acme.dev/acme/shop/pull/3' })[3], 'git.acme.dev');
});

test('it only reads: the query changes nothing on GitHub', () => {
  assert.doesNotMatch(threadsArgs(PR)[5], /mutation/i);
});

test('a pull request without a page on GitHub has no threads, and gh is not asked', async () => {
  let asked = 0;
  const run = async () => ((asked += 1), GH());
  for (const pr of [null, undefined, { number: 128, url: 'https://github.com/pulls' }, { number: 'x', url: PR.url }]) {
    assert.deepEqual(await reviewThreads('/work/shop', pr, { run }), { threads: [], more: 0 });
  }
  assert.deepEqual(await reviewThreads('', PR, { run }), { threads: [], more: 0 });
  assert.equal(asked, 0);
});

test('the threads are asked for in the folder, and read', async () => {
  const asked = [];
  const run = async (cwd, args) => (asked.push([cwd, args[0], args[1]]), GH());
  const { threads } = await reviewThreads('/work/shop', PR, { run });
  assert.equal(threads[0].path, 'test/lightbox.test.tsx');
  assert.deepEqual(asked, [['/work/shop', 'api', 'graphql']]);
});

test('a gh that gives no answer says why, in words for the tab', async () => {
  const failing = (err) => ({ run: async () => Promise.reject(err) });
  await assert.rejects(reviewThreads('/work/shop', PR, failing(Object.assign(new Error('x'), { code: 'ENOENT' }))), {
    message: /GitHub CLI is not installed/,
  });
  await assert.rejects(
    reviewThreads('/work/shop', PR, failing(Object.assign(new Error('x'), { stderr: 'gh: Not Found (HTTP 404)\n' }))),
    { message: 'GitHub could not list the comments: gh: Not Found (HTTP 404)' }
  );
  await assert.rejects(reviewThreads('/work/shop', PR, { run: async () => 'oops' }), {
    message: /could not be read/,
  });
});

// ---- answering and resolving: what is written to GitHub ---------------------------------------------

const REPLIED = (fields = {}) =>
  JSON.stringify({
    data: {
      addPullRequestReviewThreadReply: {
        comment: {
          body: 'Sure.',
          createdAt: '2026-10-08T10:00:00Z',
          state: 'SUBMITTED',
          author: { login: 'safa', avatarUrl: 'https://avatars.githubusercontent.com/u/7?s=48&v=4' },
          ...fields,
        },
      },
    },
  });
const RESOLVED = (isResolved, mutation = 'resolveReviewThread') =>
  JSON.stringify({ data: { [mutation]: { thread: { isResolved } } } });

/** A folder whose pull request's threads were listed, and a `gh` that notes what it is asked after that. */
async function listedFolder(answer) {
  const cwd = `/work/shop-${Math.random()}`;
  await reviewThreads(cwd, PR, { run: async () => GH() });
  const asked = [];
  const run = async (folder, args) => {
    asked.push([folder, args]);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { cwd, asked, run };
}

test('a reply is written to its thread, as it was typed, and comes back as GitHub keeps it', async () => {
  const { cwd, asked, run } = await listedFolder(REPLIED());
  assert.deepEqual(await replyToThread(cwd, PR, 'PRRT_1', '  Sure.\n', { run }), {
    author: 'safa',
    avatar: 'https://avatars.githubusercontent.com/u/7?s=48&v=4',
    body: 'Sure.',
    time: Date.parse('2026-10-08T10:00:00Z'),
  });
  assert.equal(asked.length, 1);
  const [folder, args] = asked[0];
  assert.equal(folder, cwd);
  assert.deepEqual(args.slice(0, 4), ['api', 'graphql', '--hostname', 'github.com']);
  assert.match(args[5], /^query=mutation\(\$thread: ID!, \$body: String!\) \{\s+addPullRequestReviewThreadReply\(/);
  // Both as they are written: nothing in a reply is read as a file or a number.
  assert.deepEqual(args.slice(6), ['-f', 'thread=PRRT_1', '-f', 'body=Sure.']);
});

test('a reply that joined a review of yours that is not submitted says so', async () => {
  const { cwd, run } = await listedFolder(REPLIED({ state: 'PENDING' }));
  assert.equal((await replyToThread(cwd, PR, 'PRRT_1', 'Sure.', { run })).pending, true);
});

test('nothing is written without something to say, or with more than GitHub takes', async () => {
  const { cwd, asked, run } = await listedFolder(REPLIED());
  for (const body of ['', '   \n', undefined, null, 12]) {
    await assert.rejects(replyToThread(cwd, PR, 'PRRT_1', body, { run }), { message: 'Type a reply first.' });
  }
  await assert.rejects(replyToThread(cwd, PR, 'PRRT_1', 'x'.repeat(65537), { run }), {
    message: /longer than GitHub takes/,
  });
  assert.equal(asked.length, 0);
});

test('only a thread GitHub listed for the folder’s own pull request is answered or resolved', async () => {
  const { cwd, asked, run } = await listedFolder(REPLIED());
  const refused = { message: /not among those GitHub listed/ };
  // A thread nobody listed, something that is no thread, another pull request, another folder, no pull request.
  await assert.rejects(replyToThread(cwd, PR, 'PRRT_other', 'hi', { run }), refused);
  await assert.rejects(resolveThread(cwd, PR, 'PRRT_other', true, { run }), refused);
  await assert.rejects(resolveThread(cwd, PR, { id: 'PRRT_1' }, true, { run }), refused);
  await assert.rejects(replyToThread(cwd, { ...PR, number: 95 }, 'PRRT_1', 'hi', { run }), refused);
  await assert.rejects(replyToThread('/work/elsewhere', PR, 'PRRT_1', 'hi', { run }), refused);
  await assert.rejects(resolveThread(cwd, null, 'PRRT_1', true, { run }), refused);
  assert.equal(asked.length, 0);
});

test('a thread is resolved, and one that was resolved is opened again', async () => {
  const resolving = await listedFolder(RESOLVED(true));
  assert.equal(await resolveThread(resolving.cwd, PR, 'PRRT_1', true, { run: resolving.run }), true);
  const [, args] = resolving.asked[0];
  assert.match(args[5], /^query=mutation\(\$thread: ID!\) \{\s+resolveReviewThread\(input: \{ threadId: \$thread \}\)/);
  assert.deepEqual(args.slice(6), ['-f', 'thread=PRRT_1']);

  const reopening = await listedFolder(RESOLVED(false, 'unresolveReviewThread'));
  assert.equal(await resolveThread(reopening.cwd, PR, 'PRRT_1', false, { run: reopening.run }), false);
  assert.match(reopening.asked[0][1][5], /unresolveReviewThread\(input: \{ threadId: \$thread \}\)/);
});

test('a GitHub that refuses says why, and an answer that is none says so', async () => {
  const denied = Object.assign(new Error('x'), { stderr: 'gh: Resource not accessible by personal access token\n' });
  const refusing = await listedFolder(denied);
  await assert.rejects(replyToThread(refusing.cwd, PR, 'PRRT_1', 'hi', { run: refusing.run }), {
    message: 'GitHub did not take the reply: gh: Resource not accessible by personal access token',
  });
  await assert.rejects(resolveThread(refusing.cwd, PR, 'PRRT_1', true, { run: refusing.run }), {
    message: 'GitHub did not resolve the comment: gh: Resource not accessible by personal access token',
  });
  await assert.rejects(resolveThread(refusing.cwd, PR, 'PRRT_1', false, { run: refusing.run }), {
    message: /^GitHub did not reopen the comment: /,
  });
  const signedOut = await listedFolder(Object.assign(new Error('x'), { code: 4 }));
  await assert.rejects(replyToThread(signedOut.cwd, PR, 'PRRT_1', 'hi', { run: signedOut.run }), {
    message: /not signed in/,
  });
  const garbled = await listedFolder('oops');
  await assert.rejects(replyToThread(garbled.cwd, PR, 'PRRT_1', 'hi', { run: garbled.run }), {
    message: /could not be read/,
  });
  await assert.rejects(resolveThread(garbled.cwd, PR, 'PRRT_1', true, { run: garbled.run }), {
    message: /could not be read/,
  });
});

// ---- where a thread stands in the tab -------------------------------------------------------------

const DIFF = [
  '@@ -40,4 +40,5 @@ class Community < ApplicationRecord',
  '   has_many :community_spaces',
  '-  has_many :old_pages',
  '+  has_many :community_content_pages',
  '+  has_many :community_drafts',
  '   has_many :community_posts',
  '   has_many :community_members',
  '',
].join('\n');
const places = placesOf(shownLines(parseDiff(DIFF)));
const on = (side, line, text, more = {}) => ({ side, line, text, outdated: false, ...more });

test('a thread stands under the line it is about', () => {
  assert.equal(threadPlace(on('new', 42, '  has_many :community_drafts'), places), 4);
  assert.equal(threadPlace(on('old', 41, '  has_many :old_pages'), places), 2);
});

test('with the folder ahead of the pull request, the line is known by what it reads', () => {
  assert.equal(threadPlace(on('new', 30, '  has_many :community_drafts'), places), 4);
});

test('a thread whose line the diff does not have, an outdated one and one on a whole file stand apart', () => {
  assert.equal(threadPlace(on('new', 42, '  has_many :something_else'), places), -1);
  assert.equal(threadPlace(on('new', 42, '  has_many :community_drafts', { outdated: true }), places), -1);
  assert.equal(threadPlace(on('new', null, ''), places), -1);
  assert.equal(threadPlace(on('new', 42, '  has_many :community_drafts'), []), -1);
});

test('the card says which lines', () => {
  assert.equal(linesLabel({ side: 'new', line: 115, startLine: 105 }), 'Lines 105–115');
  assert.equal(linesLabel({ side: 'new', line: 12, startLine: null }), 'Line 12');
  assert.equal(linesLabel({ side: 'old', line: 12, startLine: null }), 'Line 12 (removed)');
  assert.equal(linesLabel({ side: 'new', line: null, startLine: null }), 'The whole file');
});

const at = (id, path, line, more = {}) => ({ id, path, line, side: 'new', outdated: false, resolved: false, ...more });

test('threads go in the order the tab shows them', () => {
  const threads = [
    at('b2', 'b.js', 9),
    at('a3', 'a.js', 30),
    at('gone', 'unlisted.js', 1),
    at('a-out', 'a.js', 80, { outdated: true }),
    at('a1', 'a.js', 4),
    at('a-file', 'a.js', null),
    at('a3-old', 'a.js', 30, { side: 'old' }),
  ];
  assert.deepEqual(
    inTabOrder(threads, ['b.js', 'a.js']).map((thread) => thread.id),
    // Above the list, then file by file: what stands above the diff, then down its lines.
    ['gone', 'b2', 'a-file', 'a-out', 'a1', 'a3-old', 'a3']
  );
});

test('the arrows go to the next thread still to be resolved, and around', () => {
  const [a, b, c, d] = [at('a'), at('b', '', 0, { resolved: true }), at('c'), at('d')];
  const threads = [a, b, c, d];
  assert.equal(neighbour(threads, a, 1), c, 'past the resolved one');
  assert.equal(neighbour(threads, c, -1), a);
  assert.equal(neighbour(threads, d, 1), a, 'after the last comes the first');
  assert.equal(neighbour(threads, a, -1), d);
  // From a resolved one that was opened, to its neighbours.
  assert.equal(neighbour(threads, b, 1), c);
  assert.equal(neighbour(threads, b, -1), a);
});

test('with no other thread to go to, the arrows go nowhere', () => {
  const only = at('a');
  assert.equal(neighbour([only, at('b', '', 0, { resolved: true })], only, 1), null);
  assert.equal(neighbour([], only, 1), null);
});

test('a closed thread shows the beginning of what was said, on one line', () => {
  assert.equal(excerpt('\n\n  nit: split this  \nand more'), 'nit: split this');
  assert.equal(excerpt('x'.repeat(200)), `${'x'.repeat(90)}…`);
  assert.equal(excerpt(''), '');
  assert.equal(excerpt(undefined), '');
});

// ---- handing a thread to the conversation ------------------------------------------------------------

const THREAD = parseThreads(
  GH([node({ line: 106, startLine: 105 }, [said(), said({ body: ' Sure. ', author: { login: 'safa' } })])])
).threads[0];

test('the message names the file and its lines, quotes them, and says who said what and where', () => {
  assert.equal(
    threadMessage(THREAD, { number: 94 }),
    [
      'A review comment on pull request #94:',
      '',
      'test/lightbox.test.tsx:105-106',
      '> ',
      ">     expect(button('previous_image')).toBeDisabled();",
      '@cauethenorio: nit: can we split this one in two (first and last image)?',
      '@safa: Sure.',
      '',
      'https://github.com/acme/shop/pull/94#discussion_r1',
    ].join('\n')
  );
});

test('one line is quoted for a thread about one, and none for a thread about a whole file', () => {
  const single = threadMessage({ ...THREAD, startLine: null });
  assert.match(single, /^A review comment:\n\ntest\/lightbox\.test\.tsx:106\n> {5}expect/);
  const whole = threadMessage({ ...THREAD, line: null, startLine: null, snippet: [] });
  assert.match(whole, /\n\ntest\/lightbox\.test\.tsx\n@cauethenorio: /);
});

test('it says when the line is one that was removed, has changed since, or the thread is resolved', () => {
  assert.match(threadMessage({ ...THREAD, side: 'old', startLine: null }), /tsx:106 \(removed\)\n/);
  assert.match(threadMessage({ ...THREAD, outdated: true }), /^A review comment \(the line has changed since\):/);
  assert.match(
    threadMessage({ ...THREAD, outdated: true, resolved: true }, { number: 94 }),
    /^A review comment on pull request #94 \(the line has changed since, resolved\):/
  );
});

test('among several agents the message mentions the one it is for', () => {
  assert.match(threadMessage(THREAD, { number: 94, to: 'Claude' }), /^@Claude A review comment on pull request #94:/);
});

test('a very long line is quoted only as far as it takes to tell which it is', () => {
  const long = { ...THREAD, startLine: null, snippet: [{ kind: 'add', text: 'y'.repeat(500) }] };
  assert.match(threadMessage(long), new RegExp(`\n> ${'y'.repeat(200)}…\n`));
});

// ---- the browser preview --------------------------------------------------------------------------------

test('every made-up thread of the preview is on a line of a made-up diff, or says why it is not', () => {
  for (const project of ['buddylist', 'api']) {
    const { threads, more } = demoThreads(project);
    assert.ok(threads.length, project);
    assert.equal(more, 0);
    for (const thread of threads) {
      const found = threadPlace(thread, placesOf(shownLines(parseDiff(demoDiff(project, thread.path).text))));
      assert.equal(found === -1, thread.outdated, `${project} ${thread.path}:${thread.line}`);
      assert.equal(thread.snippet.at(-1).text, thread.text);
    }
  }
  assert.deepEqual(demoThreads('website'), { threads: [], more: 0 });
  assert.deepEqual(demoThreads(null), { threads: [], more: 0 });
});

test('the preview shows every kind of thread: several lines, replies, outdated and resolved', () => {
  const { threads } = demoThreads('buddylist');
  assert.ok(threads.some((thread) => thread.startLine !== null));
  assert.ok(threads.some((thread) => thread.comments.length > 1));
  assert.ok(threads.some((thread) => thread.outdated));
  assert.ok(threads.some((thread) => thread.resolved));
  assert.equal(new Set(threads.map((thread) => thread.id)).size, threads.length);
});

test('in the preview a reply and a resolved thread are kept, and nothing is posted anywhere', () => {
  const [thread] = demoThreads('api').threads;
  assert.deepEqual(demoReply('api', thread.id, '  Good call.  ').body, 'Good call.');
  assert.equal(demoResolve('api', thread.id, true), true);
  const [now] = demoThreads('api').threads;
  assert.equal(now.resolved, true);
  assert.deepEqual(now.comments.at(-1).author, 'you');
  assert.equal(now.comments.length, thread.comments.length + 1);
  // What a window was given is its own: it hears of the reply from the answer, not behind its back.
  assert.equal(thread.resolved, false);
  assert.equal(demoResolve('api', thread.id, false), false);
  assert.throws(() => demoReply('api', thread.id, '  '), /Type a reply first/);
  assert.throws(() => demoResolve('api', 'no-such-thread', true), /not among those/);
  assert.throws(() => demoReply(null, thread.id, 'hi'), /not among those/);
});
