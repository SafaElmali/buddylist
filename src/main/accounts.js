// The logins the app keeps for a provider that can be signed in to several (see AccountOps in
// providers/contract.js). The user's own is always there: the one its CLI uses in a terminal. Each
// one added in the app gets a folder of its own under the app's data, and is listed in the settings
// with the address it signed in as. One of them is in use, and every session starts in that one.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { accountName } from '../shared/usage.js';
import { AccountQuotaCache } from './account-quota.js';
import { chooseProactiveAccount, rotationThreshold } from './proactive-accounts.js';
import { within } from '../providers/within.js';

/** What the user's own login is called while nobody has said its address. */
export const OWN_LOGIN = 'Terminal login';

/**
 * @typedef {Object} AddedAccount
 * @property {string} id
 * @property {string} email
 * @property {string} [orgId]
 * @property {string} [orgName]
 * @property {string} [plan]
 */

/**
 * What the settings keep of a provider's accounts.
 * @typedef {Object} AccountSettings
 * @property {AddedAccount[]} added   the ones added in the app, oldest first
 * @property {string} inUse           the id of the one in use; '' for the user's own
 * @property {boolean} switchOnLimit  a conversation goes on in the next one without asking
 * @property {boolean} [proactive] opt in to switching before a new ordinary turn
 * @property {number} [proactiveThreshold] percent used at which a new turn may rotate
 */

/**
 * One of a provider's accounts, as the windows list it.
 * @typedef {Object} AccountView
 * @property {string} id      '' for the user's own
 * @property {string} email   '' while it is not known
 * @property {string} [orgId]
 * @property {string} [orgName]
 * @property {string} [plan]
 * @property {boolean} own    the one its CLI uses in a terminal
 * @property {boolean} inUse
 * @property {object} [quota] last read-only usage snapshot and health
 * @property {string} [proactiveStatus] why the last proactive decision switched or retained the account
 * @property {boolean} [signedIn]  how it stands, where that was asked
 * @property {string} [sameAs]  an added one that is the same login as a row above it: that row's id, '' for the
 *   user's own. Its limits are that row's, so it is no other account to switch to
 */

/** @type {AccountSettings} */
const NONE = Object.freeze({ added: [], inUse: '', switchOnLimit: false });

/** The non-secret identity and display details kept with an added login. */
function details({ email = '', orgId, orgName, plan } = {}) {
  return {
    email,
    ...(orgId && { orgId }),
    ...(orgName && { orgName }),
    ...(plan && { plan }),
  };
}

/** An email identifies a person; the organization identifies which of their logins this is. */
function sameLogin(a, b) {
  if (!a.email || a.email.trim().toLowerCase() !== b.email?.trim().toLowerCase()) return false;
  if (a.orgId || b.orgId) return Boolean(a.orgId && b.orgId && a.orgId === b.orgId);
  // Older CLIs may only say the plan. Missing organization data must not override a known ID.
  if (a.plan && b.plan) return a.plan === b.plan;
  return true;
}

export class Accounts {
  /** @type {Map<string, import('../providers/contract.js').AccountStatus>} provider id -> what its user's own login said, once asked */
  #own = new Map();
  /** @type {Map<string, Set<string>>} provider id -> added logins last checked as signed out */
  #signedOut = new Map();
  /** @type {Map<string, AbortController>} provider id -> calls off the sign-in of an account being added */
  #adding = new Map();
  #sessions = new Map();
  #turns = new Map();
  #pending = new Set();
  #revision = 0;
  #mutating = new Set();
  #lastChoice = new Map();
  #decisions = new Map();

  /**
   * @param {object} deps
   * @param {import('./storage/store.js').Store} deps.store
   * @param {(id: string) => import('../providers/contract.js').AccountOps | null} deps.ops  what can be done with
   *   a provider's logins; null for one with a single login
   * @param {string} deps.root  where the folders of the added accounts go: a folder per provider, one per account in that
   * @param {(settings: import('./storage/store.js').Settings) => void} [deps.onChange]  the accounts in the
   *   settings changed: the list, the one in use or whether to ask
   * @param {(id: string) => void} [deps.onSwitch]  another of a provider's logins is in use
   * @param {(id: string) => void} [deps.onLimits]  what a provider's login has used of its plan's limits was asked
   *   anew, and kept (see Store.limitsOf)
   * @param {() => number} [deps.now] clock, replaceable for freshness and cooldown tests
   */
  constructor({ store, ops, root, onChange = () => {}, onSwitch = () => {}, onLimits = () => {}, now = Date.now }) {
    this.store = store;
    this.ops = ops;
    this.root = root;
    this.onChange = onChange;
    this.onSwitch = onSwitch;
    this.onLimits = onLimits;
    this.now = now;
    this.quota = new AccountQuotaCache({
      now,
      read: async (id, accountId) => {
        if (this.#mutating.has(`${id}:${accountId}`)) return null;
        const ops = this.ops(id);
        const dir = this.#dir(id, accountId);
        if (ops?.quota) return ops.quota(dir);
        const status = await ops?.status(dir);
        return {
          ...status,
          eligible: status?.eligible === true,
          limits: status?.signedIn ? ((await ops?.limits?.(dir)) ?? null) : [],
        };
      },
    });
  }

  /** @param {string} id  a provider's @returns {AccountSettings} */
  #settings(id) {
    return { ...NONE, ...this.store.settings.accounts?.[id] };
  }

  /** @param {string} id @param {Partial<AccountSettings>} patch */
  #save(id, patch) {
    const accounts = { ...this.store.settings.accounts, [id]: { ...this.#settings(id), ...patch } };
    this.onChange(this.store.updateSettings({ accounts }));
  }

  /** An added account's folder. The user's own has none of the app's: its CLI knows where it is. */
  #dir(id, accountId) {
    return accountId ? path.join(this.root, id, accountId) : '';
  }

  /** The id of the one in use: the user's own when the one that was is gone. */
  #inUse(id) {
    const { added, inUse } = this.#settings(id);
    return added.some((account) => account.id === inUse) ? inUse : '';
  }

  /**
   * After a change that may have put another login in use. What the status bars knew of its limits is what a
   * session in it said last, which can be long ago, or nothing: it is asked now, rather than on its next turn.
   * @param {string} id
   * @param {string} before  the id of the one in use before the change
   */
  #switched(id, before) {
    const now = this.#inUse(id);
    if (now === before) return;
    this.onSwitch(id);
    this.#askLimits(id, now).catch(() => {});
  }

  /** @param {string} id @param {string} accountId */
  async #askLimits(id, accountId) {
    const limits = await this.ops(id)?.limits?.(this.#dir(id, accountId));
    // A login removed meanwhile keeps none.
    if (!limits || (accountId && !this.#settings(id).added.some((account) => account.id === accountId))) return;
    this.store.setLimits(id, accountId, limits);
    this.onLimits(id);
  }

  /**
   * The added accounts that are the same login as a row above them, each to the first row of that login: '' for the
   * user's own. Only checked as one is added, so the user's own can become one since, signed in again in a terminal.
   * @param {string} id
   * @param {AddedAccount[]} [added]
   * @returns {Map<string, string>}
   */
  #twins(id, added = this.#settings(id).added) {
    const own = this.#own.get(id);
    // A signed-out row is never the one a twin that can be used is left out for.
    const firsts = own?.signedIn ? [{ id: '', ...details(own) }] : [];
    const twins = new Map();
    for (const account of added) {
      const first = firsts.find((one) => sameLogin(one, account));
      if (first) twins.set(account.id, first.id);
      else if (!this.#signedOut.get(id)?.has(account.id)) firsts.push(account);
    }
    return twins;
  }

  /**
   * All of them as a session knows them, the user's own first, then the added ones as they were added.
   * @param {string} id
   * @returns {import('../providers/contract.js').Account[]}
   */
  #all(id) {
    return [
      {
        id: '',
        dir: '',
        name: this.#own.get(id)?.email ? accountName(this.#own.get(id)) : OWN_LOGIN,
      },
      ...this.#settings(id).added.map((account) => ({
        id: account.id,
        dir: this.#dir(id, account.id),
        name: accountName({ ...account, own: false }),
      })),
    ];
  }

  /**
   * The accounts of a provider, as its sessions ask about them.
   * @param {string} id
   * @param {string} [accountId] pins one account; 'current' resolves once when pinned
   * @returns {import('../providers/contract.js').AccountSwitch}
   */
  switchFor(id, accountId) {
    if (accountId !== undefined) {
      const wanted = accountId === 'current' ? this.#inUse(id) : accountId;
      const current = () => {
        const account = this.#all(id).find((one) => one.id === wanted);
        if (
          !account ||
          this.#signedOut.get(id)?.has(wanted) ||
          (wanted === '' && this.#own.get(id)?.signedIn === false)
        )
          throw new Error('The fallback account is unavailable.');
        return account;
      };
      current();
      return { current, next: () => null, automatic: () => false, use: () => {} };
    }
    const current = () => this.#all(id).find((account) => account.id === this.#inUse(id));
    return {
      current,
      watch: (session) => {
        if (!this.#sessions.has(id)) this.#sessions.set(id, new Set());
        this.#sessions.get(id).add(session);
        return () => this.#sessions.get(id)?.delete(session);
      },
      proactive: () => this.#settings(id).proactive === true,
      beforeTurn: (session, dispatch, valid) => this.#beforeTurn(id, session, dispatch, valid),
      next: (tried) => {
        // The ones after the one in use come first, then round from the top.
        const all = this.#all(id);
        const at = all.findIndex((account) => account.id === current().id);
        const after = [...all.slice(at + 1), ...all.slice(0, at)];
        // A login listed twice reached its limit in both rows: neither is another to go on in.
        const twins = this.#twins(id);
        const login = (accountId) => twins.get(accountId) ?? accountId;
        const spent = new Set([current().id, ...tried].map(login));
        const to = after.find(
          (account) =>
            !spent.has(login(account.id)) &&
            !this.#signedOut.get(id)?.has(account.id) &&
            (account.id !== '' || this.#own.get(id)?.signedIn !== false)
        );
        // In the login's first row, the one the switcher shows.
        return (to && all.find((account) => account.id === login(to.id))) || null;
      },
      use: (accountId) => this.use(id, accountId),
      automatic: () => this.#settings(id).switchOnLimit === true,
    };
  }

  /** All ordinary Claude sessions share this gate. The dispatch callback runs in the same
   * synchronous step as the final checks, so another pending send cannot race the selection. */
  #beforeTurn(id, session, dispatch, valid = () => !session.closed) {
    if (this.#settings(id).proactive !== true) {
      dispatch();
      return;
    }
    const revision = this.#revision;
    this.#pending.add(session);
    const run = async () => {
      let expired = false;
      const decide = async () => {
        if (!valid()) return;
        const safe = () =>
          !expired &&
          valid() &&
          [...(this.#sessions.get(id) || [])].every(
            (one) => one.closed || one.canSwitchAccount(this.#pending.has(one))
          );
        const retain = (reason) => this.#decisions.set(id, `Kept the current account. ${reason}`);
        if (!safe()) {
          retain('A conversation, helper, watcher or check-in is still active.');
          return;
        }
        const rows = await this.dashboard(id);
        if (expired || !valid()) return;
        const threshold = rotationThreshold(this.#settings(id).proactiveThreshold);
        const choose = () =>
          chooseProactiveAccount(
            rows.map((row) => ({ ...row, quota: this.quota.peek(id, row.id) })),
            { threshold, now: this.now(), lastSwitch: this.#lastChoice.get(id) ?? null }
          );
        const { account, reason } = choose();
        if (!account) {
          retain(reason);
          return;
        }
        // Recheck identity and subscription authentication immediately before dispatch.
        // A terminal login can change its auth method without changing its email or organization.
        const current = rows.find((row) => row.inUse);
        const [from, to] = await Promise.all(
          [current, account].map((row) => this.ops(id).status(this.#dir(id, row.id)))
        );
        return () => {
          if (revision !== this.#revision || this.#settings(id).proactive !== true || this.#mutating.size) {
            retain('An account or switching preference changed while checking.');
            return;
          }
          if (!safe() || session.closed) {
            retain('A conversation or background task became active while checking.');
            return;
          }
          if (
            !to?.signedIn ||
            !from?.signedIn ||
            to.eligible !== true ||
            from.eligible !== true ||
            !sameLogin(to, account) ||
            !sameLogin(from, current) ||
            sameLogin(from, to)
          ) {
            this.quota.invalidate(id, current.id);
            this.quota.invalidate(id, account.id);
            retain('Sign-in changed while checking. Refresh Accounts to check it again.');
            return;
          }
          if (choose().account?.id !== account.id || !this.#all(id).some((one) => one.id === account.id)) {
            retain('The allowance expired or the account was removed while checking.');
            return;
          }
          // use() preserves the existing global choice, config sharing and session-resume architecture.
          this.use(id, account.id, { proactive: true });
          const text = `Switched to ${accountName(account)} before this turn: a usage window reached ${threshold}% used.`;
          this.#decisions.set(id, text);
          session.emit({ type: 'notice', text });
        };
      };
      try {
        const commit = await within(decide(), 8_000, 'Account check');
        if (valid()) commit?.();
      } catch {
        this.#decisions.set(id, 'Kept the current account. Its allowance could not be checked.');
      } finally {
        expired = true;
        this.#pending.delete(session);
        if (valid()) dispatch();
      }
    };
    const previous = this.#turns.get(id) || Promise.resolve();
    const next = previous.then(run, run);
    this.#turns.set(id, next);
    next
      .finally(() => {
        if (this.#turns.get(id) === next) this.#turns.delete(id);
      })
      .catch(() => {});
  }

  setProactive(id, on, threshold) {
    this.#revision++;
    this.#save(id, { proactive: on === true, proactiveThreshold: rotationThreshold(threshold) });
  }

  /**
   * The id of the login a provider's sessions are in: the one in use, which each moves to with its next
   * message. '' for the user's own, as for a provider with one login.
   * @param {string} id
   */
  loginOf(id) {
    return this.#inUse(id);
  }

  /**
   * Gets a provider's accounts ready as the app starts: each shares what the user set up since it was
   * last used, also one a conversation is yet to move from, and the user's own says who it is.
   * @param {string} id
   */
  async start(id) {
    const ops = this.ops(id);
    if (!ops) return;
    for (const { id: accountId } of this.#settings(id).added) ops.prepare(this.#dir(id, accountId));
    this.#own.set(id, await ops.status(''));
  }

  /**
   * @param {string} id
   * @param {{ check?: boolean }} [opts]  `check`: ask each one how it stands. Without it, only the user's own
   *   is asked who it is, the first time
   * @returns {Promise<AccountView[]>}
   */
  async list(id, { check = false } = {}) {
    const ops = this.ops(id);
    let { added } = this.#settings(id);
    if (ops && (check || !this.#own.has(id))) this.#own.set(id, await ops.status(''));
    const standing =
      ops && check ? await Promise.all(added.map((account) => ops.status(this.#dir(id, account.id)))) : [];
    const checked = new Map(added.map((account, i) => [account.id, standing[i]]));
    if (ops && check) {
      this.#signedOut.set(
        id,
        new Set(added.filter((account) => checked.get(account.id)?.signedIn === false).map((account) => account.id))
      );
    }
    if (standing.length) {
      let changed = false;
      // Read the current list after awaiting the CLI: a removed login must not be brought back.
      added = this.#settings(id).added.map((account) => {
        const status = checked.get(account.id);
        if (!status?.signedIn) return account;
        const updated = { id: account.id, ...details(status) };
        if (['email', 'orgId', 'orgName', 'plan'].some((key) => account[key] !== updated[key])) {
          changed = true;
          return updated;
        }
        return account;
      });
      if (changed) this.#save(id, { added });
    }
    const inUse = this.#inUse(id);
    const own = this.#own.get(id);
    const twins = this.#twins(id, added);
    return [
      {
        id: '',
        ...details(own),
        own: true,
        inUse: inUse === '',
        ...(check && own && { signedIn: own.signedIn }),
      },
      ...added.map((account) => ({
        ...account,
        own: false,
        inUse: inUse === account.id,
        ...(checked.get(account.id) && { signedIn: checked.get(account.id).signedIn }),
        ...(twins.has(account.id) && { sameAs: twins.get(account.id) }),
      })),
    ];
  }

  /** The dashboard shares one bounded main-process cache across all windows. */
  async dashboard(id, { refresh = true } = {}) {
    const ids = ['', ...this.#settings(id).added.map((account) => account.id)];
    if (refresh) await Promise.all(ids.map((account) => this.quota.refresh(id, account)));
    const own = this.quota.peek(id, '');
    if (own.checkedAt !== null) this.#own.set(id, own);
    const signedOut = this.#signedOut.get(id) || new Set();
    const added = this.#settings(id).added.map((account) => {
      const quota = this.quota.peek(id, account.id);
      if (quota.signedIn === false) signedOut.add(account.id);
      else if (quota.signedIn === true) signedOut.delete(account.id);
      return quota.signedIn ? { id: account.id, ...details(quota) } : account;
    });
    this.#signedOut.set(id, signedOut);
    if (JSON.stringify(added) !== JSON.stringify(this.#settings(id).added)) this.#save(id, { added });
    const rows = [
      { id: '', ...details(this.#own.get(id)), own: true },
      ...this.#settings(id).added.map((account) => ({ ...account, own: false })),
    ];
    const firsts = [];
    const accounts = rows.map((row) => {
      const quota = this.quota.peek(id, row.id);
      const identity = quota.signedIn || (row.own && quota.checkedAt !== null) ? details(quota) : {};
      const account = {
        ...row,
        ...identity,
        inUse: row.id === this.#inUse(id),
        signedIn: quota.signedIn,
        quota,
        proactiveStatus: this.#decisions.get(id) || '',
      };
      const twin = firsts.find((one) => sameLogin(one, account));
      if (twin) account.sameAs = twin.id;
      else if (account.signedIn) firsts.push(account);
      return account;
    });
    // Authentication belongs to each login; usage belongs to the confirmed account/organization.
    // Prefer the newest successful reading, including an added copy when the terminal's usage check failed.
    for (const account of accounts) {
      if (account.signedIn !== true) continue;
      const shared = accounts
        .filter(
          (other) =>
            other.signedIn === true &&
            account.orgId &&
            account.orgId === other.orgId &&
            sameLogin(account, other) &&
            other.quota.state === 'ready'
        )
        .sort((a, b) => b.quota.updatedAt - a.quota.updatedAt)[0];
      if (shared && shared !== account) {
        account.quota = {
          ...account.quota,
          state: shared.quota.state,
          windows: shared.quota.windows,
          updatedAt: shared.quota.updatedAt,
          error: '',
        };
      }
    }
    return accounts;
  }

  /**
   * Signs another account in, through the browser, in a folder of its own. It waits there for as long
   * as the user takes, and never rejects.
   * @param {string} id
   * @param {string} way  one of the provider's ways to sign in
   * @returns {Promise<import('../providers/setup.js').SignInResult>}
   */
  async add(id, way) {
    const ops = this.ops(id);
    if (!ops) return { ok: false, message: 'This service has one login.' };
    // Asked twice, the first is called off: two would wait for the same browser.
    this.cancelAdd(id);
    const stop = new AbortController();
    this.#adding.set(id, stop);
    const accountId = crypto.randomUUID();
    const dir = this.#dir(id, accountId);
    const forget = () => fs.rmSync(dir, { recursive: true, force: true });
    try {
      // Before it signs in, so that what it writes there goes with what it shares.
      ops.prepare(dir);
      const signedIn = await ops.signIn(dir, { way, signal: stop.signal });
      if (!signedIn.ok) {
        forget();
        return signedIn;
      }
      const status = await ops.status(dir);
      if (!status.signedIn) {
        forget();
        return { ok: false, message: 'Could not verify this sign-in. Try adding the account again.' };
      }
      // Refresh the terminal login and older saved accounts before comparing organization identities.
      const known = await this.list(id, { check: true });
      if (stop.signal.aborted) {
        await ops.signOut(dir);
        forget();
        return { ok: false, message: '' };
      }
      if (known.some((account) => sameLogin(status, account))) {
        await ops.signOut(dir);
        forget();
        return {
          ok: false,
          message: `${accountName(status)} is one of your accounts already. Choose another account or organization in your browser.`,
        };
      }
      this.#save(id, { added: [...this.#settings(id).added, { id: accountId, ...details(status) }] });
      return { ok: true, message: '' };
    } catch (err) {
      forget();
      return { ok: false, message: err?.message || String(err) };
    } finally {
      if (this.#adding.get(id) === stop) this.#adding.delete(id);
    }
  }

  /** @param {string} id  a provider's. Nothing happens when no account is being added */
  cancelAdd(id) {
    this.#adding.get(id)?.abort();
  }

  /**
   * Puts an account in use: each session moves to it with its next message.
   * @param {string} id
   * @param {string} accountId  '' for the user's own
   */
  use(id, accountId, { proactive = false } = {}) {
    this.#revision++;
    this.#lastChoice.set(id, this.now());
    if (!proactive) this.#decisions.set(id, 'Manual account choice takes priority for five minutes.');
    const { added } = this.#settings(id);
    if (accountId && !added.some((account) => account.id === accountId)) throw new Error('That account is gone.');
    if (this.#signedOut.get(id)?.has(accountId) || (accountId === '' && this.#own.get(id)?.signedIn === false)) {
      throw new Error('This account is signed out. Sign in again in Settings → Accounts.');
    }
    const dir = this.#dir(id, accountId);
    if (dir) this.ops(id)?.prepare(dir);
    const before = this.#inUse(id);
    this.#save(id, { inUse: accountId });
    if (proactive) {
      this.onSwitch(id);
      const quota = this.quota.peek(id, accountId);
      this.store.setLimits(id, accountId, quota.windows);
      this.onLimits(id);
    } else this.#switched(id, before);
  }

  /**
   * Signs a login out. An added account's folder is removed; the terminal login keeps its config.
   * @param {string} id
   * @param {string} accountId
   */
  async remove(id, accountId) {
    this.#revision++;
    const key = `${id}:${accountId}`;
    this.#mutating.add(key);
    this.quota.invalidate(id, accountId);
    try {
      await this.#remove(id, accountId);
    } finally {
      this.#mutating.delete(key);
      this.quota.invalidate(id, accountId);
    }
  }

  async #remove(id, accountId) {
    if (accountId === '') {
      const ops = this.ops(id);
      if (!ops) return;
      await ops.signOut('');
      const status = await ops.status('');
      this.#own.set(id, status);
      if (status.signedIn) throw new Error('This account is still signed in. Try Disconnect again.');
      if (status.signedIn !== false) throw new Error(status.error || 'Could not confirm sign-out. Try Refresh.');
      this.store.setLimits(id, '', null);
      // If this was in use, continue in the first added account. An added account already in use stays there.
      if (this.#inUse(id)) return;
      const next = this.#settings(id).added.find((account) => !this.#signedOut.get(id)?.has(account.id))?.id || '';
      // With no fallback there is no signed-in account to select; retain the terminal row.
      if (next) this.use(id, next);
      else this.#save(id, { inUse: '' });
      return;
    }
    if (!this.#settings(id).added.some((account) => account.id === accountId)) return;
    const dir = this.#dir(id, accountId);
    await this.ops(id)?.signOut(dir);
    // Its links go, and never what they lead to.
    fs.rmSync(dir, { recursive: true, force: true });
    // And how much of its plan it had used.
    this.store.setLimits(id, accountId, null);
    // Signing out took a moment: another account may have been removed or put in use meanwhile.
    const { added, inUse } = this.#settings(id);
    const before = this.#inUse(id);
    this.#save(id, {
      added: added.filter((account) => account.id !== accountId),
      inUse: inUse === accountId ? '' : inUse,
    });
    this.#switched(id, before);
  }

  /**
   * @param {string} id
   * @param {boolean} on  a conversation goes on in the next account without asking
   */
  setSwitchOnLimit(id, on) {
    this.#save(id, { switchOnLimit: Boolean(on) });
  }
}
