// Run on each native build runner, using the packaged Electron rather than the runner's Node.
// Loading node-pty alone misses broken helpers, so start a real terminal and check its output.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const mac = process.platform === 'darwin';
const win = process.platform === 'win32';
const folder = mac ? 'mac-arm64/buddylist.app/Contents' : win ? 'win-unpacked' : 'linux-unpacked';
const unpacked = path.resolve('dist', folder);
const resources = path.join(unpacked, mac ? 'Resources' : 'resources');
const modules = path.join(resources, 'app.asar.unpacked', 'node_modules');
const electron = path.join(unpacked, mac ? 'MacOS/buddylist' : win ? 'buddylist.exe' : 'buddylist');
const sdk = `claude-agent-sdk-${process.platform}-${process.arch}`;
const claude = path.join(modules, '@anthropic-ai', sdk, win ? 'claude.exe' : 'claude');
const files = mac
  ? ['buddylist-mac-arm64.dmg', 'buddylist-mac-arm64.zip', 'buddylist-mac-arm64.zip.blockmap', 'latest-mac.yml']
  : win
    ? ['buddylist-win-x64.exe', 'buddylist-win-x64.exe.blockmap', 'latest.yml']
    : ['buddylist-linux-x86_64.AppImage', 'buddylist-linux-amd64.deb', 'latest-linux.yml'];
for (const file of files) assert.ok(fs.statSync(path.join('dist', file)).size > 0, `Empty asset: ${file}`);
const feed = fs.readFileSync(path.join('dist', files.at(-1)), 'utf8');
assert.ok(feed.includes(`url: ${mac ? files[1] : files[0]}`), 'Update feed must name the packaged update');
assert.match(fs.readFileSync(path.join(resources, 'app-update.yml'), 'utf8'), /^repo: buddylist\r?$/m);
// The licenses of what the app holds, where anyone who has it can read them.
const notices = fs.readFileSync(path.join(resources, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
for (const name of ['marked', '@anthropic-ai/claude-agent-sdk', 'mermaid', 'QR Code generator', 'Material Icon Theme'])
  assert.ok(notices.includes(name), `The notices must name ${name}`);
assert.match(execFileSync(claude, ['--version'], { encoding: 'utf8', timeout: 20000 }), /Claude Code/);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-package-'));
try {
  const smoke = path.join(temp, 'terminal.cjs');
  // Resolve JavaScript through ASAR, as the app does. node-pty rewrites its native helper's
  // app.asar path to app.asar.unpacked itself; loading it from the latter doubles that suffix.
  const pty = path.join(resources, 'app.asar', 'node_modules', 'node-pty');
  fs.writeFileSync(
    smoke,
    `const pty = require(${JSON.stringify(pty)});
const win = process.platform === 'win32';
const terminal = pty.spawn(win ? process.env.COMSPEC || 'cmd.exe' : '/bin/sh',
  win ? ['/d', '/s', '/c', 'echo buddylist-pty-ok'] : ['-c', 'echo buddylist-pty-ok'],
  { name: 'xterm-256color', cols: 80, rows: 24, cwd: process.cwd(), env: process.env });
let output = '';
terminal.onData(data => { output += data; });
terminal.onExit(({ exitCode }) => process.exit(exitCode === 0 && output.includes('buddylist-pty-ok') ? 0 : 1));
setTimeout(() => { terminal.kill(); process.exit(1); }, 10000);
`
  );
  execFileSync(electron, [smoke], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    timeout: 20000,
  });
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log(`Packaged ${process.platform}/${process.arch}: installers, update feed, Claude and terminal passed.`);
