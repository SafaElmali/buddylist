import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { executablePath, spawnable } from '../src/providers/spawnable.js';

const NPM = 'C:\\Users\\Ann Lee\\AppData\\Roaming\\npm';
const CMD = 'C:\\WINDOWS\\system32\\cmd.exe';
const windows = { Path: `C:\\WINDOWS\\system32;${NPM}`, PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.JS', ComSpec: CMD };

test(
  'an npm-style CLI on Windows receives its arguments through the real command interpreter',
  { skip: process.platform !== 'win32' },
  (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist cli '));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const script = path.join(dir, 'arguments.cjs');
    const batch = path.join(dir, 'agent.cmd');
    fs.writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
    fs.writeFileSync(batch, `@"${process.execPath}" "${script}" %*\r\n`);
    const args = ['app-server', 'a folder with spaces', 'say "hello"', 'C:\\Projects\\my app\\', 'a&b'];
    const command = spawnable(batch, args);
    const output = execFileSync(command.file, command.args, {
      windowsVerbatimArguments: command.windowsVerbatimArguments,
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.deepEqual(JSON.parse(output), args);
  }
);

/** A Windows with only `files` on its disk, and the variables `env`. Its disk doesn't mind case. */
const on = (files, env = windows) => ({
  platform: 'win32',
  env,
  exists: (file) => files.some((one) => one.toLowerCase() === file.toLowerCase()),
});

/** What cmd.exe is asked to run for `line`: the line between the quotes that /s takes off. */
const throughCmd = (line, file = CMD) => ({
  file,
  args: ['/d', '/v:off', '/s', '/c', `"${line}"`],
  windowsVerbatimArguments: true,
});

test('on macOS and Linux a CLI is started by its name, as it always was', () => {
  for (const platform of ['darwin', 'linux']) {
    const looked = [];
    const exists = (file) => looked.push(file) > 0;
    assert.deepEqual(spawnable('codex', ['app-server'], { platform, env: windows, exists }), {
      file: 'codex',
      args: ['app-server'],
    });
    assert.deepEqual(looked, [], `nothing is looked for on ${platform}`);
  }
});

test('on Windows a program found on PATH is started directly, by where it is', () => {
  const found = spawnable('gh', ['auth', 'status'], on(['C:\\WINDOWS\\system32\\gh.exe']));
  assert.deepEqual(found, { file: 'C:\\WINDOWS\\system32\\gh.exe', args: ['auth', 'status'] });
  const old = spawnable('tool', [], on([`${NPM}\\tool.com`]));
  assert.deepEqual(old, { file: `${NPM}\\tool.com`, args: [] });
});

// npm puts three files there for each CLI: a script for sh, a batch file and a PowerShell script.
test('a CLI installed with npm is its batch file, run by cmd.exe', () => {
  const npm = [`${NPM}\\codex`, `${NPM}\\codex.cmd`, `${NPM}\\codex.ps1`];
  assert.deepEqual(spawnable('codex', ['app-server'], on(npm)), throughCmd(`"${NPM}\\codex.cmd" ^^^"app-server^^^"`));
  const batch = spawnable('gemini', ['--acp'], on([`${NPM}\\gemini.bat`]));
  assert.deepEqual(batch, throughCmd(`"${NPM}\\gemini.bat" ^^^"--acp^^^"`));
});

test('cmd.exe is the one ComSpec names, or else plain cmd.exe for Windows to find', () => {
  const files = [`${NPM}\\codex.cmd`];
  const own = on(files, { ...windows, ComSpec: 'D:\\Windows\\System32\\cmd.exe' });
  assert.equal(spawnable('codex', [], own).file, 'D:\\Windows\\System32\\cmd.exe');
  const { Path, PATHEXT } = windows;
  assert.equal(spawnable('codex', [], on(files, { Path, PATHEXT })).file, 'cmd.exe');
});

test('folders are tried in the order of PATH, and in each the extensions in the order of PATHEXT', () => {
  const both = ['C:\\WINDOWS\\system32\\codex.cmd', `${NPM}\\codex.exe`];
  assert.equal(spawnable('codex', [], on(both)).args[4], '""C:\\WINDOWS\\system32\\codex.cmd""');
  const together = [`${NPM}\\codex.cmd`, `${NPM}\\codex.exe`];
  assert.equal(spawnable('codex', [], on(together)).file, `${NPM}\\codex.exe`);
  const cmdFirst = on(together, { ...windows, PATHEXT: '.CMD;.EXE' });
  assert.equal(spawnable('codex', [], cmdFirst).args[4], `""${NPM}\\codex.cmd""`);
});

test('without PATHEXT the extensions are Windows’ own', () => {
  const { Path, ComSpec } = windows;
  assert.equal(spawnable('codex', [], on([`${NPM}\\codex.cmd`], { Path, ComSpec })).args[4], `""${NPM}\\codex.cmd""`);
});

// They open in the program they belong to, a script host or a text editor, and not as a CLI.
test('only programs and batch files are looked for, whatever else PATHEXT names', () => {
  const others = ['C:\\WINDOWS\\system32\\codex.js', 'C:\\WINDOWS\\system32\\codex.vbs', `${NPM}\\codex.cmd`];
  const jsFirst = on(others, { ...windows, PATHEXT: '.JS;.VBS;.CMD' });
  assert.equal(spawnable('codex', [], jsFirst).args[4], `""${NPM}\\codex.cmd""`);
  assert.deepEqual(spawnable('codex', [], on(['C:\\WINDOWS\\system32\\codex.js'])), { file: 'codex', args: [] });
});

test('the variables are read whatever their case, the way Windows hands them to the program', () => {
  const files = ['D:\\bin\\codex.cmd'];
  const shouted = on(files, { PATH: 'D:\\bin', PATHEXT: '.cmd', COMSPEC: 'D:\\cmd.exe' });
  assert.deepEqual(spawnable('codex', [], shouted), throughCmd('"D:\\bin\\codex.cmd"', 'D:\\cmd.exe'));
  // With two spellings Windows gives the program the first one in sorting order, "PATH" before "Path".
  const two = on(files, { Path: NPM, PATH: 'D:\\bin', PATHEXT: '.CMD' });
  assert.equal(spawnable('codex', [], two).args[4], '""D:\\bin\\codex.cmd""');
});

test('a folder of PATH may be in quotes, end in a backslash, or be empty', () => {
  const env = { ...windows, Path: ';"C:\\Program Files\\nodejs";;C:\\tools\\;' };
  assert.equal(
    spawnable('codex', [], on(['C:\\Program Files\\nodejs\\codex.cmd'], env)).args[4],
    '""C:\\Program Files\\nodejs\\codex.cmd""'
  );
  assert.equal(spawnable('opencode', [], on(['C:\\tools\\opencode.exe'], env)).file, 'C:\\tools\\opencode.exe');
});

// Settings can point the app at a CLI of the user's own.
test('a path is looked for where it points, and not on PATH', () => {
  assert.deepEqual(spawnable('D:\\ai\\codex.exe', ['app-server'], on(['D:\\ai\\codex.exe'])), {
    file: 'D:\\ai\\codex.exe',
    args: ['app-server'],
  });
  assert.deepEqual(
    spawnable('D:\\ai\\codex.cmd', ['app-server'], on(['D:\\ai\\codex.cmd'])),
    throughCmd('"D:\\ai\\codex.cmd" ^^^"app-server^^^"')
  );
  // The script for sh that npm puts next to the batch file can't be run on Windows: the batch file is.
  const npm = [`${NPM}\\codex`, `${NPM}\\codex.cmd`];
  assert.equal(spawnable(`${NPM}\\codex`, [], on(npm)).args[4], `""${NPM}\\codex.cmd""`);
  assert.deepEqual(spawnable('D:\\ai\\codex', [], on([`${NPM}\\codex.cmd`])), { file: 'D:\\ai\\codex', args: [] });
  const slashes = spawnable('D:/ai/codex', [], on(['D:/ai/codex.cmd']));
  assert.equal(slashes.args[4], '""D:\\ai\\codex.cmd""', 'cmd.exe is given it with backslashes');
  assert.equal(spawnable('ai\\codex', [], on(['ai\\codex.exe'])).file, 'ai\\codex.exe');
});

// Node then fails to start it as it did before, with ENOENT, and the user is told to install it.
test('a CLI that is nowhere is started by its name, so that it is reported as not installed', () => {
  assert.deepEqual(spawnable('codex', ['app-server'], on([])), { file: 'codex', args: ['app-server'] });
  assert.deepEqual(spawnable('D:\\ai\\codex.cmd', [], on([])), { file: 'D:\\ai\\codex.cmd', args: [] });
  assert.deepEqual(spawnable('codex', [], on([`${NPM}\\codex.cmd`], { PATHEXT: '.CMD' })), {
    file: 'codex',
    args: [],
  });
});

// ---- arguments through cmd.exe ---------------------------------------------------------------

/** What cmd.exe is given for `arg`, after the batch file's name. */
const written = (arg) =>
  spawnable('codex', [arg], on([`${NPM}\\codex.cmd`])).args[4].slice(`""${NPM}\\codex.cmd" `.length, -1);

test('each argument is quoted, and each character cmd.exe would act on is escaped twice', () => {
  const cases = [
    ['app-server', '^^^"app-server^^^"'],
    ['', '^^^"^^^"'],
    ['two words', '^^^"two^^^ words^^^"'],
    ['say "hi"', '^^^"say^^^ \\^^^"hi\\^^^"^^^"'],
    ['a&b', '^^^"a^^^&b^^^"'],
    ['a^b', '^^^"a^^^^b^^^"'],
    ['100%', '^^^"100^^^%^^^"'],
    ['%PATH%', '^^^"^^^%PATH^^^%^^^"'],
    ['hi!', '^^^"hi^^^!^^^"'],
    ['(a|b)<c>', '^^^"^^^(a^^^|b^^^)^^^<c^^^>^^^"'],
    ['C:\\dir\\', '^^^"C:\\dir\\\\^^^"'],
    ['a\\"b', '^^^"a\\\\\\^^^"b^^^"'],
    ['a\\b', '^^^"a\\b^^^"'],
  ];
  for (const [arg, expected] of cases) assert.equal(written(arg), expected, JSON.stringify(arg));
});

// cmd.exe reads the line once to start the batch file, which hands its arguments on with %* and
// so has them read a second time. Each reading takes one caret off: no quote is left unescaped
// for it to stop at. The program then splits what is left by the rules of Microsoft's C runtime.
const cmdReads = (line) => line.replace(/\^(.)/gs, '$1');

/** How Node and most other programs on Windows split their command line into arguments. */
function splitArgs(line) {
  const args = [];
  let arg = null;
  let quoted = false;
  for (let at = 0; at < line.length; at++) {
    const slashes = /^\\*/.exec(line.slice(at))[0].length;
    if (slashes) {
      // Backslashes count only before a quote: two are one, and an odd one out makes the quote a letter.
      const beforeQuote = line[at + slashes] === '"';
      arg = (arg ?? '') + '\\'.repeat(beforeQuote ? Math.floor(slashes / 2) : slashes);
      if (beforeQuote && slashes % 2) arg += '"';
      at += beforeQuote && slashes % 2 ? slashes : slashes - 1;
    } else if (line[at] === '"') {
      arg ??= '';
      quoted = !quoted;
    } else if (/[ \t]/.test(line[at]) && !quoted) {
      if (arg !== null) args.push(arg);
      arg = null;
    } else {
      arg = (arg ?? '') + line[at];
    }
  }
  return arg === null ? args : [...args, arg];
}

test('what cmd.exe and the batch file make of the arguments is what they were', () => {
  const args = [
    'app-server',
    '',
    'two words',
    'say "hi"',
    'a&b|c',
    '^caret^',
    '100% of %PATH%',
    'hi!',
    'C:\\dir\\',
    'C:\\dir with space\\',
    'a\\"b',
    'a\\\\"b',
    '\\\\server\\share',
    '"',
    '\\',
    '-c model="gpt-5" sandbox=\'workspace-write\'',
    '{"mcp_servers":{"app":{"url":"http://localhost:3000/mcp?a=1&b=2"}}}',
    '*?;,=`[]',
    '\ttab',
  ];
  const line = spawnable('codex', args, on([`${NPM}\\codex.cmd`])).args[4].slice(1, -1);
  const [command, ...read] = splitArgs(cmdReads(cmdReads(line)));
  assert.equal(command, `${NPM}\\codex.cmd`);
  assert.deepEqual(read, args);
});

test('a long run of backslashes is written in no time', () => {
  const started = performance.now();
  const many = written(`${'\\'.repeat(30000)}x`);
  assert.ok(performance.now() - started < 200, 'it does not slow down with the length of the run');
  assert.equal(many, `^^^"${'\\'.repeat(30000)}x^^^"`);
});

test('the reported executable follows PATH order and the Windows batch-file resolver', () => {
  assert.equal(executablePath('codex', on([`${NPM}\\codex.cmd`])), `${NPM}\\codex.cmd`);
  assert.equal(executablePath('missing', on([])), undefined);
  const env = { PATH: '/first:/second' };
  const exists = (file) => ['/first/codex', '/second/codex'].includes(file);
  assert.equal(executablePath('codex', { env, exists, platform: 'darwin' }), '/first/codex');
  assert.equal(executablePath('/second/codex', { env, exists, platform: 'darwin' }), '/second/codex');
});
