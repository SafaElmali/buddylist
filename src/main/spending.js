// What every contact cost today, this week and this month, for the Spending window: the hover card's
// "today" for one contact, for all of them at once. What a turn cost is worked out as for the card
// (see shared/cost.js), from the conversation going on and the past ones in the message history. A
// conversation that was deleted, or whose contact was, is no longer counted.
import { turnCosts } from '../shared/cost.js';

/** @typedef {import('../shared/cost.js').Turn} Turn */
/** @typedef {import('./storage/history.js').HistoryEntry} HistoryEntry */

/**
 * A number for each period the window shows: US dollars, or when the period started.
 * @typedef {{ today: number, week: number, month: number }} Periods
 */

/** @typedef {Periods & { id: string, name: string, avatar: string, archived: boolean }} SpentBy */

/**
 * @typedef {Object} SpendingReport
 * @property {Periods} since      when each period started (ms since epoch)
 * @property {Periods} total      what every contact spent in it, together
 * @property {SpentBy[]} contacts  each contact that spent anything this week or this month, the most this month first
 * @property {{ id: string, name: string, providerName: string }[]} uncounted  the contacts whose agents
 *   answered in that time without saying what it cost, as Codex does
 */

const PERIODS = /** @type {const} */ (['today', 'week', 'month']);

/**
 * When today, this week and this month started, by the calendar: midnight, the Monday and the 1st.
 * @param {number} [now]
 * @returns {Periods}
 */
export function periodStarts(now = Date.now()) {
  const day = new Date(now);
  const [year, month, date] = [day.getFullYear(), day.getMonth(), day.getDate()];
  // getDay() counts from Sunday.
  const sinceMonday = (day.getDay() + 6) % 7;
  // By the calendar, not by 24 hours: a day the clocks change on is an hour longer or shorter.
  return {
    today: new Date(year, month, date).getTime(),
    week: new Date(year, month, date - sinceMonday).getTime(),
    month: new Date(year, month, 1).getTime(),
  };
}

/**
 * What a conversation tells about spending.
 * @typedef {Object} Digest
 * @property {Turn[]} turns           what each turn that said so cost
 * @property {number | null} answered  when its agents last answered, whether they said what it cost or not
 */

/**
 * @param {HistoryEntry[]} entries
 * @returns {Digest}
 */
function digest(entries) {
  const results = entries.filter((entry) => entry.kind === 'result');
  return { turns: turnCosts(entries), answered: results.length ? Math.max(...results.map((r) => r.time)) : null };
}

export class Spending {
  /** `contactId/conversationId` -> the digest of a past conversation in the period. A past one never changes. */
  #past = new Map();
  /** @type {Map<string, { revision: string, digest: Digest }>} contactId -> the conversation going on, as last read */
  #current = new Map();

  /** @param {import('./storage/history.js').History} history */
  constructor(history) {
    this.history = history;
  }

  /**
   * @param {{ id: string, name: string, avatar: string, archived?: boolean, providerName: string }[]} contacts
   *   as the contact list shows them, oldest first
   * @param {number} [now]
   * @returns {Promise<SpendingReport>}
   */
  async report(contacts, now = Date.now()) {
    const since = periodStarts(now);
    // Early in a month, this week began in the last one.
    const from = Math.min(since.week, since.month);
    const total = { today: 0, week: 0, month: 0 };
    /** @type {SpentBy[]} */
    const spentBy = [];
    const uncounted = [];
    // A fork starts with a copy of the conversation it came from, results and all. Each turn is counted
    // once: for the first contact it is found with, which is the one it was forked from, an older contact.
    // New forks keep the original result's id. Only legacy copies need a timestamp fallback:
    // two unrelated results can have the same time and total and must both count.
    const counted = new Set();
    const fingerprints = new Set();
    /** The past conversations this report read, for the others to be forgotten. */
    const kept = new Set();
    for (const contact of contacts) {
      const spent = { today: 0, week: 0, month: 0 };
      let answered = false;
      let priced = false;
      for (const { turns, answered: last } of await this.#digests(contact.id, from, kept)) {
        if (last !== null && last >= from) answered = true;
        for (const turn of turns) {
          if (turn.time < from) continue;
          priced = true;
          const fingerprint = `${turn.time} ${turn.total} ${turn.speaker || ''}`;
          if (turn.id && counted.has(turn.id)) continue;
          if (turn.legacyCopy && fingerprints.has(fingerprint)) continue;
          if (turn.id) counted.add(turn.id);
          fingerprints.add(fingerprint);
          for (const period of PERIODS) if (turn.time >= since[period]) spent[period] += turn.usd;
        }
      }
      for (const period of PERIODS) total[period] += spent[period];
      const { id, name } = contact;
      if (spent.week > 0 || spent.month > 0) {
        spentBy.push({ id, name, avatar: contact.avatar, archived: Boolean(contact.archived), ...spent });
      } else if (answered && !priced) {
        uncounted.push({ id, name, providerName: contact.providerName });
      }
    }
    for (const key of this.#past.keys()) if (!kept.has(key)) this.#past.delete(key);
    const ids = new Set(contacts.map((contact) => contact.id));
    for (const id of this.#current.keys()) if (!ids.has(id)) this.#current.delete(id);
    spentBy.sort((a, b) => b.month - a.month || b.week - a.week);
    return { since, total, contacts: spentBy, uncounted };
  }

  /**
   * The digests of a contact's conversations that may have turns since `from`: the one going on, and
   * the past ones that ended since. Each past one is read the first time only.
   * @param {string} contactId
   * @param {number} from
   * @param {Set<string>} kept  where the past ones read are noted
   * @returns {Promise<Digest[]>}
   */
  async #digests(contactId, from, kept) {
    const digests = [this.#currentDigest(contactId)];
    for (const summary of this.history.listArchived(contactId)) {
      // A conversation that ended before then had all its turns before then too.
      if (!(summary.endedAt >= from)) continue;
      const key = `${contactId}/${summary.id}`;
      let known = this.#past.get(key);
      if (!known) {
        const conversation = await this.history.readArchivedLater(contactId, summary.id);
        // Deleted while the others were being read.
        if (!conversation) continue;
        known = digest(conversation.entries);
        this.#past.set(key, known);
      }
      kept.add(key);
      digests.push(known);
    }
    return digests;
  }

  /** The conversation going on, read again only once it has been added to. */
  #currentDigest(contactId) {
    const revision = this.history.revision(contactId);
    const known = this.#current.get(contactId);
    if (known && known.revision === revision) return known.digest;
    const fresh = { revision, digest: digest(this.history.read(contactId)) };
    this.#current.set(contactId, fresh);
    return fresh.digest;
  }
}
