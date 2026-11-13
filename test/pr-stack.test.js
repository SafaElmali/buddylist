import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pullRequestStack } from '../src/main/pr-stack.js';
import { prReference, stackForest, stackParent, stackPullRequest } from '../src/shared/pr-stack.js';
import { PrStack, stackContent, stackHeading } from '../src/renderer/chat/pr-stack.js';
import { page } from './fixtures/dom.js';
import { inStack, issueEvent, stackResponse } from './fixtures/pr-stack-github.js';

const scope = { host: 'github.com', repo: 'o/r' };
const sha = (n) => n.toString(16).padStart(40, '0');
function pr(number, head, base = 'main', extra = {}) {
  return {
    number,
    html_url: `https://github.com/o/r/pull/${number}`,
    title: `Pull request ${number}`,
    state: 'open',
    head: { ref: head, sha: sha(number), repo: { full_name: 'o/r' } },
    base: { ref: base, sha: sha(0), repo: { full_name: 'o/r' } },
    ...extra,
  };
}
const normalized = (raw) => stackPullRequest(raw, scope);
const notFound = () => Object.assign(new Error('gh failed'), { stderr: 'gh: Not Found (HTTP 404)' });
/** One check as GraphQL lists it on a PR's newest commit. */
const checkRun = (name, conclusion, { status = 'COMPLETED', workflow = 'CI', at = '2026-11-13T09:00:00Z' } = {}) => ({
  __typename: 'CheckRun',
  name,
  status,
  conclusion: status === 'COMPLETED' ? conclusion : null,
  startedAt: at,
  checkSuite: { workflowRun: { workflow: { name: workflow } } },
});
/** GraphQL's answer for the PRs a query names (`pr<number>: pullRequest(number: <number>)`), with their checks. */
function checksAnswer(query, checks) {
  const repository = {};
  for (const [, alias, number] of query.matchAll(/(pr\d+): pullRequest\(number: (\d+)\)/g)) {
    const nodes = checks[number];
    repository[alias] = {
      commits: { nodes: [{ commit: { statusCheckRollup: nodes ? { contexts: { nodes } } : null } }] },
    };
  }
  return { data: { repository } };
}
function fixture(
  prs,
  current = prs[0],
  alter = () => undefined,
  { stacks = {}, events = {}, checks = {}, known } = {}
) {
  const calls = [];
  const graphql = [];
  const run = async (cwd, args) => {
    assert.equal(cwd, '/checkout');
    if (args[1] === 'graphql') {
      graphql.push(args);
      const query = args[args.indexOf('-f') + 1].replace(/^query=/, '');
      return JSON.stringify(typeof checks === 'function' ? checks(query) : checksAnswer(query, checks));
    }
    assert.deepEqual(args.slice(0, 5), ['api', '--method', 'GET', '--hostname', 'github.com']);
    assert.equal(args.length, 6);
    calls.push(args.at(-1));
    const url = new URL(args.at(-1), 'https://api.github.com/');
    const replacement = alter(url, calls);
    if (replacement !== undefined) return JSON.stringify(replacement);
    if (url.pathname === '/repos/o/r') return JSON.stringify({ default_branch: 'main' });
    if (url.pathname === `/repos/o/r/pulls/${current.number}`) return JSON.stringify(current);
    const stack = /^\/repos\/o\/r\/stacks\/(\d+)$/.exec(url.pathname)?.[1];
    if (stack) {
      if (!stacks[stack]) throw notFound();
      return JSON.stringify(stacks[stack]);
    }
    const issue = /^\/repos\/o\/r\/issues\/(\d+)\/events$/.exec(url.pathname)?.[1];
    if (issue) {
      assert.equal(url.searchParams.get('per_page'), '100');
      return JSON.stringify(events[issue] ?? []);
    }
    assert.equal(url.pathname, '/repos/o/r/pulls');
    assert.equal(url.searchParams.get('state'), 'all');
    const head = url.searchParams.get('head');
    const base = url.searchParams.get('base');
    return JSON.stringify(prs.filter((item) => (head ? `o:${item.head.ref}` === head : item.base.ref === base)));
  };
  return {
    calls,
    graphql,
    load: () => pullRequestStack('/checkout', { known: { url: current.html_url, ...known }, run }),
  };
}
const chain = () => {
  const a = pr(8, 'foundation');
  const b = pr(4, 'feature', 'foundation', { base: { ...a.head } });
  const c = pr(2, 'polish', 'feature', { base: { ...b.head }, draft: true });
  return [a, b, c];
};

test('verified relationships run base to current to dependents, regardless of PR number', async () => {
  const prs = chain();
  const { load, calls } = fixture(prs, prs[1]);
  const answer = await load();
  assert.equal(answer.current, prs[1].html_url);
  assert.equal(answer.count, 3);
  assert.equal(answer.incomplete, false);
  const [a] = answer.roots;
  assert.equal(a.number, 8);
  assert.equal(a.children[0].number, 4);
  assert.equal(a.children[0].children[0].number, 2);
  assert.equal(a.children[0].children[0].state, 'draft');
  assert.equal(new Set(calls).size, calls.length, 'branch lookups are deduplicated');
});

test('siblings stay siblings, and unrelated PRs are not invented into the stack', async () => {
  const [a, b, c] = chain();
  const sibling = pr(3, 'other-feature', 'foundation', { base: { ...a.head } });
  const unrelated = pr(1, 'unrelated');
  const answer = await fixture([unrelated, c, sibling, b, a], b).load();
  assert.equal(answer.count, 4);
  assert.deepEqual(
    answer.roots[0].children.map((pr) => pr.number),
    [3, 4]
  );
  assert.equal(answer.roots[0].children[0].children.length, 0);
});

test('standalone and unassociated conversations are distinct and never ask for the app repository', async () => {
  const alone = await fixture([pr(1, 'alone')]).load();
  assert.equal(alone.count, 1);
  assert.equal(alone.incomplete, false);
  assert.equal(alone.roots[0].relationship.kind, 'base');
  for (const [cwd, known] of [
    ['', { url: 'https://github.com/o/r/pull/1' }],
    ['/checkout', null],
    ['/checkout', { url: '--web' }],
  ]) {
    const answer = await pullRequestStack(cwd, { known, run: () => assert.fail('must not call gh') });
    assert.equal(answer.current, null);
  }
});

test('reused branch names require exact commits, and duplicate exact parents remain ambiguous', () => {
  const [a, b] = chain().map(normalized);
  const older = { ...a, number: 99, url: 'https://github.com/o/r/pull/99', head: { ...a.head, sha: sha(99) } };
  assert.equal(stackParent(b, [older, a]).parent, a.url);
  assert.equal(stackParent(b, [older]).kind, 'unknown');
  assert.equal(stackParent(b, [a, { ...older, head: a.head }]).kind, 'ambiguous');
  assert.equal(stackParent(b, [a], { complete: false }).kind, 'unknown');
  assert.equal(stackParent(b, [{ ...a, head: { ...a.head, repo: 'fork/r' } }]).kind, 'base');
});

test('ambiguous parents are linked as candidates without falsely connecting them', async () => {
  const [a, b] = chain();
  const duplicate = { ...a, number: 9, html_url: 'https://github.com/o/r/pull/9' };
  const answer = await fixture([a, duplicate, b], b).load();
  assert.equal(answer.count, 1);
  assert.equal(answer.incomplete, true);
  assert.equal(answer.roots[0].relationship.kind, 'ambiguous');
  assert.deepEqual(
    answer.roots[0].relationship.candidates.map((pr) => pr.number),
    [8, 9]
  );
});

test('same-branch forks cannot impersonate a parent, and fork dependents are explicit', async () => {
  const [a, b] = chain();
  a.head.repo.full_name = 'fork/r';
  const answer = await fixture([a, b], a).load();
  assert.equal(answer.count, 1);
  assert.equal(answer.incomplete, true);
  assert.match(answer.notices.join(' '), /fork/);
});

test('merged, closed and draft states survive discovery, even for a retained PR URL', async () => {
  const prs = chain();
  prs[0].state = 'closed';
  prs[0].merged_at = '2026-10-01T12:00:00Z';
  prs[1].state = 'closed';
  const answer = await fixture(prs, prs[0]).load();
  assert.equal(answer.roots[0].state, 'merged');
  assert.equal(answer.roots[0].children[0].state, 'closed');
  assert.equal(answer.roots[0].children[0].children[0].state, 'draft');
});

test('missing metadata and failed child lookups produce partial results, never false standalone claims', async () => {
  const missing = pr(1, 'gone', 'main', { head: { ref: 'gone', sha: sha(1), repo: null } });
  assert.equal((await fixture([missing]).load()).incomplete, true);
  const [a, b] = chain();
  const partial = await fixture([a, b], b, (url) => {
    if (url.searchParams.has('head')) throw new Error('offline');
  }).load();
  assert.equal(partial.incomplete, true);
  assert.equal(partial.roots[0].relationship.kind, 'unknown');
  assert.match(partial.notices.join(' '), /offline/);
  a.head.repo = null;
  const deletedParent = await fixture([a, b], b).load();
  assert.equal(deletedParent.incomplete, true);
  assert.equal(deletedParent.roots[0].relationship.kind, 'unknown');
  const [parent, child] = chain();
  child.base.repo = null;
  const missingDependent = await fixture([parent, child], parent).load();
  assert.equal(missingDependent.count, 1);
  assert.equal(missingDependent.incomplete, true);
  assert.match(missingDependent.notices.join(' '), /incomplete list/);
});

test('truncated and malformed lists cannot establish a unique parent', async () => {
  const [a, b] = chain();
  for (const response of [[a, {}], Array.from({ length: 100 }, () => a)]) {
    const answer = await fixture([a, b], b, (url) => (url.searchParams.has('head') ? response : undefined)).load();
    assert.equal(answer.count, 1);
    assert.equal(answer.incomplete, true);
    assert.notEqual(answer.roots[0].relationship.kind, 'linked');
  }
});

test('current-PR lookup errors reject with recovery text, not an empty stack', async () => {
  const current = pr(1, 'a');
  await assert.rejects(
    fixture([current], current, (url) => {
      if (url.pathname.endsWith('/pulls/1')) throw new Error('network offline');
    }).load(),
    /network offline/
  );
  await assert.rejects(
    pullRequestStack('/checkout', { known: { url: current.html_url }, run: async () => '{bad' }),
    /unreadable/
  );
  await assert.rejects(
    fixture([current], current, (url) => (url.pathname.endsWith('/pulls/1') ? {} : undefined)).load(),
    /incomplete/
  );
});

test('cycles are flattened with an explicit unknown-order notice', () => {
  const [a, b] = chain().map(normalized);
  const answer = stackForest(
    a,
    [a, b],
    new Map([
      [a.url, { kind: 'linked', parent: b.url }],
      [b.url, { kind: 'linked', parent: a.url }],
    ])
  );
  assert.equal(answer.roots.length, 2);
  assert.equal(answer.incomplete, true);
  assert.ok(answer.roots.every((pr) => pr.children.length === 0));
  assert.match(answer.notices.join(' '), /circular/);
});

test('large stacks stay bounded and disclose the missing portion', async () => {
  const prs = [pr(1, 'branch-1')];
  for (let number = 2; number <= 35; number++)
    prs.push(pr(number, `branch-${number}`, '', { base: { ...prs.at(-1).head } }));
  const { load, calls } = fixture(prs);
  const answer = await load();
  assert.equal(answer.count, 24);
  assert.equal(answer.incomplete, true);
  assert.ok(calls.length <= 60);
  assert.match(answer.notices.join(' '), /24/);
});

test('URLs and metadata are scoped to the verified host/repository', () => {
  for (const url of ['javascript:alert(1)', 'https://user@github.com/o/r/pull/1', 'https://github.com/o/r/pull/1?x=1'])
    assert.equal(prReference(url), null);
  assert.equal(stackPullRequest(pr(1, 'x', 'main', { html_url: 'https://other.test/o/r/pull/1' }), scope), null);
  assert.equal(stackPullRequest(pr(1, 'x', 'main', { html_url: 'https://github.com/other/r/pull/1' }), scope), null);
});

// Modelled on the reported stack: four PRs that all target main once GitHub retargets them, the lower three merged.
const githubStack = () =>
  [
    pr(866, 'renderer-extraction', 'main', { state: 'closed', merged_at: '2026-10-30T14:36:19Z' }),
    pr(867, 'member-page-api', 'main', { state: 'closed', merged_at: '2026-10-30T16:26:33Z' }),
    pr(869, 'content-page-layouts', 'main', { state: 'closed', merged_at: '2026-10-31T08:24:50Z' }),
    pr(870, 'page-preview'),
  ].map((item, index, all) => inStack(item, { number: 902, position: index + 1, size: all.length }));
const withGithubStack = (prs, current, alter, options = {}) =>
  fixture(prs, current, alter, { stacks: { 902: stackResponse(902, prs) }, ...options });
const rows = (answer) => answer.roots.map((pr) => [pr.number, pr.position, pr.state]);
const markup = (value) => value[Object.getOwnPropertySymbols(value)[0]];
const shown = (answer) =>
  markup(stackContent(answer))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

test('a GitHub stack is shown bottom to top with its states, though every PR targets main', async () => {
  const prs = githubStack();
  for (const current of prs) {
    const { load, calls } = withGithubStack(prs, current);
    const answer = await load();
    assert.equal(answer.current, current.html_url);
    assert.deepEqual(answer.stack, { number: 902, size: 4, base: 'main', ordered: true });
    assert.deepEqual(rows(answer), [
      [866, 1, 'merged'],
      [867, 2, 'merged'],
      [869, 3, 'merged'],
      [870, 4, 'open'],
    ]);
    assert.ok(answer.roots.every((row) => row.children.length === 0 && row.relationship.kind === 'stacked'));
    assert.equal(answer.count, 4);
    assert.equal(answer.incomplete, false);
    assert.deepEqual(answer.notices, []);
    // GitHub's own membership answers it: no branch lookups, base history or default-branch request.
    assert.deepEqual(calls, [`repos/o/r/pulls/${current.number}`, 'repos/o/r/stacks/902']);
  }
});

test('a GitHub stack keeps its own order and draft state, whatever the PR numbers', async () => {
  const prs = [526, 527, 528, 529, 521].map((number, index) =>
    inStack(pr(number, `part-${number}`), { number: 530, position: index + 1, size: 5 })
  );
  prs[4].draft = true;
  const answer = await fixture(prs, prs[4], undefined, { stacks: { 530: stackResponse(530, prs) } }).load();
  assert.deepEqual(
    answer.roots.map((pr) => pr.number),
    [526, 527, 528, 529, 521]
  );
  assert.equal(answer.roots[4].state, 'draft');
  assert.equal(answer.roots[4].position, 5);
});

test('a GitHub stack whose order disagrees with the PR is listed by number, without positions', async () => {
  const prs = githubStack();
  const swapped = stackResponse(902, [prs[0], prs[2], prs[1], prs[3]]);
  const shorter = stackResponse(902, prs.slice(0, 3));
  const missing = stackResponse(902, [prs[0], prs[1], prs[3]]);
  const odd = stackResponse(902, prs);
  odd.pull_requests[1].html_url = 'https://github.com/other/r/pull/867';
  for (const response of [swapped, shorter, missing, odd]) {
    const answer = await fixture(prs, prs[2], undefined, { stacks: { 902: response } }).load();
    assert.equal(answer.stack.ordered, false);
    assert.equal(answer.incomplete, true);
    assert.ok(
      answer.roots.some((row) => row.url === prs[2].html_url),
      'the current PR is always shown'
    );
    assert.ok(answer.roots.every((row) => row.position === null && row.relationship.kind === 'unknown'));
    assert.deepEqual(
      answer.roots.map((row) => row.number),
      answer.roots.map((row) => row.number).toSorted((a, b) => a - b)
    );
    assert.match(answer.notices.join(' '), /order of GitHub stack #902 could not be confirmed/);
  }
  const answer = await fixture(prs, prs[2], undefined, { stacks: { 902: odd } }).load();
  assert.equal(answer.count, 3);
  assert.match(answer.notices.join(' '), /incomplete details/);
});

test('a GitHub stack that cannot be read falls back to branches, and never claims standalone', async () => {
  const prs = githubStack();
  const missing = await fixture(prs, prs[2]).load();
  assert.equal(missing.stack, null);
  assert.equal(missing.count, 1);
  assert.equal(missing.incomplete, true);
  assert.match(missing.notices.join(' '), /GitHub stack #902 could not be loaded/);
  assert.match(missing.notices.join(' '), /Not Found/);
  assert.doesNotMatch(shown(missing), /Standalone/);
  for (const response of [{}, [], { ...stackResponse(902, prs), number: 903 }, { number: 902, pull_requests: {} }]) {
    const answer = await fixture(prs, prs[2], undefined, { stacks: { 902: response } }).load();
    assert.equal(answer.stack, null);
    assert.equal(answer.incomplete, true);
    assert.match(answer.notices.join(' '), /unreadable details for stack #902/);
  }
  const offline = await withGithubStack(prs, prs[2], (url) => {
    if (url.pathname.includes('/stacks/')) throw Object.assign(new Error('x'), { stderr: 'error connecting to api' });
  }).load();
  assert.match(offline.notices.join(' '), /could not be reached/);
  for (const stack of [{ number: 'x' }, { number: 902, position: 5, size: 4 }, { number: 902 }, 'stack']) {
    const malformed = { ...prs[2], stack };
    const { load, calls } = fixture([malformed], malformed);
    const answer = await load();
    assert.equal(answer.stack, null);
    assert.equal(answer.incomplete, true);
    assert.match(answer.notices.join(' '), /stack .*could not be read/);
    assert.ok(!calls.some((call) => call.includes('/stacks/')));
  }
});

test('a large GitHub stack stays bounded around the current PR', async () => {
  const prs = Array.from({ length: 30 }, (_, index) =>
    inStack(pr(index + 1, `part-${index + 1}`), { number: 902, position: index + 1, size: 30 })
  );
  const { load, calls } = fixture(prs, prs[27], undefined, { stacks: { 902: stackResponse(902, prs) } });
  const answer = await load();
  assert.equal(answer.count, 24);
  assert.equal(answer.stack.size, 30);
  assert.ok(answer.roots.some((row) => row.url === prs[27].html_url));
  assert.deepEqual(
    answer.roots.map((row) => row.position),
    Array.from({ length: 24 }, (_, index) => index + 7)
  );
  assert.equal(answer.incomplete, true);
  assert.match(answer.notices.join(' '), /24 of the 30/);
  assert.equal(calls.length, 2);
});

test('a branch stack retargeted after its bottom PR merged says so instead of standalone', async () => {
  for (const event of ['automatic_base_change_succeeded', 'base_ref_changed']) {
    const [a, b] = chain();
    Object.assign(a, { state: 'closed', merged_at: '2026-10-31T08:24:50Z' });
    // GitHub moved b from a's branch to main when a merged; the REST event does not say from where.
    b.base = { ...b.base, ref: 'main', sha: sha(0) };
    const { load, calls } = fixture([a, b], b, undefined, {
      events: { 4: [issueEvent('labeled', 1), issueEvent(event, 2)] },
    });
    const answer = await load();
    assert.equal(answer.count, 1);
    assert.equal(answer.stack, null);
    assert.equal(answer.roots[0].relationship.kind, 'retargeted');
    assert.equal(answer.incomplete, true);
    assert.ok(calls.includes('repos/o/r/issues/4/events?per_page=100'));
    assert.doesNotMatch(shown(answer), /Standalone/);
    assert.match(shown(answer), /GitHub changed its base branch/);
    // The merged bottom PR has no dependents left to find by branch, so it is not called standalone either.
    const bottom = await fixture([a, b], a).load();
    assert.equal(bottom.count, 1);
    assert.equal(bottom.roots[0].state, 'merged');
    assert.doesNotMatch(shown(bottom), /Standalone/);
    assert.match(shown(bottom), /retargeted when it merged/);
  }
});

test('a PR in no stack is standalone only after its base history is checked', async () => {
  const alone = pr(1, 'alone');
  const { load, calls } = fixture([alone], alone, undefined, {
    events: { 1: [issueEvent('labeled', 1), issueEvent('head_ref_force_pushed', 2)] },
  });
  const answer = await load();
  assert.equal(answer.stack, null);
  assert.equal(answer.incomplete, false);
  assert.equal(answer.roots[0].relationship.kind, 'base');
  assert.ok(calls.includes('repos/o/r/issues/1/events?per_page=100'));
  assert.match(shown(answer), /Standalone pull request/);
  assert.match(shown(answer), /main Base branch/);
  const failed = await fixture([alone], alone, (url) => {
    if (url.pathname.endsWith('/events')) throw new Error('offline');
  }).load();
  assert.equal(failed.incomplete, true);
  assert.match(failed.notices.join(' '), /base branch history of #1 could not be checked/);
  const long = await fixture([alone], alone, undefined, {
    events: { 1: Array.from({ length: 100 }, (_, id) => issueEvent('labeled', id)) },
  }).load();
  assert.equal(long.incomplete, true);
  assert.match(long.notices.join(' '), /could not be fully checked/);
  const unreadable = await fixture([alone], alone, (url) => (url.pathname.endsWith('/events') ? {} : undefined)).load();
  assert.equal(unreadable.incomplete, true);
});

// The PR numbers of the rows, top to bottom.
const order = (answer) =>
  [...markup(stackContent(answer)).matchAll(/pr-stack-number">#(\d+)</g)].map(([, n]) => Number(n));
const heading = (answer) =>
  markup(stackHeading(answer))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

test('the header names the stack, how many PRs it has and how many merged', async () => {
  const prs = githubStack();
  assert.equal(heading(await withGithubStack(prs, prs[2]).load()), 'Stack #902 4 pull requests 3 of 4 merged');
  assert.equal(heading(await fixture(chain(), chain()[1]).load()), 'Stacked by branch 3 pull requests 0 of 3 merged');
  assert.equal(heading(await fixture([pr(1, 'alone')]).load()), '1 pull request');
  assert.equal(heading(null), 'PR stack');
  // Read as text, as a screen reader does, the words keep their spaces.
  const text = (value) =>
    markup(value)
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ');
  const answer = await withGithubStack(prs, prs[2]).load();
  assert.match(text(stackHeading(answer)), /Stack #902 4 pull requests 3 of 4 merged/);
  assert.match(text(stackContent(answer)), /#869 Pull request 869 Current Merged content-page-layouts 3 of 4/);
  assert.equal(heading({ current: null, roots: [], count: 0, notices: [] }), 'PR stack');
});

test('a GitHub stack reads top first, down its rail to the base branch, with the current PR marked once', async () => {
  const prs = githubStack();
  const answer = await withGithubStack(prs, prs[2]).load();
  assert.deepEqual(order(answer), [870, 869, 867, 866]);
  const text = shown(answer);
  assert.match(text, /#870 Pull request 870 Open page-preview 4 of 4 /);
  assert.match(text, /#869 Pull request 869 Current Merged content-page-layouts 3 of 4 /);
  assert.match(text, /#866 .* main Base branch $/);
  assert.equal(text.match(/Current/g).length, 1);
  const html = markup(stackContent(answer));
  assert.equal(html.match(/aria-current="true"/g).length, 1);
  assert.match(html, /aria-current="true"[^>]*>\s*<span class="pr-stack-mark">/);
  assert.match(html, /<li class="pr-stack-node" data-state="merged"\s*>/);
  // Each row opens its PR, and its tooltip has the whole title and both branches.
  assert.match(
    html,
    /href="https:\/\/github.com\/o\/r\/pull\/869"\s+title="#869 Pull request 869&#10;content-page-layouts into main"/
  );
  assert.doesNotMatch(text, /Standalone|Depends on/);
});

test('a GitHub stack whose order is unknown shows its PRs by number, unconnected and without positions', async () => {
  const prs = githubStack();
  const swapped = stackResponse(902, [prs[0], prs[2], prs[1], prs[3]]);
  const answer = await fixture(prs, prs[2], undefined, { stacks: { 902: swapped } }).load();
  assert.match(markup(stackContent(answer)), /class="pr-stack-chain pr-stack-unordered"/);
  assert.doesNotMatch(shown(answer), / of 4/);
  assert.match(shown(answer), /order of GitHub stack #902 could not be confirmed/);
});

// The step bar's segments, left to right: [state, current].
const steps = (answer) =>
  [...markup(stackHeading(answer)).matchAll(/<i\s+data-state="(\w+)"[^>]*?(\sdata-current)?\s*><\/i>/g)].map(
    ([, state, current]) => (current ? `${state}*` : state)
  );

test('a GitHub stack shows its steps bottom to top under the header, the current one marked', async () => {
  const prs = githubStack();
  for (const [index, current] of prs.entries()) {
    const answer = await withGithubStack(prs, current).load();
    const want = ['merged', 'merged', 'merged', 'open'];
    want[index] += '*';
    assert.deepEqual(steps(answer), want);
  }
  const html = markup(stackHeading(await withGithubStack(prs, prs[2]).load()));
  assert.match(html, /<span class="pr-stack-steps" aria-hidden="true">/);
  assert.match(html, /title="3 of 4: #869, Merged"\s+data-current\s*>/);
  // A draft keeps its own state in the bar too.
  prs[3].draft = true;
  assert.deepEqual(steps(await withGithubStack(prs, prs[3]).load()), ['merged', 'merged', 'merged', 'draft*']);
});

test('steps are shown only where GitHub confirmed the order', async () => {
  const prs = githubStack();
  const swapped = stackResponse(902, [prs[0], prs[2], prs[1], prs[3]]);
  const unordered = await fixture(prs, prs[2], undefined, { stacks: { 902: swapped } }).load();
  assert.deepEqual(steps(unordered), []);
  assert.doesNotMatch(markup(stackContent(unordered)), /pr-stack-position/);
  const branches = await fixture(chain(), chain()[1]).load();
  assert.deepEqual(steps(branches), []);
  assert.doesNotMatch(markup(stackContent(branches)), /pr-stack-position/);
  assert.deepEqual(steps(await fixture([pr(1, 'alone')]).load()), []);
});

test('a bounded GitHub stack says how many PRs it leaves out above and below', async () => {
  const prs = Array.from({ length: 30 }, (_, index) =>
    inStack(pr(index + 1, `part-${index + 1}`), { number: 902, position: index + 1, size: 30 })
  );
  const answer = await fixture(prs, prs[27], undefined, { stacks: { 902: stackResponse(902, prs) } }).load();
  assert.equal(heading(answer), 'Stack #902 24 of 30 pull requests 0 of 24 merged');
  // Every step of the stack has its segment; those not shown are blank.
  const bar = steps(answer);
  assert.equal(bar.length, 30);
  assert.deepEqual(bar.slice(0, 6), Array(6).fill('hidden'));
  assert.equal(bar[27], 'open*');
  const text = shown(answer);
  assert.match(text, /^ ?Some relationships are unknown Only 24 of the 30/);
  assert.doesNotMatch(text, /pull requests? above/, 'nothing is left out above the top one');
  assert.match(text, /#7 Pull request 7 Open part-7 7 of 30 … 6 pull requests below, not shown main Base branch/);
  const middle = await fixture(prs, prs[10], undefined, { stacks: { 902: stackResponse(902, prs) } }).load();
  assert.match(shown(middle), /… 6 pull requests above, not shown #24 /);
  assert.doesNotMatch(shown(middle), /below, not shown/);
});

test('a branch stack keeps a line to one dependent and sets several apart, each on its own', async () => {
  const [a, b, c] = chain();
  const line = await fixture([a, b, c], b).load();
  assert.deepEqual(order(line), [2, 4, 8]);
  assert.doesNotMatch(shown(line), /Depends on/);
  assert.match(shown(line), /#8 .* main Base branch $/);
  const sibling = pr(3, 'other-feature', 'foundation', { base: { ...a.head } });
  const forked = await fixture([a, b, c, sibling], b).load();
  assert.deepEqual(order(forked), [3, 2, 4, 8]);
  const html = markup(stackContent(forked));
  assert.match(html, /<li class="pr-stack-fork">\s*<span class="pr-stack-caption">Depends on #8<\/span>/);
  // #3 and #4 are siblings: each is its own chain inside the fork, and #2 continues #4's.
  const fork = html.slice(html.indexOf('pr-stack-fork'), html.lastIndexOf('pull/8"'));
  assert.equal(fork.match(/<ol class="pr-stack-chain">/g).length, 2);
  assert.match(fork, /pull\/3"[\s\S]*<\/ol>\s*<ol class="pr-stack-chain">[\s\S]*pull\/2"[\s\S]*pull\/4"/);
});

test('a chain without a confirmed parent ends in what is known of it, never a base branch', async () => {
  const [a, b] = chain();
  const duplicate = { ...a, number: 9, html_url: 'https://github.com/o/r/pull/9' };
  const ambiguous = await fixture([a, duplicate, b], b).load();
  const html = markup(stackContent(ambiguous));
  assert.match(html, /<li class="pr-stack-end" data-kind="ambiguous">/);
  assert.match(
    shown(ambiguous),
    /foundation Multiple possible parents; order unknown\. Possible parents: #8 , #9 \. $/
  );
  assert.match(html, /<a href="https:\/\/github.com\/o\/r\/pull\/9">#9<\/a>/);
  assert.doesNotMatch(shown(ambiguous), /Base branch/);
  const partial = await fixture([a, b], b, (url) => {
    if (url.searchParams.has('head')) throw new Error('offline');
  }).load();
  assert.match(shown(partial), /foundation Parent relationship could not be confirmed\. $/);
});

test('rows show their own part of a shared branch prefix, and the whole branch on hover', () => {
  const rows = ['octo/topic/1-first', 'octo/topic/2-second', 'octo/topic-two'].map((ref, index) =>
    normalized(pr(index + 1, ref))
  );
  const answer = (prs) =>
    stackForest(prs[0], prs, new Map(prs.map((item) => [item.url, { kind: 'base', candidates: [] }])));
  const two = shown(answer(rows.slice(0, 2)));
  assert.match(two, /…\/1-first/);
  assert.match(two, /…\/2-second/);
  assert.match(
    markup(stackContent(answer(rows.slice(0, 2)))),
    /title="#1 Pull request 1&#10;octo\/topic\/1-first into main"/
  );
  // Only a whole segment is shortened.
  assert.match(shown(answer(rows)), /…\/topic\/1-first .* …\/topic-two/);
  assert.match(shown(answer(rows.slice(0, 1))), /octo\/topic\/1-first/);
});

test('titles and branches are text, never markup', () => {
  const evil = normalized(pr(1, '<img src=x onerror=alert(1)>', 'main', { title: '<script>alert(1)</script>' }));
  const html = markup(stackContent(stackForest(evil, [evil], new Map([[evil.url, { kind: 'base', candidates: [] }]]))));
  assert.doesNotMatch(html, /<script|<img/);
  assert.match(html, /&lt;script&gt;/);
});

// ---- how the checks of each PR stand ------------------------------------------------------------

// A stack of five-digit PRs, as a busy repository has: the bottom one merged, then one passing, one failing, one
// running and a draft with no checks at all on top.
const checkedStack = () =>
  [
    pr(34350, 'cart/1-totals', 'main', { state: 'closed', merged_at: '2026-11-10T10:00:00Z' }),
    pr(34351, 'cart/2-tax-lines'),
    pr(34352, 'cart/3-rounding'),
    pr(34353, 'cart/4-receipt'),
    pr(34354, 'cart/5-help', 'main', { draft: true }),
  ].map((item, index, all) => inStack(item, { number: 902, position: index + 1, size: all.length }));
const CHECKS = {
  34350: [checkRun('test', 'FAILURE')],
  34351: [checkRun('lint', 'SUCCESS'), checkRun('test', 'SUCCESS')],
  34352: [checkRun('lint', 'SUCCESS'), checkRun('test', 'FAILURE')],
  34353: [checkRun('lint', 'SUCCESS'), checkRun('test', null, { status: 'IN_PROGRESS' })],
};
const checksOf = (answer) => Object.fromEntries(answer.roots.map((row) => [row.number, row.checks ?? null]));

test('each open PR of a stack says how its checks stand, all from one GraphQL request', async () => {
  const prs = checkedStack();
  const known = { checks: { failing: 0, pending: 0, passed: 4 } };
  const { load, calls, graphql } = withGithubStack(prs, prs[3], undefined, { checks: CHECKS, known });
  const answer = await load();
  assert.deepEqual(checksOf(answer), {
    34350: null, // merged: its checks no longer matter, and are not asked about
    34351: { failing: 0, pending: 0, passed: 2 },
    34352: { failing: 1, pending: 0, passed: 1 },
    34353: { failing: 0, pending: 0, passed: 4 }, // the conversation's own, as the contact list just heard it
    34354: null, // a draft with no checks
  });
  assert.deepEqual(calls, ['repos/o/r/pulls/34353', 'repos/o/r/stacks/902'], 'the stack itself, as before');
  assert.equal(graphql.length, 1);
  const [args] = graphql;
  assert.deepEqual(args.slice(0, 4), ['api', 'graphql', '--hostname', 'github.com']);
  assert.deepEqual(args.slice(-4), ['-f', 'owner=o', '-f', 'name=r']);
  const query = args[5];
  assert.deepEqual(
    [...query.matchAll(/pr(\d+): pullRequest/g)].map(([, number]) => Number(number)),
    [34351, 34352, 34354],
    'the open ones but the conversation’s own'
  );
  assert.equal(answer.checksNote, undefined);
});

test('checks are counted as the contact list counts them: each once, as its latest run left it', async () => {
  const prs = checkedStack();
  const checks = {
    34352: [
      checkRun('test', 'FAILURE', { at: '2026-11-13T09:00:00Z' }),
      checkRun('test', 'SUCCESS', { at: '2026-11-13T09:05:00Z' }), // run again, and passed
      checkRun('test', 'FAILURE', { workflow: 'Nightly' }), // the same name in another workflow is another check
      checkRun('docs', 'SKIPPED'),
      { __typename: 'StatusContext', context: 'ci/legacy', state: 'PENDING' },
      null,
    ],
  };
  const answer = await withGithubStack(prs, prs[1], undefined, { checks }).load();
  assert.deepEqual(checksOf(answer)[34352], { failing: 1, pending: 1, passed: 1 });
});

test('with no other PR still to be merged, GitHub is not asked about checks at all', async () => {
  const prs = githubStack();
  const { load, graphql } = withGithubStack(prs, prs[3], undefined, {
    known: { checks: { failing: 1, pending: 0, passed: 0 } },
  });
  const answer = await load();
  assert.equal(graphql.length, 0);
  assert.deepEqual(checksOf(answer)[870], { failing: 1, pending: 0, passed: 0 });
});

test('checks that cannot be had leave the stack as it is, and say so under it', async () => {
  const prs = checkedStack();
  for (const checks of [
    () => ({ errors: [{ message: 'Something went wrong' }] }),
    () => {
      throw Object.assign(new Error('gh failed'), { stderr: 'HTTP 502' });
    },
  ]) {
    const answer = await withGithubStack(prs, prs[3], undefined, { checks }).load();
    assert.equal(answer.checksNote, 'The checks of the other pull requests could not be loaded. Refresh to try again.');
    assert.equal(answer.count, 5);
    assert.ok(answer.roots.every((row) => !row.checks));
    assert.match(shown(answer), /could not be loaded\. Refresh to try again\. .*#34354/);
  }
});

test('a large stack still asks no more than 60 requests in all, its checks included', async () => {
  const prs = [pr(1, 'branch-1')];
  for (let number = 2; number <= 35; number++)
    prs.push(pr(number, `branch-${number}`, '', { base: { ...prs.at(-1).head } }));
  const { load, calls, graphql } = fixture(prs, prs[0], undefined, { checks: { 2: [checkRun('test', 'FAILURE')] } });
  const answer = await load();
  assert.ok(calls.length + graphql.length <= 60, `${calls.length} + ${graphql.length}`);
  assert.ok(graphql.length <= 1);
  // A GitHub stack of 24 shown takes three: the PR, its stack, and the checks of all the others.
  const many = Array.from({ length: 30 }, (_, index) =>
    inStack(pr(40000 + index, `part-${index}`), { number: 902, position: index + 1, size: 30 })
  );
  const big = withGithubStack(many, many[27]);
  await big.load();
  assert.deepEqual([big.calls.length, big.graphql.length], [2, 1]);
  assert.equal(
    [...big.graphql[0][5].matchAll(/pullRequest\(/g)].length,
    23,
    'the 24 shown, but the conversation’s own'
  );
  assert.ok(answer.count <= 24);
});

test('a stack row wears its checks as the contact list does, and a failing one is found at a glance', async () => {
  const prs = checkedStack();
  const known = { checks: { failing: 0, pending: 0, passed: 4 } };
  const answer = await withGithubStack(prs, prs[3], undefined, { checks: CHECKS, known }).load();
  const html = markup(stackContent(answer));
  const node = (number) =>
    new RegExp(`<li class="pr-stack-node"[^>]*>\\s*<a[^>]*pull/${number}"[\\s\\S]*?</li>`).exec(html)[0];
  assert.match(node(34352), /^<li class="pr-stack-node" data-state="open"\s+data-checks="failing">/);
  assert.match(
    node(34352),
    /<span class="pr-tag pr-stack-checks" data-kind="failing"><svg[^>]*>.*<\/svg>1 failing<\/span>/
  );
  assert.match(
    node(34352),
    /title="#34352 Pull request 34352&#10;cart\/3-rounding into main&#10;1 check failing\. Click to see its checks\."/
  );
  assert.match(node(34353), /data-checks="passed">[\s\S]*data-kind="passed"[^>]*>.*Passed<\/span>/);
  assert.match(node(34351), /data-kind="passed"/);
  assert.doesNotMatch(node(34350), /data-checks|pr-tag/, 'merged: no checks');
  assert.doesNotMatch(node(34354), /data-checks|pr-tag/, 'no checks: nothing said');
  assert.match(shown(answer), /#34352 Pull request 34352 Open …\/3-rounding 1 failing 3 of 5/);
});

test('the step bar colours a PR still to be merged by its checks, and says them on each step', async () => {
  const prs = checkedStack();
  const known = { checks: { failing: 0, pending: 1, passed: 1 } };
  const answer = await withGithubStack(prs, prs[3], undefined, { checks: CHECKS, known }).load();
  const html = markup(stackHeading(answer));
  const checksAt = [...html.matchAll(/<i\s+data-state="(\w+)"\s*(?:data-checks="(\w+)")?/g)].map(([, state, checks]) =>
    checks ? `${state}:${checks}` : state
  );
  assert.deepEqual(checksAt, ['merged', 'open:passed', 'open:failing', 'open:running', 'draft:none']);
  assert.match(html, /title="3 of 5: #34352, Open, 1 check failing"/);
  assert.match(html, /title="4 of 5: #34353, Open, checks running"\s+data-current/);
  assert.match(html, /title="5 of 5: #34354, Draft"/);
});

test('a click on a failing row shows its checks beside the conversation; any other row opens GitHub', async (t) => {
  page(t);
  const prs = checkedStack();
  const answer = await withGithubStack(prs, prs[3], undefined, { checks: CHECKS }).load();
  const opened = [];
  const shownChecks = [];
  const view = new PrStack(
    { shows: () => true },
    { contactId: 'c' },
    { list: async () => answer, open: (url) => opened.push(url), checks: (pr) => shownChecks.push(pr) }
  );
  await view.refresh();
  const row = (number) =>
    view.content
      .querySelectorAll('.pr-stack-row')
      .find((link) => link.getAttribute('href') === `https://github.com/o/r/pull/${number}`);
  row(34352).querySelector('.pr-stack-title').click();
  assert.deepEqual(shownChecks, [
    { url: 'https://github.com/o/r/pull/34352', number: 34352, title: 'Pull request 34352' },
  ]);
  row(34351).click();
  row(34350).click();
  assert.deepEqual(opened, ['https://github.com/o/r/pull/34351', 'https://github.com/o/r/pull/34350']);
  assert.equal(shownChecks.length, 1);
});
