import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_CHANGES, demoFiles } from '../preview/demo-changes.js';
import { DemoShell, entriesIn } from '../preview/demo-shell.js';

// What a terminal draws of a text: without the colours, and with plain line ends.
// eslint-disable-next-line no-control-regex
const plain = (text) => text.replace(/\x1b\[[0-9;]*m/g, '').replace(/\r\n/g, '\n');

const API = {
  cwd: '/Users/you/projects/api',
  branch: 'fix/rate-limits',
  files: () => demoFiles('api'),
  title: 'Back off when the API says to slow down',
  port: 4100,
};
const PROMPT = 'api (fix/rate-limits) $ ';

/** A pretend shell, and what it prints for a line that is typed and entered: without the line itself and the next prompt. */
function shell(folder = API) {
  const sh = new DemoShell(folder);
  const run = (line) => {
    const { output } = sh.type(`${line}\r`);
    const printed = plain(output);
    assert.ok(printed.startsWith(`${line}\n`), `"${line}" is shown as it is typed`);
    assert.ok(printed.endsWith(plain(sh.prompt)), `a prompt follows "${line}"`);
    return printed.slice(line.length + 1, -plain(sh.prompt).length);
  };
  return { sh, run };
}

test('a new terminal says first that it is not a real shell, then where the real one would be', () => {
  const [first, hint, blank, prompt] = plain(new DemoShell(API).greeting).split('\n');
  assert.match(first, /^This is a pretend shell: a browser has none\./);
  assert.ok(first.includes('/Users/you/projects/api'));
  assert.match(hint, /help/);
  assert.deepEqual([blank, prompt], ['', PROMPT]);
});

test('the prompt names the folder and its branch; a folder without one is on main', () => {
  assert.equal(plain(new DemoShell(API).prompt), PROMPT);
  assert.equal(plain(new DemoShell({ cwd: '/Users/you/archive/old-blog' }).prompt), 'old-blog (main) $ ');
});

test('what is typed is shown, and backspace takes the last letter off the line and the screen', () => {
  const { sh } = shell();
  assert.deepEqual(sh.type('pwx'), { output: 'pwx', exited: false });
  assert.equal(sh.type('\x7f').output, '\b \b');
  assert.equal(plain(sh.type('d\r').output), `d\n/Users/you/projects/api\n${PROMPT}`);
  // On an empty line there is nothing to take off.
  assert.equal(sh.type('\x7f\b').output, '');
});

test('an empty line gets the next prompt, and a pasted text runs line by line', () => {
  const { sh } = shell();
  assert.equal(plain(sh.type('  \r').output), `  \n${PROMPT}`);
  assert.equal(
    plain(sh.type('whoami\r\npwd\n').output),
    `whoami\nyou\n${PROMPT}pwd\n/Users/you/projects/api\n${PROMPT}`
  );
});

test('arrow keys and other keys with no letter leave the line alone', () => {
  const { sh } = shell();
  assert.equal(sh.type('\x1b[A\x1b[1;5C\x1bOB\t\x1b').output, '');
  assert.equal(plain(sh.type('pw\x1b[Dd\r').output), `pwd\n/Users/you/projects/api\n${PROMPT}`);
});

test('Ctrl+C drops the line, and Ctrl+L clears the screen but keeps it', () => {
  const { sh } = shell();
  assert.equal(plain(sh.type('git sta\x03').output), `git sta^C\n${PROMPT}`);
  const cleared = sh.type('pw\x0c').output;
  assert.ok(cleared.startsWith('pw\x1b[2J'));
  assert.ok(plain(cleared).endsWith(`${PROMPT}pw`), 'the line is drawn again after the prompt');
  assert.equal(plain(sh.type('d\r').output), `d\n/Users/you/projects/api\n${PROMPT}`);
});

test('clear leaves a clean screen with a prompt, and exit ends the shell', () => {
  const { sh } = shell();
  const { output } = sh.type('clear\r');
  assert.ok(output.startsWith('clear\x1b[2J'));
  assert.ok(plain(output).endsWith(PROMPT));
  assert.deepEqual(sh.type('exit\r'), { output: 'exit\r\n', exited: true });
  // What is typed after that goes nowhere.
  assert.deepEqual(sh.type('pwd\r'), { output: '', exited: true });
});

test('help lists every command the shell answers', () => {
  const { run } = shell();
  const help = run('help');
  for (const command of ['help', 'ls', 'pwd', 'whoami', 'echo', 'clear', 'exit']) assert.ok(help.includes(command));
  for (const command of ['git status', 'git branch', 'git log', 'git diff', 'npm test', 'npm run dev']) {
    assert.ok(help.includes(command), command);
    assert.doesNotMatch(run(command === 'npm run dev' ? 'pwd' : command), /command not found|has no/, command);
  }
});

test('pwd, whoami and echo answer as a shell would', () => {
  const { run } = shell();
  assert.equal(run('pwd'), '/Users/you/projects/api\n');
  assert.equal(run('whoami'), 'you\n');
  assert.equal(run('echo hello   there'), 'hello there\n');
  assert.equal(run('echo "hello there"'), 'hello there\n');
  assert.equal(run('echo'), '\n');
});

test('ls lists what every example folder has and the files that changed, but not a deleted one', () => {
  const { run } = shell();
  assert.equal(run('ls'), 'README.md  docs/  node_modules/  package-lock.json  package.json  src/  test/\n');
  assert.equal(run('ls -la'), run('ls'));
  assert.equal(run('ls src'), 'backoff.js  client.js  config/  index.js\n');
  assert.equal(run('ls ./src/config/'), 'limits.js\n');
  assert.equal(run('ls package.json'), 'package.json\n');
  assert.equal(run('ls node_modules'), '');
  assert.equal(run('ls nowhere'), 'ls: nowhere: No such file or directory\n');
  assert.ok(DEMO_CHANGES.api.some((file) => file.path === 'src/retry.js' && file.status === 'deleted'));
});

test('entriesIn names files and folders once each, and knows a folder that is not there', () => {
  const paths = ['a.js', 'src/b.js', 'src/lib/c.js', 'src/lib/d.js', 'empty/'];
  assert.deepEqual(entriesIn(paths, ''), ['a.js', 'empty/', 'src/']);
  assert.deepEqual(entriesIn(paths, 'src/'), ['b.js', 'lib/']);
  assert.deepEqual(entriesIn(paths, 'empty/'), []);
  assert.equal(entriesIn(paths, 'gone/'), null);
});

test('git status lists the files of the Changes tab: staged, not staged and untracked', () => {
  const { run } = shell();
  assert.deepEqual(run('git status').split('\n'), [
    'On branch fix/rate-limits',
    'Changes to be committed:',
    '\trenamed:    src/limits.js -> src/config/limits.js',
    '\tnew file:   test/backoff.test.js',
    '',
    'Changes not staged for commit:',
    '\tmodified:   docs/rate-limits.png',
    '\tmodified:   package-lock.json',
    '\tmodified:   src/client.js',
    '\tdeleted:    src/retry.js',
    '',
    'Untracked files:',
    '\tsrc/backoff.js',
    '',
  ]);
  // Every file of the tab is in it, whatever the folder.
  for (const project of Object.keys(DEMO_CHANGES)) {
    const status = shell({ cwd: `/p/${project}`, files: () => demoFiles(project) }).run('git status');
    for (const { path } of DEMO_CHANGES[project]) assert.ok(status.includes(path), `${project}: ${path}`);
  }
});

test('git status looks at the folder each time: a file that changed since is listed', () => {
  const files = [];
  const { run } = shell({ cwd: '/p/website', files: () => files });
  assert.equal(run('git status'), 'On branch main\nnothing to commit, working tree clean\n');
  files.push({ path: 'src/cart.js', status: 'modified', added: 1, removed: 1 });
  assert.equal(run('git status'), 'On branch main\nChanges not staged for commit:\n\tmodified:   src/cart.js\n');
  assert.equal(shell({ cwd: '/p/bare' }).run('git status'), 'On branch main\nnothing to commit, working tree clean\n');
});

test('git branch marks the folder’s branch, and git log starts with its pull request', () => {
  const { run } = shell();
  assert.equal(run('git branch'), '* fix/rate-limits\n  main\n');
  const [newest, onMain, ...older] = run('git log').trim().split('\n');
  assert.equal(newest, '3f9c2ab (HEAD -> fix/rate-limits) Back off when the API says to slow down');
  assert.match(onMain, /^\w{7} \(origin\/main, main\) /);
  assert.equal(older.length, 2);

  const main = shell({ cwd: '/p/site' });
  assert.equal(main.run('git branch'), '* main\n');
  assert.match(main.run('git log'), /^\w{7} \(HEAD -> main, origin\/main\) /);
  assert.doesNotMatch(main.run('git log'), /3f9c2ab/);
});

test('git diff counts the lines of each file and points at the Changes tab; a clean folder prints nothing', () => {
  const { run } = shell();
  const lines = run('git diff').trimEnd().split('\n');
  assert.equal(lines.length, DEMO_CHANGES.api.length + 2);
  assert.match(lines[0], /^ docs\/rate-limits\.png +\| Bin$/);
  assert.ok(lines.includes(' src/client.js        | 15 +++++++---'));
  assert.equal(lines.at(-2), ' 7 files changed, 2637 insertions(+), 15 deletions(-)');
  assert.match(lines.at(-1), /Changes tab/);
  assert.equal(shell({ cwd: '/p/site' }).run('git diff'), '');
});

test('npm test passes, under the project’s name', () => {
  const { run } = shell({ ...API, cwd: '/Users/you/.buddylist/worktrees/api/fix-login', name: 'api' });
  const output = run('npm test');
  assert.ok(output.includes('> api@1.0.0 test'));
  assert.match(output, /ℹ pass 3\nℹ fail 0\n$/);
  assert.equal(run('npm run test'), output);
});

test('npm run dev keeps the terminal on the contact’s port until Ctrl+C', () => {
  const { sh } = shell();
  const started = plain(sh.type('npm run dev\r').output);
  assert.ok(started.includes('http://localhost:4100/'));
  assert.match(started, /browser preview/);
  assert.ok(!started.endsWith(PROMPT), 'no prompt while it runs');
  assert.equal(sh.type('pwd\r').output, '', 'and nothing is typed into it');
  assert.equal(plain(sh.type('\x03').output), `^C\n${PROMPT}`);
  assert.equal(plain(sh.type('pwd\r').output), `pwd\n/Users/you/projects/api\n${PROMPT}`);
  assert.ok(plain(new DemoShell({ cwd: '/p/site' }).type('npm run dev\r').output).includes('http://localhost:3000/'));
});

test('anything else is not found, with a word on what this is and where to look', () => {
  const { run } = shell();
  assert.equal(
    run('vim notes.md'),
    'vim: command not found. This is the browser preview: type help for what it answers.\n'
  );
  assert.match(run('git push origin main'), /^git push origin main: the browser preview has no git\./);
  assert.match(run('git'), /^git: the browser preview has no git\./);
  assert.match(run('npm install left-pad'), /^npm install left-pad: the browser preview has no npm\./);
});
