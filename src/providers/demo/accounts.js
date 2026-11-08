// The demo's logins: the user's own and the ones added in Settings > Accounts, each made up, so that
// switching between them can be tried without signing in to anything. An added one keeps who it is in
// its folder, as a real one keeps its login there, and each has a plan of its own with its own limits.
// Kept apart from the scripted session, which the browser preview runs without a disk.
import fs from 'node:fs';
import path from 'node:path';
import { planLimits } from './session.js';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** The user's own login. Its limits are the ones the demo's sessions always said. */
const OWN = { email: 'you@example.com', plan: 'max' };

/** Who an added login is, the first not added yet: one in an organization, then a personal one. */
const ADDED = [
  { email: 'you@acme.example', orgId: 'org-acme', orgName: 'Acme', plan: 'team' },
  { email: 'side@example.com', plan: 'pro' },
];

/**
 * How much of its plan each added login has used, with how long from now each limit starts over: by the plan, as an
 * email can be signed in to more than one. One on another plan has the user's own.
 */
const ADDED_PLANS = {
  team: {
    plan: 'team',
    limits: [
      { kind: 'session', percent: 8, resetsIn: 4 * 60 * MINUTE },
      { kind: 'weekly', percent: 61, resetsIn: 2 * DAY + 3 * 60 * MINUTE },
    ],
    extra: { on: false, reason: 'org_level_disabled' },
  },
  pro: {
    plan: 'pro',
    limits: [
      { kind: 'session', percent: 91, resetsIn: 22 * MINUTE },
      { kind: 'weekly', percent: 47, resetsIn: 6 * DAY },
    ],
    extra: { on: true, currency: 'USD', used: 3.1, limit: 20, percent: 15.5 },
  },
};

const FILE = 'demo-login.json';

/**
 * Who a login is: the user's own for '', an added one by its folder. Null for a folder nobody signed in to.
 * @param {string} dir
 * @returns {{ email: string, plan: string, orgId?: string, orgName?: string } | null}
 */
function demoLogin(dir) {
  if (!dir) return OWN;
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Who a login is, and the plan it is on, as a scripted session says them. The user's own is on `own`, the plan
 * its provider's sessions always said. Null for a folder nobody signed in to.
 * @param {string} dir
 * @param {import('./session.js').DemoPlan} own
 * @returns {{ email: string, orgName?: string, plan: import('./session.js').DemoPlan } | null}
 */
export function demoWho(dir, own) {
  const login = demoLogin(dir);
  return (
    login && {
      email: login.email,
      ...(login.orgName && { orgName: login.orgName }),
      plan: (dir && ADDED_PLANS[login.plan]) || own,
    }
  );
}

/**
 * What can be done with the demo's logins. Signing in needs no browser: the next made-up login is added.
 * @param {object} opts
 * @param {import('./session.js').DemoPlan} opts.own  the plan of the user's own login
 * @param {(ms: number) => Promise<void>} [opts.sleep]  how long a real one takes to answer; replaceable in tests
 * @returns {import('../contract.js').AccountOps}
 */
export function demoAccounts({ own, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  let ownSignedOut = false;
  return {
    status: async (dir) => {
      const login = !dir && ownSignedOut ? null : demoLogin(dir);
      return login
        ? { signedIn: true, ...login, eligible: true }
        : { signedIn: false, email: '', plan: null, eligible: false };
    },
    signIn: async (dir) => {
      if (!dir) {
        ownSignedOut = false;
        return { ok: true, message: '' };
      }
      // The others in the folder beside it are the logins added already.
      const root = path.dirname(dir);
      const added = fs.existsSync(root)
        ? fs.readdirSync(root).map((name) => demoLogin(path.join(root, name))?.email)
        : [];
      const login = ADDED.find((one) => !added.includes(one.email));
      if (!login) return { ok: false, message: 'The demo has no more accounts to add.' };
      await sleep(600);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, FILE), JSON.stringify(login));
      return { ok: true, message: '' };
    },
    signOut: async (dir) => {
      if (!dir) ownSignedOut = true;
      else fs.rmSync(path.join(dir, FILE), { force: true });
    },
    prepare: (dir) => fs.mkdirSync(dir, { recursive: true }),
    limits: async (dir) => {
      await sleep(400);
      const who = demoWho(dir, own);
      return who && planLimits(who.plan);
    },
  };
}
