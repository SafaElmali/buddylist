// Reaching the app from a phone anywhere: Tailscale Serve on this computer gives it an https address on the
// user's own tailnet, with a real certificate, and passes what comes to it on to the app on 127.0.0.1 (see
// host.js). Settings finds Tailscale's command, reads how it stands, and with the user's OK runs the one
// command that sets Serve up. Funnel would put the app on the public internet: the app won't run beside it.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Where the Mac app keeps its command, which works as `tailscale` does. */
export const MAC_APP_CLI = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
const WINDOWS_CLI = 'C:\\Program Files\\Tailscale\\tailscale.exe';
/** How long reading how Tailscale stands may take. */
const CHECK_MS = 10_000;
/** How long setting Serve up may take: the first time, Tailscale may wait for HTTPS to be turned on in the browser. */
const SERVE_MS = 5 * 60 * 1000;
/** The most of a command's output kept to show. */
const MAX_OUTPUT = 8000;
/** The most of why Tailscale didn't answer kept to show. */
const MAX_REASON = 240;

/**
 * The Mac app's command is the app itself: it acts as the command only where it sees a shell (SHLVL, TERM) or is
 * told to. buddylist opened from the Finder or the Dock has no shell, and without this the command tries to start
 * the app's window instead, says "The Tailscale GUI failed to start" and exits 0. A Tailscale on the PATH, as
 * Homebrew's, doesn't read it.
 */
export const cliEnv = (env) => ({ ...env, TAILSCALE_BE_CLI: '1' });

/**
 * How Tailscale stands, as Settings shows it.
 * @typedef {{
 *   state: 'missing' | 'stopped' | 'signed-out' | 'running',
 *   reason: string,
 *   hostname: string,
 *   login: string,
 *   phones: { name: string, online: boolean }[],
 *   certificates: boolean,
 *   serving: { url: string, httpsPort: number } | null,
 *   funnel: boolean,
 *   httpsPort: number,
 *   taken: number[],
 *   serveReason: string,
 * }} TailscaleState
 *   `reason`: what the command said when it didn't answer, for 'stopped'. `login`: the account this Mac is signed in
 *   with. `phones`: the user's own iPhones, iPads and Android devices on the tailnet, so Settings can tick the step
 *   that has Tailscale on the phone. `serving`: Serve passes an https address on to this app. `funnel`: the public
 *   internet can reach it. `httpsPort`: the port the command sets Serve up on: the first of HTTPS_PORTS that Serve
 *   doesn't have for something else, 0 where it has them all. `taken`: those it has, of HTTPS_PORTS. `serveReason`:
 *   why Serve's settings couldn't be read, where Tailscale answered but they couldn't
 */

/** The https ports buddylist is served on, the first that is free: the ones Funnel takes too. */
export const HTTPS_PORTS = Object.freeze([443, 8443, 10000]);

/** A phone or a tablet, as Tailscale names the system each device on the tailnet runs. */
const PHONE_OS = /^(ios|android)$/i;

/**
 * The user's own phones on the tailnet, by name. An iPhone often calls itself "localhost": its name on the tailnet
 * is the first part of its DNS name.
 */
function phonesOf(status) {
  const me = status.Self?.UserID;
  return Object.values(status.Peer || {})
    .filter((peer) => PHONE_OS.test(String(peer?.OS || '')) && (me === undefined || peer.UserID === me))
    .map((peer) => ({
      name: String(peer.DNSName || '').split('.')[0] || String(peer.HostName || '') || 'A phone',
      online: peer.Online === true,
    }));
}

/** Where the app is, as Serve passes things on to it. */
export const target = (port) => `http://127.0.0.1:${port}`;

/** The only command run to set Serve up, word for word: no shell, nothing typed in. */
export const serveArgs = (port, httpsPort = 443) => ['serve', '--bg', `--https=${httpsPort}`, target(port)];

/** The command that stops Serve passing an https port on. */
export const stopArgs = (httpsPort) => ['serve', `--https=${httpsPort}`, 'off'];

/** The command as the user would type it, to copy. */
export const commandLine = (args) => ['tailscale', ...args].join(' ');

/** Whether a Serve handler passes things on to this app: to its port, on this computer. */
function proxiesTo(proxy, port) {
  if (typeof proxy !== 'string' || !proxy) return false;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(proxy) ? proxy : `http://${proxy}`);
    return (
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      Number(url.port || 80) === port &&
      (url.pathname === '/' || url.pathname === '')
    );
  } catch {
    return false;
  }
}

/** The Serve settings there are, the ones of a command left running in a terminal (Foreground) too. */
const configsOf = (serve) =>
  [serve, ...Object.values(serve?.Foreground || {})].filter((c) => c && typeof c === 'object');

/**
 * What `tailscale status --json` and `tailscale serve status --json` say, for this app on `port`.
 * @param {{ status: any, serve: any, missing?: boolean, reason?: string, serveReason?: string, port: number }} read
 *   status null: Tailscale didn't answer, for `reason`; serve null: its settings couldn't be read, for `serveReason`
 * @returns {TailscaleState}
 */
export function tailscaleState({ status, serve, missing = false, reason = '', serveReason = '', port }) {
  const none = {
    reason: '',
    hostname: '',
    login: '',
    phones: [],
    certificates: false,
    serving: null,
    funnel: false,
    httpsPort: 443,
    taken: [],
    serveReason: '',
  };
  if (missing) return { state: 'missing', ...none };
  if (!status) return { state: 'stopped', ...none, reason };
  const backend = String(status.BackendState || '');
  const state = backend === 'Running' ? 'running' : /^Needs/.test(backend) ? 'signed-out' : 'stopped';
  const hostname = String(status.Self?.DNSName || '')
    .replace(/\.$/, '')
    .toLowerCase();
  const certificates = Array.isArray(status.CertDomains) && status.CertDomains.length > 0;
  let serving = null;
  let funnel = false;
  const taken = new Set();
  for (const config of configsOf(serve))
    for (const [hostPort, web] of Object.entries(config.Web || {})) {
      const httpsPort = Number(hostPort.slice(hostPort.lastIndexOf(':') + 1));
      const ours = proxiesTo(web?.Handlers?.['/']?.Proxy, port);
      if (!ours) {
        taken.add(httpsPort);
        continue;
      }
      const host = hostPort.slice(0, hostPort.lastIndexOf(':')).toLowerCase();
      serving ??= { url: `https://${host}${httpsPort === 443 ? '' : `:${httpsPort}`}`, httpsPort };
      if (configsOf(serve).some((c) => c.AllowFunnel?.[hostPort] === true)) funnel = true;
    }
  // A port passed on as it is (TCP), not as https, has the port too.
  for (const config of configsOf(serve))
    for (const httpsPort of HTTPS_PORTS) {
      const tcp = config.TCP?.[String(httpsPort)];
      if (tcp && !tcp.HTTPS) taken.add(httpsPort);
    }
  const others = HTTPS_PORTS.filter((httpsPort) => taken.has(httpsPort) && httpsPort !== serving?.httpsPort);
  return {
    state,
    reason: '',
    hostname,
    login: String(status.User?.[status.Self?.UserID]?.LoginName || ''),
    phones: phonesOf(status),
    certificates,
    serving,
    funnel,
    httpsPort: serving?.httpsPort ?? HTTPS_PORTS.find((httpsPort) => !taken.has(httpsPort)) ?? 0,
    taken: others,
    serveReason: serve ? '' : serveReason,
  };
}

/** What a command printed, as much as is kept, without the escapes that colour a terminal. */
const clean = (text) =>
  String(text)
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
    .slice(-MAX_OUTPUT);

/** The first line a command printed, cut to a length Settings shows. */
const firstLine = (text) =>
  clean(text)
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
    ?.slice(0, MAX_REASON) ?? '';

/**
 * Why a command didn't give the JSON it was asked for, in its own words where it said any.
 * @param {(Error & { code?: unknown, killed?: boolean }) | null} error  null: it exited 0
 */
export function reasonOf(error, stdout, stderr) {
  if (error?.killed) return `it didn’t answer within ${CHECK_MS / 1000} seconds`;
  if (typeof error?.code === 'string') return firstLine(error.message);
  const said = firstLine(stderr) || firstLine(stdout);
  if (error) return said || firstLine(error.message);
  return said ? `it printed “${said}” instead of its status` : 'it printed nothing';
}

export class Tailscale {
  /** @type {import('node:child_process').ChildProcess | null} */
  #serving = null;

  /**
   * @param {object} [deps]
   * @param {NodeJS.Platform} [deps.platform]
   * @param {() => string} [deps.pathEnv]  the PATH, as the login shell has it once it is known
   * @param {(file: string) => boolean} [deps.exists]
   * @param {typeof execFile} [deps.execFile]
   * @param {typeof spawn} [deps.spawn]
   * @param {NodeJS.ProcessEnv} [deps.env]  what the command runs with, beside TAILSCALE_BE_CLI
   * @param {string} [deps.command]  a stand-in for Tailscale's command, for a check run (BUDDYLIST_TAILSCALE_CLI)
   */
  constructor({
    platform = process.platform,
    pathEnv = () => process.env.PATH || '',
    exists = (file) => fs.existsSync(file),
    execFile: run = execFile,
    spawn: start = spawn,
    env = process.env,
    command = '',
  } = {}) {
    this.command = command;
    this.platform = platform;
    this.pathEnv = pathEnv;
    this.exists = exists;
    this.run = run;
    this.start = start;
    this.env = env;
  }

  /** How every command is run: as the command, without a window, and with no shell. */
  #options(more) {
    return { windowsHide: true, env: cliEnv(this.env), ...more };
  }

  /** Tailscale's command: the Mac app's, or the one on the PATH. Null when there is none. */
  cli() {
    // A stand-in that isn't there is Tailscale not installed.
    if (this.command) return this.exists(this.command) ? this.command : null;
    const own = this.platform === 'darwin' ? MAC_APP_CLI : this.platform === 'win32' ? WINDOWS_CLI : '';
    if (own && this.exists(own)) return own;
    const name = this.platform === 'win32' ? 'tailscale.exe' : 'tailscale';
    for (const dir of this.pathEnv().split(path.delimiter).filter(Boolean)) {
      const file = path.join(dir, name);
      if (this.exists(file)) return file;
    }
    return null;
  }

  /**
   * How Tailscale stands, for the app on `port`.
   * @returns {Promise<TailscaleState>}
   */
  async check(port) {
    const cli = this.cli();
    if (!cli) return tailscaleState({ missing: true, status: null, serve: null, port });
    const status = await this.#json(cli, ['status', '--json']);
    const serve = status.json ? await this.#json(cli, ['serve', 'status', '--json']) : null;
    return tailscaleState({
      status: status.json,
      serve: serve?.json,
      reason: status.reason,
      serveReason: serve?.reason,
      port,
    });
  }

  /** Whether Serve is being set up right now. */
  busy() {
    return Boolean(this.#serving);
  }

  /**
   * Sets Serve up for the app on `port`, with the one fixed command. What it prints is told as it comes.
   * @param {number} port
   * @param {number} httpsPort
   * @param {(output: string) => void} onOutput
   * @returns {Promise<{ ok: boolean, output: string }>}
   */
  serve(port, httpsPort, onOutput) {
    const cli = this.cli();
    if (!cli) return Promise.resolve({ ok: false, output: 'Tailscale is not installed.' });
    if (this.#serving) return Promise.resolve({ ok: false, output: 'Tailscale Serve is already being set up.' });
    return new Promise((resolve) => {
      let output = '';
      const child = this.start(cli, serveArgs(port, httpsPort), this.#options({ stdio: ['ignore', 'pipe', 'pipe'] }));
      this.#serving = child;
      const timer = setTimeout(() => child.kill(), SERVE_MS);
      const heard = (chunk) => {
        output = clean(output + chunk);
        onOutput(output);
      };
      child.stdout?.on('data', heard);
      child.stderr?.on('data', heard);
      const done = (ok, more = '') => {
        if (this.#serving !== child) return;
        clearTimeout(timer);
        this.#serving = null;
        output = clean(output + more);
        resolve({ ok, output });
      };
      child.on('error', (error) => done(false, `\n${error.message}`));
      child.on('close', (code, signal) => done(code === 0, signal ? '\nStopped before Tailscale finished.' : ''));
    });
  }

  /** Stops setting Serve up. */
  cancel() {
    this.#serving?.kill();
  }

  /**
   * Stops Serve passing an https port on to the app.
   * @returns {Promise<{ ok: boolean, output: string }>}
   */
  stopServing(httpsPort) {
    const cli = this.cli();
    if (!cli) return Promise.resolve({ ok: false, output: 'Tailscale is not installed.' });
    return new Promise((resolve) => {
      this.run(cli, stopArgs(httpsPort), this.#options({ timeout: CHECK_MS }), (error, stdout, stderr) => {
        resolve({
          ok: !error,
          output: clean(`${stdout || ''}${stderr || ''}${error && !stderr ? error.message : ''}`),
        });
      });
    });
  }

  /**
   * What a command prints as JSON, or null and why not where it fails, such as Tailscale not running.
   * @returns {Promise<{ json: any, reason: string }>}
   */
  #json(cli, args) {
    return new Promise((resolve) => {
      const options = this.#options({ timeout: CHECK_MS, maxBuffer: 4 * 1024 * 1024 });
      this.run(cli, args, options, (error, stdout, stderr) => {
        if (error) return resolve({ json: null, reason: reasonOf(error, stdout, stderr) });
        try {
          resolve({ json: JSON.parse(String(stdout)), reason: '' });
        } catch {
          resolve({ json: null, reason: reasonOf(null, stdout, stderr) });
        }
      });
    });
  }
}
