import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cloneRepository, createProject, parseRepositories, recentRepositories } from '../src/main/projects.js';
import {
  cleanProjectName,
  githubAddress,
  matchingRepositories,
  parseRepository,
  PROJECT_NAME_MAX,
  projectFolderName,
} from '../src/shared/projects.js';
import { tempDir } from './fixtures/temp-dir.js';

const HAS_GIT = spawnSync('git', ['--version']).status === 0;
const opts = { skip: !HAS_GIT };

// macOS hands out temp folders through a symlink; git answers with the real path.
const tmp = () => fs.realpathSync(tempDir('cm-projects-'));
const IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false'];
const sh = (cwd, ...args) =>
  execFileSync('git', [...IDENTITY, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** The app's own way of running git, as someone who told git who they are. */
const git = (cwd, args) =>
  new Promise((resolve, reject) => {
    execFile('git', [...IDENTITY, ...args], { cwd, env: { ...process.env, LC_ALL: 'C' } }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr.trim().split(/\r?\n/).pop() || err.message)) : resolve(stdout.trim())
    );
  });

/** A failure as execFile reports it, with what `gh` wrote before it gave up. */
const failed = (stderr, fields = { code: 1 }) =>
  Object.assign(new Error(`Command failed: gh\n${stderr}`), { stderr, killed: false, ...fields });
const NOT_INSTALLED = () => Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
const SIGNED_OUT = () => failed('You are not logged into any GitHub hosts. To log in, run: gh auth login\n');

/** A stand-in for `gh` that answers each command with what `answers` says, and writes down what it was asked. */
function fakeGh(answers = {}) {
  const asked = [];
  const gh = async (cwd, args) => {
    asked.push({ cwd, args });
    const answer = answers[args.slice(0, 2).join(' ')] ?? answers[args[0]] ?? '';
    if (answer instanceof Error) throw answer;
    return typeof answer === 'function' ? answer(cwd, args) : answer;
  };
  return { gh, asked };
}

/** A remote with one commit on `main`, as an address git can clone. */
function remote(name = 'shop') {
  const root = tmp();
  const origin = path.join(root, `${name}.git`);
  sh(root, 'init', '--quiet', '--bare', '-b', 'main', origin);
  sh(root, 'clone', '--quiet', origin, 'seed');
  const seed = path.join(root, 'seed');
  fs.writeFileSync(path.join(seed, 'a.txt'), 'one');
  sh(seed, 'add', '.');
  sh(seed, 'commit', '--quiet', '-m', 'add a.txt');
  sh(seed, 'push', '--quiet', 'origin', 'HEAD:main');
  return `file://${origin}`;
}

// ---- what was typed for a repository -----------------------------------------------------------

test('an address is read for the folder its clone gets', () => {
  const cases = {
    'https://github.com/acme/shop.git': 'shop',
    'https://github.com/acme/shop': 'shop',
    'https://github.com/acme/shop/': 'shop',
    'http://git.example.com/team/my.app.git': 'my.app',
    'git@github.com:acme/shop.git': 'shop',
    'ssh://git@github.com/acme/shop.git': 'shop',
    'git://example.com/shop.git': 'shop',
    'file:///tmp/remotes/shop.git': 'shop',
  };
  for (const [typed, name] of Object.entries(cases)) {
    assert.deepEqual(parseRepository(typed), { name, slug: null, url: typed }, typed);
  }
  assert.deepEqual(parseRepository('  https://github.com/acme/shop.git  ').url, 'https://github.com/acme/shop.git');
});

test('a repository on GitHub can be written the short way', () => {
  assert.deepEqual(parseRepository('acme/shop'), { name: 'shop', slug: 'acme/shop', url: null });
  assert.deepEqual(parseRepository('acme/shop.git'), { name: 'shop', slug: 'acme/shop', url: null });
  assert.deepEqual(parseRepository('SafaElmali/buddylist').name, 'buddylist');
});

test('anything else is not a repository', () => {
  for (const typed of [
    '',
    '   ',
    null,
    undefined,
    'shop',
    'a/b/c',
    '/Users/you/shop',
    '--upload-pack=touch /tmp/x',
    '-u/x',
    'ext::sh -c "touch /tmp/x"',
    'https://github.com/acme/..',
    'https://github.com/acme/shop?tab=readme',
    'https://',
    'acme/',
  ]) {
    assert.equal(parseRepository(typed), null, String(typed));
  }
});

test('a repository on GitHub is cloned the way git reaches GitHub here', () => {
  assert.equal(githubAddress('acme/shop', 'ssh'), 'git@github.com:acme/shop.git');
  assert.equal(githubAddress('acme/shop', 'https'), 'https://github.com/acme/shop.git');
  assert.equal(githubAddress('acme/shop'), 'https://github.com/acme/shop.git');
});

// ---- the user's repositories -------------------------------------------------------------------

const LISTED = JSON.stringify([
  { full_name: 'acme/shop', description: 'The shop', private: true },
  { full_name: 'you/dotfiles', description: null, private: false },
]);

test('the list from GitHub is read, each repository with where to clone it from', () => {
  assert.deepEqual(parseRepositories(LISTED, 'ssh'), [
    { slug: 'acme/shop', description: 'The shop', private: true, address: 'git@github.com:acme/shop.git' },
    { slug: 'you/dotfiles', description: '', private: false, address: 'git@github.com:you/dotfiles.git' },
  ]);
  assert.equal(parseRepositories(LISTED, 'https')[0].address, 'https://github.com/acme/shop.git');
});

test('what is not a list of repositories is not read as one', () => {
  for (const output of ['', 'not json', '{}', 'null', '{"message":"Bad credentials"}']) {
    assert.equal(parseRepositories(output), null, output);
  }
  // A line that names no repository is left out.
  assert.deepEqual(parseRepositories(JSON.stringify([{ description: 'x' }, null, { full_name: 'bad name' }])), []);
});

test('the repositories are asked for newest first, and only what is listed of them', async () => {
  const { gh, asked } = fakeGh({ api: LISTED, 'config get': 'ssh\n' });
  const repos = await recentRepositories({ gh });
  assert.deepEqual(
    repos.map((r) => r.address),
    ['git@github.com:acme/shop.git', 'git@github.com:you/dotfiles.git']
  );
  const { args } = asked.find((call) => call.args[0] === 'api');
  assert.equal(args[1], 'user/repos?sort=pushed&per_page=100');
  assert.deepEqual(args.slice(2), ['--jq', '[.[] | {full_name, description, private}]']);
});

test('when gh was never told how git reaches GitHub, repositories are cloned over https', async () => {
  const { gh } = fakeGh({ api: LISTED, 'config get': failed('unknown key') });
  assert.equal((await recentRepositories({ gh }))[0].address, 'https://github.com/acme/shop.git');
});

test('why the repositories could not be listed is said in words', async () => {
  const cases = [
    [NOT_INSTALLED(), /GitHub CLI is not installed/],
    [SIGNED_OUT(), /not signed in\. Click "Connect to GitHub" in the contact list, or run "gh auth login"/],
    [failed('', { killed: true }), /took too long/],
    [failed('error connecting to api.github.com\n'), /could not be reached/],
    [failed('gh: Server Error (HTTP 500)\n'), /could not list your repositories: gh: Server Error \(HTTP 500\)/],
  ];
  for (const [failure, message] of cases) {
    await assert.rejects(recentRepositories({ gh: fakeGh({ api: failure }).gh }), message);
  }
  await assert.rejects(recentRepositories({ gh: fakeGh({ api: 'oops' }).gh }), /could not be read/);
});

test('the repositories are searched by name and description, in any letter case', () => {
  const repos = parseRepositories(LISTED);
  assert.deepEqual(
    matchingRepositories(repos, 'SHOP').map((r) => r.slug),
    ['acme/shop']
  );
  assert.deepEqual(
    matchingRepositories(repos, ' dot ').map((r) => r.slug),
    ['you/dotfiles']
  );
  assert.deepEqual(
    matchingRepositories(repos, 'the sh').map((r) => r.slug),
    ['acme/shop'],
    'found by its description'
  );
  assert.equal(matchingRepositories(repos, '  '), repos);
  assert.deepEqual(matchingRepositories(repos, 'nothing'), []);
});

// ---- cloning -----------------------------------------------------------------------------------

test('a repository is cloned into a folder of its own, named after it', opts, async () => {
  const parent = tmp();
  const folder = await cloneRepository({ repository: remote('shop'), parent });
  assert.equal(folder, path.join(parent, 'shop'));
  assert.equal(fs.readFileSync(path.join(folder, 'a.txt'), 'utf8'), 'one');
  assert.equal(sh(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
});

test('the folder to clone into is made when it is not there', opts, async () => {
  const parent = path.join(tmp(), 'code', 'work');
  const folder = await cloneRepository({ repository: remote('shop'), parent });
  assert.equal(folder, path.join(parent, 'shop'));
  assert.ok(fs.existsSync(path.join(folder, '.git')));
});

test('a repository is not cloned over a folder that is there already', opts, async () => {
  const parent = tmp();
  fs.mkdirSync(path.join(parent, 'shop'));
  fs.writeFileSync(path.join(parent, 'shop', 'mine.txt'), 'keep');
  await assert.rejects(
    cloneRepository({ repository: remote('shop'), parent }),
    /There is already a "shop" in .*Pick another folder/
  );
  assert.equal(fs.readFileSync(path.join(parent, 'shop', 'mine.txt'), 'utf8'), 'keep');
});

test('cloning needs an address that can be read and a folder to put it in', async () => {
  const ran = [];
  const run = async (...args) => ran.push(args);
  await assert.rejects(cloneRepository({ repository: 'shop', parent: tmp() }, { run }), /Type the address/);
  await assert.rejects(cloneRepository({ repository: '--mirror', parent: tmp() }, { run }), /Type the address/);
  for (const parent of ['', '   ', null, undefined, 'relative/folder']) {
    await assert.rejects(cloneRepository({ repository: 'acme/shop', parent }, { run }), /Pick the folder/);
  }
  const file = path.join(tmp(), 'notes.txt');
  fs.writeFileSync(file, '');
  await assert.rejects(cloneRepository({ repository: 'acme/shop', parent: file }, { run }), /is not a folder/);
  assert.deepEqual(ran, [], 'git was never asked');
});

test('a repository written the short way is cloned from GitHub, the way gh reaches it', async () => {
  const parent = tmp();
  for (const [protocol, address] of [
    ['ssh\n', 'git@github.com:acme/shop.git'],
    ['https\n', 'https://github.com/acme/shop.git'],
    [failed('no such key'), 'https://github.com/acme/shop.git'],
  ]) {
    const ran = [];
    const run = async (cwd, args) => ran.push({ cwd, args });
    const folder = await cloneRepository(
      { repository: 'acme/shop', parent },
      { gh: fakeGh({ 'config get': protocol }).gh, run }
    );
    assert.equal(folder, path.join(parent, 'shop'));
    // The address comes after "--", so nothing in it is taken for an option.
    assert.deepEqual(ran, [{ cwd: parent, args: ['clone', '--quiet', '--', address, folder] }]);
  }
});

test('an address typed in full is cloned as it is, without asking gh', async () => {
  const { gh, asked } = fakeGh();
  const ran = [];
  const parent = tmp();
  await cloneRepository(
    { repository: 'git@gitlab.com:team/api.git', parent },
    { gh, run: async (cwd, args) => ran.push(args) }
  );
  assert.deepEqual(ran, [['clone', '--quiet', '--', 'git@gitlab.com:team/api.git', path.join(parent, 'api')]]);
  assert.deepEqual(asked, []);
});

test('"~" in the folder to clone into is the user’s own folder', async () => {
  const ran = [];
  const name = `cm-projects-never-made-${process.pid}`;
  await cloneRepository(
    { repository: 'acme/shop', parent: `~/${name}` },
    { gh: fakeGh().gh, run: async (cwd, args) => ran.push(args.at(-1)) }
  );
  assert.deepEqual(ran, [path.join(os.homedir(), name, 'shop')]);
  fs.rmdirSync(path.join(os.homedir(), name));
});

test('why a clone failed is said in words', async () => {
  const cases = [
    ["could not read Username for 'https://github.com': terminal prompts disabled", /could not sign in to clone shop/],
    ['git@github.com: Permission denied (publickey).', /could not sign in to clone shop/],
    ['Repository not found.', /no repository at that address/],
    ["'/tmp/nowhere' does not appear to be a git repository", /no repository at that address/],
    ['unable to access: Could not resolve host: github.com', /could not be reached/],
    ['the remote end hung up unexpectedly', /shop could not be cloned: the remote end hung up unexpectedly/],
  ];
  for (const [said, message] of cases) {
    const run = async () => {
      throw new Error(said);
    };
    await assert.rejects(
      cloneRepository({ repository: 'acme/shop', parent: tmp() }, { gh: fakeGh().gh, run }),
      message
    );
  }
});

test('a clone that fails leaves no folder behind', opts, async () => {
  const parent = tmp();
  const gone = `file://${path.join(tmp(), 'nowhere.git')}`;
  await assert.rejects(cloneRepository({ repository: gone, parent }), /no repository at that address/);
  assert.deepEqual(fs.readdirSync(parent), []);
});

// ---- the name of a new project -----------------------------------------------------------------

test('a project’s folder is named the way GitHub would name its repository', () => {
  const cases = {
    'agent-playground': 'agent-playground',
    '  My App  ': 'My-App',
    'my app: v2!': 'my-app-v2',
    'notes_2026.final': 'notes_2026.final',
    '--force': 'force',
    'a/b\\c': 'a-b-c',
    '.github': '.github',
    café: 'caf',
  };
  for (const [typed, folder] of Object.entries(cases)) {
    assert.equal(projectFolderName(typed), folder, typed);
    assert.equal(cleanProjectName(typed), folder, typed);
  }
  assert.equal(projectFolderName('x'.repeat(PROJECT_NAME_MAX + 20)).length, PROJECT_NAME_MAX);
});

test('a project needs a name something can be made of', () => {
  for (const typed of ['', '   ', null, undefined, '.', '..', '...', '---', '!!!', '/']) {
    assert.equal(projectFolderName(typed), '', String(typed));
    assert.throws(() => cleanProjectName(typed), /Type a name for the project/);
  }
});

// ---- a project started from nothing ------------------------------------------------------------

test('a new project is a folder with a repository and a first commit in it', opts, async () => {
  const parent = tmp();
  const { gh, asked } = fakeGh();
  const folder = await createProject({ name: 'My Notes', parent }, { gh, run: git });
  assert.equal(folder, path.join(parent, 'My-Notes'));
  assert.equal(fs.readFileSync(path.join(folder, 'README.md'), 'utf8'), '# My-Notes\n');
  assert.equal(sh(folder, 'log', '--format=%s'), 'Initial commit');
  assert.equal(sh(folder, 'status', '--porcelain'), '', 'nothing is left uncommitted');
  // Its main line is called what the user calls theirs, and "main" when they never said.
  const own = spawnSync('git', ['config', '--get', 'init.defaultBranch'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(sh(folder, 'rev-parse', '--abbrev-ref', 'HEAD'), own || 'main');
  assert.deepEqual(asked, [], 'GitHub was not asked for anything');
});

test('the folder a new project goes in is made when it is not there', opts, async () => {
  const parent = path.join(tmp(), 'code', 'side');
  const folder = await createProject({ name: 'notes', parent }, { gh: fakeGh().gh, run: git });
  assert.equal(folder, path.join(parent, 'notes'));
  assert.ok(fs.existsSync(path.join(folder, '.git')));
});

test('with GitHub ticked, the project gets a private repository there, pushed from its folder', opts, async () => {
  const parent = tmp();
  const { gh, asked } = fakeGh();
  const folder = await createProject({ name: 'notes', parent, github: true }, { gh, run: git });
  assert.deepEqual(
    asked.map((call) => call.args),
    [
      ['auth', 'status'],
      ['repo', 'create', 'notes', '--private', '--source', '.', '--remote', 'origin', '--push'],
    ]
  );
  // Made from the project's folder, after its first commit: there is something to push.
  assert.equal(asked[1].cwd, folder);
  assert.equal(sh(folder, 'log', '--format=%s'), 'Initial commit');
});

test('signed out of GitHub, a project that wants a repository there is not started at all', async () => {
  for (const [failure, message] of [
    [SIGNED_OUT(), /not signed in\. Click "Connect to GitHub" in the contact list, or run "gh auth login"/],
    [NOT_INSTALLED(), /GitHub CLI is not installed/],
  ]) {
    const parent = tmp();
    const ran = [];
    await assert.rejects(
      createProject(
        { name: 'notes', parent, github: true },
        { gh: fakeGh({ 'auth status': failure }).gh, run: async (...args) => ran.push(args) }
      ),
      message
    );
    assert.deepEqual(fs.readdirSync(parent), [], 'no folder was made');
    assert.deepEqual(ran, []);
  }
});

test('when its repository can’t be made on GitHub, nothing of the project is left behind', opts, async () => {
  const cases = [
    [
      failed('GraphQL: Name already exists on this account (createRepository)\n'),
      /already have a repository called "notes" on GitHub/,
    ],
    [failed('error connecting to api.github.com\n'), /could not be reached/],
    [failed('HTTP 422: Validation Failed\n'), /could not be made on GitHub: HTTP 422: Validation Failed/],
  ];
  for (const [failure, message] of cases) {
    const parent = tmp();
    await assert.rejects(
      createProject({ name: 'notes', parent, github: true }, { gh: fakeGh({ 'repo create': failure }).gh, run: git }),
      message
    );
    assert.deepEqual(fs.readdirSync(parent), [], 'so the same name can be tried again');
  }
});

test('when the first commit can’t be made, nothing of the project is left behind either', async () => {
  const parent = tmp();
  const run = async (cwd, args) => {
    if (args[0] === 'commit') throw new Error('unable to auto-detect email address');
    return '';
  };
  await assert.rejects(
    createProject({ name: 'notes', parent }, { gh: fakeGh().gh, run }),
    /first commit could not be made: unable to auto-detect email address/
  );
  assert.deepEqual(fs.readdirSync(parent), []);
});

test('a new project is never made over a folder that is there already', async () => {
  const parent = tmp();
  fs.mkdirSync(path.join(parent, 'notes'));
  fs.writeFileSync(path.join(parent, 'notes', 'mine.txt'), 'keep');
  const ran = [];
  await assert.rejects(
    createProject({ name: 'notes', parent, github: true }, { gh: fakeGh().gh, run: async (...a) => ran.push(a) }),
    /There is already a "notes" in/
  );
  assert.equal(fs.readFileSync(path.join(parent, 'notes', 'mine.txt'), 'utf8'), 'keep');
  assert.deepEqual(ran, []);
});

test('a new project needs a name and a folder to go in', async () => {
  const run = async () => '';
  await assert.rejects(createProject({ name: '  ', parent: tmp() }, { run }), /Type a name for the project/);
  await assert.rejects(createProject({ name: '..', parent: tmp() }, { run }), /Type a name for the project/);
  await assert.rejects(createProject({ name: 'notes', parent: '' }, { run }), /Pick the folder/);
});
