// More than one Claude login. Claude Code keeps a login in its config folder (CLAUDE_CONFIG_DIR,
// ~/.claude unless it is told otherwise), with what goes with it: the keychain entry, and the
// account in .claude.json. So each account the app adds gets a folder of its own. Everything the
// user set up for Claude Code is shared with it from their own folder: their settings, skills,
// agents and plugins, and the conversations, so that one can be picked up in another account.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnable } from '../spawnable.js';
import { cliSignIn } from '../setup.js';
import { planOf, toExtra, toLimits } from './usage.js';

/** How long Claude Code gets to say who is signed in, or to sign out. */
const PATIENCE_MS = 8000;

/**
 * What an account's folder shares with the user's own, by name. The rest of a config folder is the
 * login's: its keychain entry and .claude.json, and what its organization sets, such as
 * policy-limits.json and remote-settings.json.
 */
export const SHARED = [
  'settings.json',
  'CLAUDE.md',
  'agents',
  'agent-memory',
  'commands',
  'hooks',
  'output-styles',
  'plugins',
  'rules',
  'skills',
  // The conversations, and what /rewind and plan mode keep with them.
  'projects',
  'file-history',
  'plans',
  'todos',
  // Claude's to-do list of each conversation (TaskCreate, TaskUpdate): one that goes on in another account still has it.
  'tasks',
];

/**
 * Shared folders an account may have had of its own before they were shared. The user's own is made where they have
 * none yet, so that every account shares it from the start, and what an account kept in one of its own is moved there.
 */
const MERGED = ['tasks'];

/**
 * Where the user's own Claude Code keeps what it is set up with, as a terminal's finds it.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ dir: string, file: string }}  `dir`: its config folder. `file`: its .claude.json, which is
 *   in the home folder unless the config folder was moved
 */
export function ownConfig(env = process.env) {
  const moved = env.CLAUDE_CONFIG_DIR;
  const home = env.HOME || env.USERPROFILE || os.homedir();
  return moved
    ? { dir: moved, file: path.join(moved, '.claude.json') }
    : { dir: path.join(home, '.claude'), file: path.join(home, '.claude.json') };
}

/**
 * What a session in an account is started with on top of the rest: its folder. The user's own
 * account ('') is whatever Claude Code would use anyway.
 * @param {string} dir
 * @returns {Record<string, string>}
 */
export const accountEnv = (dir) => (dir ? { CLAUDE_CONFIG_DIR: dir } : {});

/**
 * The user's own login and no other: where sessions start when the app keeps no accounts, as in tests.
 * @type {import('../contract.js').AccountSwitch}
 */
export const OWN_LOGIN_ONLY = Object.freeze({
  current: () => ({ id: '', dir: '', name: 'Terminal login' }),
  next: () => null,
  use: () => {},
  automatic: () => false,
  always: () => {},
});

/**
 * The logins a contact's session answers in. A fallback's continuation stays in the account it was pinned to. Any
 * other is in the one in use, wherever that is put, but where fallback rules decide what happens at a limit, it
 * doesn't go on in the next account by itself.
 * @param {(accountId?: string) => import('../contract.js').AccountSwitch | null} logins  pinned to `accountId` where
 *   it is given
 * @param {Pick<import('../contract.js').SessionContact, 'fallbackManaged' | 'accountId'>} contact
 * @returns {import('../contract.js').AccountSwitch | null}
 */
export function sessionLogins(logins, { fallbackManaged, accountId }) {
  if (!fallbackManaged) return logins();
  if (accountId !== undefined) return logins(accountId);
  const inUse = logins();
  return inUse && { ...inUse, next: () => null, automatic: () => false };
}

/** Whether something is there, a link whose target is gone too. */
function exists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

/** When anything in a file or folder was last changed. @param {string} file @returns {number} */
function lastChanged(file) {
  const stat = fs.statSync(file);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return Math.max(stat.mtimeMs, ...fs.readdirSync(file).map((name) => lastChanged(path.join(file, name))));
}

/**
 * Makes the user's folder where they have none, and moves what an account kept in a folder of its own into it, where
 * every account finds it once the folder is shared. Where both have the same entry, as a conversation that went on in
 * both accounts may, the one changed last is kept. Something that can't be moved now, or written there meanwhile, is
 * moved the next time.
 * @param {string} folder  the account's
 * @param {string} into  the user's
 */
function mergeInto(folder, into) {
  try {
    fs.mkdirSync(into, { recursive: true });
    if (!fs.lstatSync(folder).isDirectory()) return;
    for (const name of fs.readdirSync(folder)) {
      const from = path.join(folder, name);
      const to = path.join(into, name);
      if (exists(to) && lastChanged(to) >= lastChanged(from)) {
        fs.rmSync(from, { recursive: true, force: true });
        continue;
      }
      fs.rmSync(to, { recursive: true, force: true });
      try {
        fs.renameSync(from, to);
      } catch (err) {
        if (err.code !== 'EXDEV') throw err;
        // The app's data is on another disk than the user's own folder.
        fs.cpSync(from, to, { recursive: true });
        fs.rmSync(from, { recursive: true, force: true });
      }
    }
    fs.rmdirSync(folder);
  } catch {
    // Not there, or in use: the account goes on in its own until the next time.
  }
}

/**
 * Makes an account's folder share what the user set up in their own (see SHARED). What is there
 * already is left as it is, and what the user doesn't have is not made, but for MERGED. Done again
 * whenever the account is put in use, and as the app starts, for what the user set up since.
 *
 * The MCP servers the user added for themselves are in their .claude.json, which an account can't
 * share: it holds the login. A new account starts out with a copy of them.
 * @param {string} dir
 * @param {{ own?: { dir: string, file: string }, platform?: string }} [opts]  stand-ins for tests
 */
export function shareConfig(dir, { own = ownConfig(), platform = process.platform } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  // Only where the user has a folder of their own at all.
  for (const name of fs.existsSync(own.dir) ? MERGED : []) mergeInto(path.join(dir, name), path.join(own.dir, name));
  for (const name of SHARED) {
    const target = path.join(own.dir, name);
    const link = path.join(dir, name);
    if (!fs.existsSync(target) || exists(link)) continue;
    const isFolder = fs.statSync(target).isDirectory();
    try {
      // On Windows a folder can be joined without the rights a link needs.
      fs.symlinkSync(target, link, isFolder ? (platform === 'win32' ? 'junction' : 'dir') : 'file');
    } catch {
      // A file Windows won't link without those rights: the account goes without it.
    }
  }
  const settings = path.join(dir, '.claude.json');
  if (exists(settings)) return;
  let servers;
  try {
    servers = JSON.parse(fs.readFileSync(own.file, 'utf8')).mcpServers;
  } catch {
    return;
  }
  if (servers && Object.keys(servers).length) {
    fs.writeFileSync(settings, JSON.stringify({ mcpServers: servers }, null, 2));
  }
}

/**
 * What `claude auth status` says, in the app's words.
 * @param {string} stdout
 * @returns {import('../contract.js').AccountStatus}
 */
export function toStatus(stdout) {
  try {
    const { loggedIn, email, subscriptionType, authMethod, orgId, orgName } = JSON.parse(stdout);
    if (typeof loggedIn !== 'boolean') throw new Error('Missing sign-in status');
    const plan = typeof subscriptionType === 'string' ? subscriptionType || null : null;
    return {
      signedIn: loggedIn === true,
      email: String(email || ''),
      plan,
      eligible:
        loggedIn === true &&
        authMethod === 'claude.ai' &&
        typeof email === 'string' &&
        Boolean(email.trim() && plan?.trim()),
      ...(typeof orgId === 'string' && orgId && { orgId }),
      ...(typeof orgName === 'string' && orgName && { orgName }),
    };
  } catch {
    return { email: '', plan: null, eligible: false };
  }
}

// The rate-limit tier Claude Code gives Max 20x, which Anthropic calls Ultra since 2026-10-30. Max 5x is Max.
const ULTRA_TIER = 'default_claude_max_20x';

/**
 * The plan a login is on, as the app names it. Claude Code says "max" of Max and Ultra alike, and tells them apart
 * by the rate-limit tier of the login's organization, which it keeps in .claude.json. A tier that is not Ultra's, or
 * that couldn't be read, leaves "max" as it is.
 * @param {string | null} plan  what Claude Code calls it
 * @param {unknown} tier  the login's organizationRateLimitTier
 * @returns {string | null}
 */
export const exactPlan = (plan, tier) => (plan === 'max' && tier === ULTRA_TIER ? 'ultra' : plan);

/**
 * The plan of the login Claude Code runs in with `env`, as the app names it (see exactPlan), where its .claude.json
 * is of the login Claude Code says it is in.
 * @param {string | null} plan  what Claude Code calls it
 * @param {NodeJS.ProcessEnv} env
 * @param {{ email: string, orgName?: string }} account  whose login Claude Code says it is
 * @returns {string | null}
 */
export function loginPlan(plan, env, { email, orgName }) {
  if (plan !== 'max' || !email) return plan;
  const saved = savedIdentity(env);
  const same =
    saved.email?.toLowerCase() === email.toLowerCase() && (!orgName || !saved.orgName || saved.orgName === orgName);
  return same ? exactPlan(plan, saved.tier) : plan;
}

/**
 * Only display details, never credentials or evidence of a working sign-in: whose login it is, and the rate-limit
 * tier its plan has (see exactPlan).
 */
function savedIdentity(env) {
  try {
    const { oauthAccount } = JSON.parse(fs.readFileSync(ownConfig(env).file, 'utf8'));
    const fields = {
      email: 'emailAddress',
      orgId: 'organizationUuid',
      orgName: 'organizationName',
      tier: 'organizationRateLimitTier',
    };
    return Object.fromEntries(
      Object.entries(fields).flatMap(([key, field]) =>
        typeof oauthAccount?.[field] === 'string' && oauthAccount[field] ? [[key, oauthAccount[field]]] : []
      )
    );
  } catch {
    return {};
  }
}

/** Classify failures without ever showing raw CLI/SDK output, which can contain credentials. */
function checkError(error, fallback) {
  const text = `${error?.message || ''} ${error?.stderr || ''}`;
  if (/keychain|SecKeychain|errSecInteractionNotAllowed/i.test(text))
    return 'Claude Code could not read the macOS Keychain. Check its access in Keychain Access, then try Refresh.';
  if (error?.code === 'ENOENT') return 'Claude Code was not found. Check its path in Settings > Services.';
  if (error?.killed || /timed? out|took too long/i.test(text))
    return 'Claude Code took too long to respond. Try Refresh after the retry time.';
  if (error?.status === 429 || /\b429\b|rate.?limit|too many requests/i.test(text))
    return 'Claude is limiting usage checks. Try Refresh after the retry time.';
  return fallback;
}

function usageFailure(error) {
  const retry = error?.headers?.get?.('retry-after') ?? error?.headers?.['retry-after'];
  const ms = retry ? (/^\d+(\.\d+)?$/.test(String(retry)) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 0;
  return {
    error: checkError(error, 'Signed in, but Claude could not report plan usage. Try Refresh after the retry time.'),
    ...(Number.isFinite(ms) && ms > 0 && { retryAfterMs: ms }),
  };
}

/**
 * Keep structured status even on a nonzero exit (Claude exits 1 when signed out).
 * Raw diagnostics stay inside this provider. It never rejects.
 * @param {string | undefined} command
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<{ stdout: string, error?: Error }>}
 */
function output(command, args, env) {
  return new Promise((resolve) => {
    if (!command) return resolve({ stdout: '', error: Object.assign(new Error(), { code: 'ENOENT' }) });
    try {
      const { file, args: argv, windowsVerbatimArguments } = spawnable(command, args, { env });
      execFile(
        file,
        argv,
        {
          env,
          cwd: env.HOME || env.USERPROFILE || os.homedir(),
          timeout: PATIENCE_MS,
          windowsHide: true,
          windowsVerbatimArguments,
        },
        (err, stdout, stderr) =>
          resolve({ stdout: String(stdout || ''), ...(err && { error: Object.assign(err, { stderr }) }) })
      );
    } catch (error) {
      resolve({ stdout: '', error });
    }
  });
}

/**
 * What the app can do with the accounts of a Claude Code. Each is known by its folder, '' for the user's own.
 * @param {object} opts
 * @param {() => string | undefined} opts.binary  the Claude Code to run, asked each time
 * @param {() => NodeJS.ProcessEnv} opts.env      what it is run with, before an account's folder is added
 * @param {(way: string) => string[]} opts.loginArgs  what makes it sign in one of the descriptor's ways
 * @param {() => string | undefined} [opts.cliPath]  the Claude Code the SDK starts, as a session's: its own when none
 * @param {typeof import('./sdk.js').query} [opts.queryFn]  the SDK's query(); replaceable in tests
 * @returns {import('../contract.js').AccountOps}
 */
export function claudeAccounts({ binary, env, loginArgs, cliPath = () => undefined, queryFn }) {
  const inAccount = (dir) => ({ ...env(), ...accountEnv(dir) });
  const status = async (dir) => {
    const accountEnv = inAccount(dir);
    const { stdout, error } = await output(binary(), ['auth', 'status', '--json'], accountEnv);
    const status = toStatus(stdout);
    if (status.signedIn === false && /keychain|SecKeychain/i.test(error?.stderr || '')) delete status.signedIn;
    if (status.signedIn === false) return status;
    const { tier, ...saved } = status.signedIn === undefined || status.eligible ? savedIdentity(accountEnv) : {};
    // Do not attach a stale organization's identity to a different authenticated person.
    const matches = !status.email || status.email.toLowerCase() === saved.email?.toLowerCase();
    const identity = matches && (!status.orgId || status.orgId === saved.orgId) ? saved : {};
    return {
      ...identity,
      ...status,
      // Nor its plan's tier.
      ...(identity.email && { plan: exactPlan(status.plan, tier) }),
      email: status.email || identity.email || '',
      ...(status.signedIn === undefined && {
        error: checkError(
          error,
          'Claude Code did not return a sign-in status. Try Refresh or run claude auth status in your terminal.'
        ),
      }),
    };
  };
  return {
    status,
    signIn: (dir, { way, signal }) =>
      cliSignIn({ command: binary(), args: loginArgs(way), env: inAccount(dir) }, { signal }),
    signOut: async (dir) => {
      await output(binary(), ['auth', 'logout'], inAccount(dir));
    },
    prepare: (dir) => shareConfig(dir, { own: ownConfig(env()) }),
    // Identity and plan usage only: no prompt is put into the SDK input queue.
    quota: async (dir) => {
      const auth = await status(dir);
      if (auth.signedIn === undefined) return { ...auth, limits: null };
      if (!auth.signedIn)
        return {
          ...auth,
          limits: [],
          error: dir
            ? 'Sign in again by adding this account.'
            : 'Sign in with claude auth login in your terminal, then try Refresh.',
        };
      try {
        const { plan, error } = await planOf({ env: inAccount(dir), cliPath: cliPath(), queryFn });
        const extra = toExtra(plan);
        return {
          ...auth,
          limits: plan ? toLimits(plan, { includeUnknown: true }) : null,
          // What it spends past them: the Accounts page says so beside whether it stops at the limit.
          ...(extra && { extra }),
          ...(!plan && usageFailure(error)),
        };
      } catch (error) {
        return { ...auth, limits: null, ...usageFailure(error) };
      }
    },
    // What /usage says of the plan, from a Claude Code started in the account only to be asked.
    limits: async (dir) => {
      try {
        const { plan } = await planOf({ env: inAccount(dir), cliPath: cliPath(), queryFn });
        return plan ? toLimits(plan) : null;
      } catch {
        return null;
      }
    },
  };
}
