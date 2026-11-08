import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ghProblem, ghTrouble, listOpen, lookUp, parseItem, parseList, parsePull } from '../src/main/github-lookup.js';
import { tempDir } from './fixtures/temp-dir.js';

// The lookup runs in the project's folder, so it wants one that exists.
const FOLDER = tempDir('cm-lookup-');

// What `gh issue view --json number,title,body,url,state` prints.
const ISSUE = (fields = {}) =>
  JSON.stringify({
    body: 'After signing in you land on /home.',
    number: 123,
    state: 'OPEN',
    title: 'Fix login redirect',
    url: 'https://github.com/acme/shop/issues/123',
    ...fields,
  });

// What it prints for a number that is a pull request: the same fields, and an address under /pull/.
const AS_ISSUE = (fields = {}) =>
  ISSUE({
    body: 'Shows the branch and the cost.',
    number: 45,
    title: 'Add a hover card',
    url: 'https://github.com/acme/shop/pull/45',
    ...fields,
  });

// What `gh pr view --json …` prints, here for a branch in the repository itself.
const PULL = (fields = {}) =>
  JSON.stringify({
    body: 'Shows the branch and the cost.',
    headRefName: 'feature/hover-card',
    headRepository: { id: 'R_1', name: 'shop', nameWithOwner: 'acme/shop' },
    headRepositoryOwner: { id: 'O_1', login: 'acme' },
    isCrossRepository: false,
    isDraft: false,
    number: 45,
    state: 'OPEN',
    title: 'Add a hover card',
    url: 'https://github.com/acme/shop/pull/45',
    ...fields,
  });

const FROM_FORK = {
  headRefName: 'patch-1',
  headRepository: { id: 'R_2', name: 'shop', nameWithOwner: 'octocat/shop' },
  headRepositoryOwner: { id: 'U_2', login: 'octocat', name: 'The Octocat' },
  isCrossRepository: true,
};

/** A failure as execFile reports it, with what `gh` wrote before it gave up. */
const failed = (stderr, fields = { code: 1 }) =>
  Object.assign(new Error(`Command failed: gh\n${stderr}`), { stderr, killed: false, ...fields });

const NOT_FOUND = () =>
  failed('GraphQL: Could not resolve to an issue or pull request with the number of 123. (repository.issue)\n');

/** A `gh` that gives the queued answers in turn (an Error is a failure) and notes what it was asked. */
function gh(...answers) {
  const calls = [];
  const run = async (cwd, args) => {
    calls.push({ cwd, args });
    assert.ok(answers.length, `gh was asked more than expected: ${args.join(' ')}`);
    const answer = answers.shift();
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { run, calls };
}

const find = (text, ...answers) => {
  const { run, calls } = gh(...answers);
  return { calls, found: lookUp(FOLDER, text, { run }) };
};

// ---- an issue -------------------------------------------------------------------------------------

test('an issue is asked of gh by its number, in the folder of the project', async () => {
  const { calls, found } = find('123', ISSUE());
  assert.deepEqual(await found, {
    kind: 'issue',
    number: 123,
    title: 'Fix login redirect',
    body: 'After signing in you land on /home.',
    url: 'https://github.com/acme/shop/issues/123',
    state: 'open',
  });
  assert.deepEqual(calls, [{ cwd: FOLDER, args: ['issue', 'view', '123', '--json', 'number,title,body,url,state'] }]);
});

test('a number, a number with its # and a link all ask for the same issue', async () => {
  for (const text of [
    '123',
    '#123',
    ' #123 ',
    'https://github.com/acme/shop/issues/123',
    'github.com/acme/shop/issues/123',
  ]) {
    const { calls, found } = find(text, ISSUE());
    assert.equal((await found).number, 123, text);
    assert.equal(calls[0].args[2], '123', text);
  }
});

test('a closed issue is found like any other, and says that it is closed', async () => {
  const closed = await find('123', ISSUE({ state: 'CLOSED', stateReason: 'NOT_PLANNED' })).found;
  assert.equal(closed.state, 'closed');
  assert.equal(closed.kind, 'issue');
});

test('an issue without a description has an empty body', async () => {
  assert.equal((await find('123', ISSUE({ body: '' })).found).body, '');
  assert.equal((await find('123', ISSUE({ body: null })).found).body, '');
  assert.equal((await find('123', ISSUE({ body: undefined, title: undefined })).found).title, '');
});

// ---- a pull request -------------------------------------------------------------------------------

test('a number that is a pull request is asked about again, for its branch', async () => {
  const { calls, found } = find('#45', AS_ISSUE(), PULL());
  assert.deepEqual(await found, {
    kind: 'pull',
    number: 45,
    title: 'Add a hover card',
    body: 'Shows the branch and the cost.',
    url: 'https://github.com/acme/shop/pull/45',
    state: 'open',
    branch: 'feature/hover-card',
    fork: null,
  });
  assert.deepEqual(
    calls.map((call) => call.args.slice(0, 4)),
    [
      ['issue', 'view', '45', '--json'],
      ['pr', 'view', '45', '--json'],
    ]
  );
  for (const field of ['headRefName', 'headRepository', 'isCrossRepository', 'isDraft', 'state', 'body']) {
    assert.ok(calls[1].args[4].split(',').includes(field), field);
  }
  assert.equal(calls[1].cwd, FOLDER);
});

test('a link is taken for what the number turns out to be, whatever it calls it', async () => {
  // GitHub shows a pull request under /issues/ too, and the other way round.
  const pull = await find('https://github.com/acme/shop/issues/45', AS_ISSUE(), PULL()).found;
  assert.deepEqual([pull.kind, pull.branch], ['pull', 'feature/hover-card']);
  const { calls, found } = find('https://github.com/acme/shop/pull/123/files', ISSUE());
  assert.equal((await found).kind, 'issue');
  assert.equal(calls.length, 1, 'an issue needs no second question');
});

test('a draft, a merged and a closed pull request are all found, and say which they are', async () => {
  const state = async (fields) => (await find('45', AS_ISSUE(), PULL(fields)).found).state;
  assert.equal(await state({ isDraft: true }), 'draft');
  assert.equal(await state({ state: 'MERGED' }), 'merged');
  assert.equal(await state({ state: 'CLOSED' }), 'closed');
  assert.equal(await state({ state: 'CLOSED', isDraft: true }), 'closed', 'closed wins over draft');
});

test('a pull request from a fork names the fork', async () => {
  const fork = async (fields) => (await find('45', AS_ISSUE(), PULL({ ...FROM_FORK, ...fields })).found).fork;
  assert.equal(await fork({}), 'octocat/shop');
  // An older gh says the owner and the name apart.
  assert.equal(await fork({ headRepository: { id: 'R_2', name: 'shop-fork' } }), 'octocat/shop-fork');
  // The fork was deleted: there is still a pull request, with nowhere to push to.
  assert.equal(await fork({ headRepository: null, headRepositoryOwner: null }), '');
  assert.equal((await find('45', AS_ISSUE(), PULL(FROM_FORK)).found).branch, 'patch-1');
});

test('what gh really printed for a pull request from a fork is read', () => {
  // gh 2.101.0, `gh pr view 14592 -R cli/cli --json …`, with the body left out.
  const printed =
    '{"headRefName":"docs/nix-installation-nix-shell","headRepository":{"id":"R_kgDOU7ETyw","name":"cli","nameWithOwner":"reginaldalfret/cli"},"headRepositoryOwner":{"id":"U_kgDOC1ULzQ","name":"Reginald Alfret V","login":"reginaldalfret"},"isCrossRepository":true,"isDraft":false,"maintainerCanModify":false,"number":14592,"state":"MERGED","title":"docs: recommend nix-shell and declarative config for Nix/NixOS","url":"https://github.com/cli/cli/pull/14592"}';
  assert.deepEqual(parsePull(printed), {
    kind: 'pull',
    number: 14592,
    title: 'docs: recommend nix-shell and declarative config for Nix/NixOS',
    body: '',
    url: 'https://github.com/cli/cli/pull/14592',
    state: 'merged',
    branch: 'docs/nix-installation-nix-shell',
    fork: 'reginaldalfret/cli',
  });
});

// ---- a link to somewhere else ---------------------------------------------------------------------

test('a link to another repository is refused, and says which two', async () => {
  // The same number exists here too: what came back is not what the link is for.
  const { calls, found } = find('https://github.com/other/thing/issues/123', ISSUE());
  await assert.rejects(found, {
    message: 'That link is for other/thing, but this project is acme/shop on GitHub.',
  });
  assert.equal(calls.length, 1);
  await assert.rejects(
    find('https://github.com/other/thing/pull/45', AS_ISSUE()).found,
    /That link is for other\/thing/
  );
});

test('a link to this project is fine whatever its capitals', async () => {
  assert.equal((await find('https://github.com/Acme/SHOP/issues/123', ISSUE()).found).number, 123);
});

test('when the number of a link is not found here, gh is asked which repository this is', async () => {
  const link = 'https://github.com/other/thing/issues/123';
  const { calls, found } = find(link, NOT_FOUND(), '{"nameWithOwner":"acme/shop"}');
  await assert.rejects(found, { message: 'That link is for other/thing, but this project is acme/shop on GitHub.' });
  assert.deepEqual(calls[1].args, ['repo', 'view', '--json', 'nameWithOwner']);

  // The link is for this project after all: the number is simply not there.
  const here = 'https://github.com/acme/shop/issues/123';
  await assert.rejects(find(here, NOT_FOUND(), '{"nameWithOwner":"acme/shop"}').found, /no issue or pull request #123/);
  // And when gh can't say, that is what is known.
  await assert.rejects(find(link, NOT_FOUND(), failed('boom')).found, /no issue or pull request #123/);
  await assert.rejects(find(link, NOT_FOUND(), 'not json').found, /no issue or pull request #123/);
});

// ---- what can go wrong ----------------------------------------------------------------------------

test('a number that is neither is not found, in plain words', async () => {
  const { calls, found } = find('#123', NOT_FOUND());
  await assert.rejects(found, { message: 'There is no issue or pull request #123 in this project on GitHub.' });
  assert.equal(calls.length, 1, 'a bare number is not asked about twice');
});

test('gh missing, signed out, offline and too slow each say what to do', async () => {
  const says = (failure, pattern) => assert.rejects(find('123', failure).found, pattern);
  await says(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }), /GitHub CLI is not installed/);
  await says(
    failed('To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN…\n', {
      code: 4,
    }),
    /GitHub CLI is not signed in\. Click "Connect to GitHub" in the contact list, or run "gh auth login"/
  );
  await says(
    failed(
      'HTTP 401: Bad credentials (https://api.github.com/graphql)\nTry authenticating with:  gh auth login -h github.com\n'
    ),
    /not signed in/
  );
  await says(
    failed('error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com\n'),
    /GitHub could not be reached\. Check your internet connection/
  );
  await says(
    failed('Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host\n'),
    /could not be reached/
  );
  await says(failed('', { code: null, killed: true, signal: 'SIGTERM' }), /GitHub took too long to answer/);
});

test('what kept gh from answering is told apart, for whoever has more to do about it than say so', () => {
  assert.equal(ghProblem(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })), 'missing');
  assert.equal(
    ghProblem(failed('To get started with GitHub CLI, please run:  gh auth login\n', { code: 4 })),
    'signed-out'
  );
  assert.equal(ghProblem(failed('', { code: 4 })), 'signed-out', 'what it left with is enough');
  assert.equal(ghProblem(failed('Try authenticating with:  gh auth login -h github.com\n')), 'signed-out');
  assert.equal(ghProblem(failed('error connecting to api.github.com\n')), 'offline');
  assert.equal(ghProblem(failed('', { code: null, killed: true })), 'slow');
  for (const other of [failed('unknown flag: --nope\n'), new Error('boom'), null, undefined]) {
    assert.equal(ghProblem(other), null);
    assert.equal(ghTrouble(other), null);
  }
});

// What gh 2.101 says in a folder whose remotes are all elsewhere, such as on GitLab. It names `gh auth login`
// for a GitHub of a company's own, but no sign-in is missing.
const ELSEWHERE =
  'none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`\n';

test('a project that is not on GitHub says so', async () => {
  await assert.rejects(find('123', failed('no git remotes found\n')).found, /This project is not on GitHub/);
  await assert.rejects(
    find('123', failed('none of the git remotes configured for this repository point to a known GitHub host.\n')).found,
    /This project is not on GitHub/
  );
  await assert.rejects(find('123', failed(ELSEWHERE)).found, {
    message: 'This project is not on GitHub, so there is nothing to look up.',
  });
  assert.equal(ghProblem(failed(ELSEWHERE)), null, 'it is not a sign-in that is missing');
});

test('anything else gh complains about is passed on, in its last line', async () => {
  await assert.rejects(
    find('123', failed('first line\nHTTP 502: Bad Gateway (https://api.github.com/graphql)\n')).found,
    { message: 'GitHub could not look that up: HTTP 502: Bad Gateway (https://api.github.com/graphql)' }
  );
  await assert.rejects(find('123', new Error('something odd')).found, /could not look that up: something odd/);
});

test('a failure while asking for the branch of a pull request is explained the same way', async () => {
  await assert.rejects(
    find('45', AS_ISSUE(), failed('', { code: null, killed: true })).found,
    /GitHub took too long to answer/
  );
});

test('an answer that is not what was asked for is not made into an issue', async () => {
  const unreadable = /answer from GitHub could not be read/;
  for (const output of ['', 'not json', '{', '[]', 'null', '{}', '42', '"123"']) {
    await assert.rejects(find('123', output).found, unreadable, output);
  }
  await assert.rejects(find('123', ISSUE({ number: '123' })).found, unreadable, 'a number that is not one');
  await assert.rejects(find('123', ISSUE({ url: undefined })).found, unreadable);
  // The pull request's own answer can be the broken one.
  await assert.rejects(find('45', AS_ISSUE(), 'not json').found, unreadable);
  await assert.rejects(find('45', AS_ISSUE(), PULL({ headRefName: undefined })).found, unreadable);
  await assert.rejects(find('45', AS_ISSUE(), PULL({ headRefName: '' })).found, unreadable);
});

test('only a web address is ever handed to the windows as a link', () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'http://github.com/acme/shop/issues/123', 123]) {
    assert.equal(parseItem(ISSUE({ url })), null, String(url));
    assert.equal(parsePull(PULL({ url })), null, String(url));
  }
});

test('text that is not a number or a link is not asked of gh at all', async () => {
  for (const text of ['', 'fix login', 'acme/shop', 'https://github.com/acme/shop', undefined]) {
    const { calls, found } = find(text);
    await assert.rejects(found, /Type the number of an issue or pull request, such as 123, or paste its link/);
    assert.deepEqual(calls, []);
  }
});

test('without the folder of the project there is nowhere to ask', async () => {
  for (const cwd of ['', undefined, path.join(FOLDER, 'gone')]) {
    const { run, calls } = gh();
    await assert.rejects(lookUp(cwd, '123', { run }), /folder of this project is gone/);
    assert.deepEqual(calls, []);
  }
});

test('whatever is looked up, gh is only ever asked to show something', async () => {
  const asked = [];
  const watch = async (text, ...answers) => {
    const { calls, found } = find(text, ...answers);
    await found.catch(() => {});
    asked.push(...calls.map((call) => call.args));
  };
  await watch('123', ISSUE());
  await watch('45', AS_ISSUE(), PULL(FROM_FORK));
  await watch('https://github.com/other/thing/pull/123', NOT_FOUND(), '{"nameWithOwner":"acme/shop"}');
  await watch('123', failed('boom'));
  assert.equal(asked.length, 6);
  for (const args of asked) {
    assert.ok(['issue view', 'pr view', 'repo view'].includes(args.slice(0, 2).join(' ')), args.join(' '));
    assert.ok(args.includes('--json'), 'and to print it, not to open a browser');
    // The number is the only thing of the user's that reaches the command line.
    assert.equal(args.filter((arg) => /github\.com|other\/thing/.test(arg)).length, 0);
  }
});

// ---- the open ones, to choose from --------------------------------------------------------------

// What `gh pr list --json number,title,url,isDraft,author` prints, newest first.
const PULLS = JSON.stringify([
  {
    number: 50,
    title: 'Tidy the footer',
    url: 'https://github.com/acme/shop/pull/50',
    isDraft: false,
    author: { login: 'octocat' },
  },
  {
    number: 48,
    title: 'Add a hover card',
    url: 'https://github.com/acme/shop/pull/48',
    isDraft: true,
    author: { login: 'Me' },
  },
  {
    number: 45,
    title: 'Speed up search',
    url: 'https://github.com/acme/shop/pull/45',
    isDraft: false,
    author: { login: 'me' },
  },
]);
// What `gh issue list --json number,title,url,assignees` prints.
const ISSUES = JSON.stringify([
  { number: 52, title: 'Footer overlaps the cart', url: 'https://github.com/acme/shop/issues/52', assignees: [] },
  {
    number: 49,
    title: 'Fix login redirect',
    url: 'https://github.com/acme/shop/issues/49',
    assignees: [{ login: 'octocat' }, { login: 'me' }],
  },
]);

test('the open ones are listed, yours first and otherwise newest first', async () => {
  const { run, calls } = gh('me\n', PULLS, ISSUES);
  const { pulls, issues } = await listOpen(FOLDER, { run });
  assert.deepEqual(
    pulls.map(({ number, draft, mine }) => ({ number, draft, mine })),
    [
      { number: 48, draft: true, mine: true },
      { number: 45, draft: false, mine: true },
      { number: 50, draft: false, mine: false },
    ],
    'a login is the same login whatever its capitals'
  );
  assert.deepEqual(pulls[0], {
    kind: 'pull',
    number: 48,
    title: 'Add a hover card',
    url: 'https://github.com/acme/shop/pull/48',
    draft: true,
    mine: true,
  });
  assert.deepEqual(
    issues.map(({ kind, number, mine }) => ({ kind, number, mine })),
    [
      { kind: 'issue', number: 49, mine: true },
      { kind: 'issue', number: 52, mine: false },
    ],
    'an issue is yours when it is given to you'
  );
  assert.deepEqual(
    calls.map((call) => call.args.join(' ')),
    [
      'api user --jq .login',
      'pr list --state open --limit 30 --json number,title,url,isDraft,author',
      'issue list --state open --limit 30 --json number,title,url,assignees',
    ]
  );
  assert.ok(
    calls.every((call) => call.cwd === FOLDER),
    'asked in the project, for its repository'
  );
});

test('words are searched for on GitHub, in fewer of each', async () => {
  const { run, calls } = gh('me', '[]', ISSUES);
  const { pulls, issues } = await listOpen(FOLDER, { search: '  login  redirect ', run });
  assert.deepEqual(pulls, []);
  assert.equal(issues.length, 2);
  assert.deepEqual(calls[1].args.slice(-4), [
    '--json',
    'number,title,url,isDraft,author',
    '--search',
    'login  redirect',
  ]);
  assert.deepEqual(calls[2].args.slice(-2), ['--search', 'login  redirect']);
  assert.ok(calls.slice(1).every((call) => call.args.includes('20')));
});

test('without knowing who you are, the lists are as GitHub gives them', async () => {
  const { run } = gh(failed('boom'), PULLS, ISSUES);
  const { pulls, issues } = await listOpen(FOLDER, { run });
  assert.deepEqual(
    pulls.map((item) => item.number),
    [50, 48, 45]
  );
  assert.ok([...pulls, ...issues].every((item) => !item.mine));
});

test('when GitHub cannot be asked, the list says why', async () => {
  const cases = [
    [Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }), /GitHub CLI is not installed/],
    [failed('To get started with GitHub CLI, please run:  gh auth login\n', { code: 4 }), /not signed in/],
    [failed('no git remotes found\n'), /: This project is not on GitHub\.$/],
    [failed(ELSEWHERE), /: This project is not on GitHub\.$/],
    [failed('HTTP 502: Bad gateway\n'), /: GitHub could not list them: HTTP 502: Bad gateway$/],
  ];
  for (const [err, said] of cases) {
    const { run } = gh('me', err, ISSUES);
    await assert.rejects(listOpen(FOLDER, { run }), said);
  }
});

test('a list that cannot be read is said to be that, and entries without a page are left out', async () => {
  await assert.rejects(listOpen(FOLDER, gh('me', 'oops', ISSUES)), /could not be read/);
  assert.equal(parseList('{"number":1}', 'pull'), null);
  const kept = parseList(
    JSON.stringify([
      { number: 1, title: 'x', url: 'javascript:alert(1)' },
      { number: 'two', url: 'https://x.y/a/b/pull/2' },
      { number: 3, title: null, url: 'https://github.com/a/b/pull/3' },
    ]),
    'pull'
  );
  assert.deepEqual(kept, [
    { kind: 'pull', number: 3, title: '', url: 'https://github.com/a/b/pull/3', draft: false, mine: false },
  ]);
});

test('without the folder of the project there is no list to ask for', async () => {
  const { run, calls } = gh();
  await assert.rejects(listOpen(path.join(FOLDER, 'gone'), { run }), /folder of this project is gone/);
  assert.deepEqual(calls, []);
});

test('listing only ever asks gh to list, never to change anything', async () => {
  const { run, calls } = gh('me', PULLS, ISSUES);
  await listOpen(FOLDER, { run, search: 'pr close 12' });
  for (const { args } of calls) assert.ok(['api user', 'pr list', 'issue list'].includes(args.slice(0, 2).join(' ')));
  assert.ok(!calls[0].args.includes('--method'), 'and asks the API only who you are');
});
