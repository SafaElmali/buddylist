import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  commandLine,
  MAC_APP_CLI,
  reasonOf,
  serveArgs,
  stopArgs,
  Tailscale,
  tailscaleState,
} from '../src/main/remote/tailscale.js';

const PORT = 6767;
const running = {
  BackendState: 'Running',
  Self: { DNSName: 'Safas-MBP.tail1234.ts.net.', UserID: 7, OS: 'macOS' },
  User: { 7: { LoginName: 'safa@example.com' }, 9: { LoginName: 'friend@example.com' } },
  CertDomains: ['safas-mbp.tail1234.ts.net'],
};
const ours = (hostPort = 'safas-mbp.tail1234.ts.net:443', proxy = 'http://127.0.0.1:6767') => ({
  TCP: { [hostPort.split(':')[1]]: { HTTPS: true } },
  Web: { [hostPort]: { Handlers: { '/': { Proxy: proxy } } } },
});

test('the one command run is fixed, word for word', () => {
  assert.deepEqual(serveArgs(PORT), ['serve', '--bg', '--https=443', 'http://127.0.0.1:6767']);
  assert.deepEqual(serveArgs(PORT, 8443), ['serve', '--bg', '--https=8443', 'http://127.0.0.1:6767']);
  assert.deepEqual(stopArgs(443), ['serve', '--https=443', 'off']);
  assert.equal(commandLine(serveArgs(PORT)), 'tailscale serve --bg --https=443 http://127.0.0.1:6767');
});

test('Tailscale missing, not running, or signed out says so', () => {
  assert.equal(tailscaleState({ missing: true, status: null, serve: null, port: PORT }).state, 'missing');
  assert.equal(tailscaleState({ status: null, serve: null, port: PORT }).state, 'stopped');
  assert.equal(tailscaleState({ status: { BackendState: 'Stopped' }, serve: null, port: PORT }).state, 'stopped');
  for (const backend of ['NeedsLogin', 'NeedsMachineAuth'])
    assert.equal(tailscaleState({ status: { BackendState: backend }, serve: {}, port: PORT }).state, 'signed-out');
});

test('signed in, it has this Mac’s name on the tailnet, and Serve is offered on 443', () => {
  const state = tailscaleState({ status: running, serve: {}, port: PORT });
  assert.deepEqual(state, {
    state: 'running',
    reason: '',
    hostname: 'safas-mbp.tail1234.ts.net',
    login: 'safa@example.com',
    phones: [],
    certificates: true,
    serving: null,
    funnel: false,
    httpsPort: 443,
    taken: [],
    serveReason: '',
  });
  assert.equal(
    tailscaleState({ status: { ...running, CertDomains: null }, serve: {}, port: PORT }).certificates,
    false
  );
  for (const missing of [null, { BackendState: 'NeedsLogin' }]) {
    const state = tailscaleState({ status: missing, serve: null, port: PORT });
    assert.deepEqual([state.login, state.phones], ['', []]);
  }
});

test('the user’s own phones on the tailnet are found by name, and nobody else’s, nor a computer', () => {
  const peer = (name, OS, UserID = 7, more = {}) => ({
    HostName: name,
    DNSName: `${name}.tail1234.ts.net.`,
    OS,
    UserID,
    Online: true,
    ...more,
  });
  const status = {
    ...running,
    Peer: {
      a: peer('safas-iphone', 'iOS', 7, { HostName: 'localhost' }),
      b: peer('pixel-8', 'android', 7, { Online: false }),
      c: peer('studio', 'macOS'),
      d: peer('friends-iphone', 'iOS', 9),
      e: peer('linux-box', 'linux'),
    },
  };
  assert.deepEqual(tailscaleState({ status, serve: {}, port: PORT }).phones, [
    { name: 'safas-iphone', online: true },
    { name: 'pixel-8', online: false },
  ]);
  // Without its own user, every phone on the tailnet counts.
  const noSelf = { ...status, Self: { DNSName: 'mac.tail1234.ts.net.' } };
  assert.equal(tailscaleState({ status: noSelf, serve: {}, port: PORT }).phones.length, 3);
  // A phone with no DNS name yet goes by its host name.
  const bare = { ...running, Peer: { a: { HostName: 'iPad', OS: 'iOS', UserID: 7 } } };
  assert.deepEqual(tailscaleState({ status: bare, serve: {}, port: PORT }).phones, [{ name: 'iPad', online: false }]);
});

test('a check run’s stand-in command is used in place of any Tailscale', () => {
  const tailscale = new Tailscale({ command: '/tmp/fake-tailscale', exists: () => true });
  assert.equal(tailscale.cli(), '/tmp/fake-tailscale');
});

test('Serve passing an https address on to the app is found, on whichever port, also run in a terminal', () => {
  assert.deepEqual(tailscaleState({ status: running, serve: ours(), port: PORT }).serving, {
    url: 'https://safas-mbp.tail1234.ts.net',
    httpsPort: 443,
  });
  assert.deepEqual(
    tailscaleState({ status: running, serve: ours('safas-mbp.tail1234.ts.net:8443', 'localhost:6767'), port: PORT })
      .serving,
    { url: 'https://safas-mbp.tail1234.ts.net:8443', httpsPort: 8443 }
  );
  assert.ok(tailscaleState({ status: running, serve: { Foreground: { abc: ours() } }, port: PORT }).serving);
  // To another port, another program, or under a path of its own: not this app.
  for (const proxy of ['http://127.0.0.1:3000', 'http://192.168.1.5:6767', 'https://127.0.0.1:6767', 'not a url'])
    assert.equal(tailscaleState({ status: running, serve: ours(undefined, proxy), port: PORT }).serving, null, proxy);
  const underPath = {
    Web: { 'safas-mbp.tail1234.ts.net:443': { Handlers: { '/buddylist': { Proxy: 'http://127.0.0.1:6767' } } } },
  };
  assert.equal(tailscaleState({ status: running, serve: underPath, port: PORT }).serving, null);
});

test('something else on 443 has Serve offered on 8443 instead', () => {
  const other = ours(undefined, 'http://127.0.0.1:3000');
  assert.equal(tailscaleState({ status: running, serve: other, port: PORT }).httpsPort, 8443);
  const tcp = { TCP: { 443: { TCPForward: '127.0.0.1:22' } } };
  assert.equal(tailscaleState({ status: running, serve: tcp, port: PORT }).httpsPort, 8443);
});

test('Funnel on the address passed on to the app is found, wherever it is set', () => {
  const funnel = { ...ours(), AllowFunnel: { 'safas-mbp.tail1234.ts.net:443': true } };
  assert.equal(tailscaleState({ status: running, serve: funnel, port: PORT }).funnel, true);
  assert.equal(tailscaleState({ status: running, serve: { Foreground: { abc: funnel } }, port: PORT }).funnel, true);
  // Funnel for another program's port is not this app's.
  const elsewhere = { ...ours(), AllowFunnel: { 'safas-mbp.tail1234.ts.net:8443': true } };
  assert.equal(tailscaleState({ status: running, serve: elsewhere, port: PORT }).funnel, false);
});

/** A Tailscale whose command is a fake, that says what it was asked. */
function fake({ files = [MAC_APP_CLI], answers = {}, platform = 'darwin', pathEnv = '', env = {} } = {}) {
  const ran = [];
  const spawned = [];
  const tailscale = new Tailscale({
    platform,
    pathEnv: () => pathEnv,
    env,
    exists: (file) => files.includes(file),
    execFile: (file, args, options, done) => {
      ran.push({ file, args, options });
      const answer = answers[args.join(' ')];
      if (answer instanceof Error) done(answer, '', answer.code === undefined ? answer.message : '');
      else done(null, typeof answer === 'string' ? answer : JSON.stringify(answer ?? {}), '');
    },
    spawn: (file, args, options) => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        killed: false,
        kill() {
          this.killed = true;
          child.emit('close', null, 'SIGTERM');
        },
      });
      spawned.push({ file, args, options, child });
      return child;
    },
  });
  return { tailscale, ran, spawned };
}

test("Tailscale's command is the Mac app's, or one on the PATH", () => {
  assert.equal(fake().tailscale.cli(), MAC_APP_CLI);
  const brew = path.join('/opt/homebrew/bin', 'tailscale');
  assert.equal(
    fake({ files: [brew], pathEnv: ['/usr/bin', '/opt/homebrew/bin'].join(path.delimiter) }).tailscale.cli(),
    brew
  );
  assert.equal(fake({ files: [] }).tailscale.cli(), null);
});

test('how Tailscale stands is read from its JSON, and a failure is Tailscale not running, saying why', async () => {
  const { tailscale, ran } = fake({ answers: { 'status --json': running, 'serve status --json': ours() } });
  const state = await tailscale.check(PORT);
  assert.equal(state.serving?.url, 'https://safas-mbp.tail1234.ts.net');
  assert.deepEqual(
    ran.map(({ file, args }) => [file, ...args]),
    [
      [MAC_APP_CLI, 'status', '--json'],
      [MAC_APP_CLI, 'serve', 'status', '--json'],
    ]
  );
  const down = fake({ answers: { 'status --json': new Error('failed to connect to local Tailscale service') } });
  const stopped = await down.tailscale.check(PORT);
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.reason, 'failed to connect to local Tailscale service');
  assert.equal(down.ran.length, 1, 'Serve is not asked of a Tailscale that didn’t answer');
  assert.equal((await fake({ files: [] }).tailscale.check(PORT)).state, 'missing');
  assert.equal((await fake({ answers: { 'status --json': running } }).tailscale.check(PORT)).reason, '');
});

test('why Tailscale didn’t answer is kept in its own words: what it printed, a timeout, or no command', async () => {
  // The Mac app's command run without TAILSCALE_BE_CLI tries to start the app's window, and exits 0.
  const gui = fake({
    answers: {
      'status --json':
        'The Tailscale GUI failed to start: The operation couldn’t be completed. (Tailscale.CLIError error 3.)\n\n',
    },
  });
  const state = await gui.tailscale.check(PORT);
  assert.equal(state.state, 'stopped');
  assert.equal(
    state.reason,
    'it printed “The Tailscale GUI failed to start: The operation couldn’t be completed. (Tailscale.CLIError error 3.)” instead of its status'
  );
  const slow = Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM', code: null });
  assert.equal(
    (await fake({ answers: { 'status --json': slow } }).tailscale.check(PORT)).reason,
    'it didn’t answer within 10 seconds'
  );
  const gone = Object.assign(new Error(`spawn ${MAC_APP_CLI} EACCES`), { code: 'EACCES' });
  assert.equal(
    (await fake({ answers: { 'status --json': gone } }).tailscale.check(PORT)).reason,
    `spawn ${MAC_APP_CLI} EACCES`
  );
  // Of what it printed, the first line, with no terminal colours, and not too long to show.
  assert.equal(
    reasonOf(Object.assign(new Error('x'), { code: 1 }), '', '\u001b[31m\n  not running?\nmore'),
    'not running?'
  );
  assert.equal(
    reasonOf(Object.assign(new Error('Command failed: tailscale'), { code: 1 }), '', ''),
    'Command failed: tailscale'
  );
  assert.equal(reasonOf(null, '', ''), 'it printed nothing');
  assert.ok(reasonOf(null, 'x'.repeat(1000), '').length < 300);
});

test('every command runs as the command, not the Mac app, with the rest of the app’s environment', async () => {
  const { tailscale, ran, spawned } = fake({
    env: { HOME: '/Users/me', PATH: '/usr/bin:/bin' },
    answers: { 'status --json': running, 'serve status --json': {}, 'serve --https=443 off': 'ok' },
  });
  await tailscale.check(PORT);
  await tailscale.stopServing(443);
  tailscale.serve(PORT, 443, () => {});
  spawned[0].child.emit('close', 0, null);
  const options = [...ran, ...spawned].map((one) => one.options);
  assert.equal(options.length, 4);
  for (const one of options) {
    assert.deepEqual(one.env, { HOME: '/Users/me', PATH: '/usr/bin:/bin', TAILSCALE_BE_CLI: '1' });
    assert.equal(one.shell, undefined);
    assert.equal(one.windowsHide, true);
  }
});

test(
  'a command that acts as the Mac app’s does, run as the app runs it with no shell, says how Tailscale stands',
  { skip: process.platform === 'win32' },
  async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-tailscale-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const cli = path.join(dir, 'tailscale');
    // As the Mac app's command: a shell, or TAILSCALE_BE_CLI, makes it the command; else it is the app.
    fs.writeFileSync(
      cli,
      `#!${process.execPath}
const { env, argv } = process;
const asCommand = ['1', 'true'].includes(env.TAILSCALE_BE_CLI) || env.SHLVL || env.TERM || env.TERM_PROGRAM;
if (!asCommand) console.log('The Tailscale GUI failed to start: The operation couldn’t be completed.');
else if (argv[2] === 'status') console.log(JSON.stringify(${JSON.stringify(running)}));
else console.log('{}');
`,
      { mode: 0o755 }
    );
    // What an app opened from the Finder has: no SHLVL, no TERM.
    const env = {
      HOME: os.homedir(),
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      __CFBundleIdentifier: 'dev.buddylist.app',
    };
    const state = await new Tailscale({ platform: 'linux', pathEnv: () => dir, env }).check(PORT);
    assert.equal(state.state, 'running', state.reason);
    assert.equal(state.hostname, 'safas-mbp.tail1234.ts.net');
  }
);

test('setting Serve up runs the fixed command with no shell, and tells what it prints as it comes', async () => {
  const { tailscale, spawned } = fake();
  const heard = [];
  const done = tailscale.serve(PORT, 443, (output) => heard.push(output));
  assert.equal(tailscale.busy(), true);
  const [{ file, args, options, child }] = spawned;
  assert.equal(file, MAC_APP_CLI);
  assert.deepEqual(args, serveArgs(PORT, 443));
  assert.equal(options.shell, undefined);
  child.stdout.emit(
    'data',
    'Serve is not enabled on your tailnet.\nTo enable, visit:\n\n  https://login.tailscale.com/f/serve?node=abc\n'
  );
  assert.match(heard.at(-1), /login\.tailscale\.com/);
  child.stderr.emit('data', '\u001b[1mAvailable within your tailnet\u001b[0m');
  child.emit('close', 0, null);
  const result = await done;
  assert.equal(result.ok, true);
  assert.match(result.output, /Available within your tailnet$/);
  assert.equal(result.output.includes('\u001b'), false, 'no terminal colours');
  assert.equal(tailscale.busy(), false);
});

test('setting Serve up can be stopped, and is only run once at a time', async () => {
  const { tailscale, spawned } = fake();
  const done = tailscale.serve(PORT, 443, () => {});
  assert.deepEqual(await tailscale.serve(PORT, 443, () => {}), {
    ok: false,
    output: 'Tailscale Serve is already being set up.',
  });
  tailscale.cancel();
  assert.equal(spawned[0].child.killed, true);
  const result = await done;
  assert.equal(result.ok, false);
  assert.match(result.output, /Stopped before Tailscale finished/);
});

test('stopping Serve runs the fixed command for its port', async () => {
  const { tailscale, ran } = fake({ answers: { 'serve --https=443 off': 'ok' } });
  assert.deepEqual(await tailscale.stopServing(443), { ok: true, output: 'ok' });
  assert.deepEqual(ran.at(-1).args, ['serve', '--https=443', 'off']);
  assert.equal((await fake({ files: [] }).tailscale.serve(PORT, 443, () => {})).ok, false);
});

test('a check run’s stand-in answers as Tailscale does: how it stands, Serve set up and stopped', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-tailscale-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const stateFile = path.join(dir, 'state.json');
  const write = (state) => fs.writeFileSync(stateFile, JSON.stringify(state));
  write({ backend: 'Running', host: 'mac.tail1234.ts.net', login: 'safa@example.com', phones: [], serving: null });
  const command = fileURLToPath(new URL('./fixtures/fake-tailscale.js', import.meta.url));
  const tailscale = new Tailscale({ command, env: { ...process.env, FAKE_TAILSCALE_STATE: stateFile } });
  const first = await tailscale.check(PORT);
  assert.deepEqual(
    [first.state, first.hostname, first.login, first.phones],
    ['running', 'mac.tail1234.ts.net', 'safa@example.com', []]
  );
  write({ ...JSON.parse(fs.readFileSync(stateFile, 'utf8')), phones: [{ name: 'safas-iphone' }] });
  assert.deepEqual((await tailscale.check(PORT)).phones, [{ name: 'safas-iphone', online: true }]);
  const heard = [];
  const served = await tailscale.serve(PORT, 443, (output) => heard.push(output));
  assert.equal(served.ok, true);
  assert.match(served.output, /Available within your tailnet:\n\nhttps:\/\/mac\.tail1234\.ts\.net\//);
  assert.ok(heard.length > 0);
  assert.deepEqual((await tailscale.check(PORT)).serving, { url: 'https://mac.tail1234.ts.net', httpsPort: 443 });
  assert.equal((await tailscale.stopServing(443)).ok, true);
  assert.equal((await tailscale.check(PORT)).serving, null);
  write({ backend: 'Stopped', host: 'mac.tail1234.ts.net', login: '', phones: [], serving: null });
  const stopped = await tailscale.check(PORT);
  assert.deepEqual(
    [stopped.state, stopped.reason],
    ['stopped', 'failed to connect to local Tailscale service; is Tailscale running?']
  );
  // Not there: Tailscale isn't installed.
  const gone = new Tailscale({ command: path.join(dir, 'tailscale') });
  assert.equal((await gone.check(PORT)).state, 'missing');
});

test('the ports Serve has for something else are kept, and buddylist takes the first free of 443, 8443 and 10000', () => {
  const other = (port, proxy = 'http://127.0.0.1:3000') => ours(`safas-mbp.tail1234.ts.net:${port}`, proxy);
  const both = { Web: { ...other(443).Web, ...other(8443).Web } };
  const at = (serve) => {
    const { httpsPort, taken } = tailscaleState({ status: running, serve, port: PORT });
    return [httpsPort, taken];
  };
  assert.deepEqual(at({}), [443, []]);
  assert.deepEqual(at(other(443)), [8443, [443]]);
  assert.deepEqual(at(both), [10000, [443, 8443]]);
  assert.deepEqual(at({ Web: { ...both.Web, ...other(10000).Web } }), [0, [443, 8443, 10000]]);
  // buddylist's own address is its port, whatever else is served.
  assert.deepEqual(at({ Web: { ...both.Web, ...ours('safas-mbp.tail1234.ts.net:10000').Web } }), [10000, [443, 8443]]);
  // Not running, nothing is taken.
  assert.deepEqual(tailscaleState({ status: null, serve: null, port: PORT }).taken, []);
});

test('Serve’s settings it couldn’t read are said in their own words, apart from Tailscale answering', async () => {
  const { tailscale } = fake({
    answers: { 'status --json': running, 'serve status --json': new Error('serve config: permission denied') },
  });
  const state = await tailscale.check(PORT);
  assert.deepEqual(
    [state.state, state.reason, state.serveReason, state.serving],
    ['running', '', 'serve config: permission denied', null]
  );
  const garbled = fake({ answers: { 'status --json': running, 'serve status --json': 'not json' } });
  assert.equal((await garbled.tailscale.check(PORT)).serveReason, 'it printed “not json” instead of its status');
  const fine = fake({ answers: { 'status --json': running, 'serve status --json': ours() } });
  assert.equal((await fine.tailscale.check(PORT)).serveReason, '');
});
