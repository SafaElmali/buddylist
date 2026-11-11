// What each conversation window shows, one JSON file per contact, and the
// conversations that came before it:
//
//   <contactId>.json                 the conversation that is going on
//   archive/<contactId>/<id>.json    a past conversation, whole
//   archive/<contactId>/index.json   their summaries, newest first
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ARCHIVE_LIMIT, summarize, toArchive } from './archive.js';
import { Pictures } from './pictures.js';

const LIMIT = 600;
const INDEX = 'index.json';
/**
 * A conversation's file is written at most this often. The first change is written at once;
 * what follows it within this long, as when an agent and its helpers make tool call after tool
 * call, is written together when the time is up.
 */
export const WRITE_EVERY_MS = 250;

/**
 * @typedef {Object} HistoryEntry
 * @property {string} id
 * @property {number} time
 * @property {'user' | 'assistant' | 'tool' | 'permission' | 'result' | 'notice' | 'error' | 'nudge' | 'wink'} kind
 * @property {string} [speaker]      on what a guest in the conversation wrote: its contact id. The host's have none
 * @property {string} [speakerName]  that guest's name when it was written
 * @property {number} [costUsd]      on a result: the session's reported running cost in US dollars
 * @property {string} [costOrigin]   on a forked result: the original result's id, so it is counted once
 * @property {boolean} [costReset]   on a fork notice: subsequent results start a new running total
 * @property {boolean} [sessionReset] on a service-switch notice: new sessions start new running totals
 * @property {string} [joined]       on the notice that a guest was added: its contact id
 * @property {string} [from]         on a notice of what another conversation passed on: that one's contact id
 *   (see Conversations.pass)
 * @property {string} [plan]         on the answer to a plan: the plan itself, as Markdown
 * @property {string[]} [questions]  on the answer to questions: what they asked, in order
 * @property {Record<string, string>} [answers]  and what you answered each, by what it asked
 * @property {{ id: string, name: string }} [answeredBy]  and who answered them for you: the project's manager,
 *   by its contact and its name then (see Managers.answer)
 * @property {string} [requestId]    on the answer to questions: which card it was, for its manager to be told
 * @property {number} [images]       on what you said: how many pictures went with it
 * @property {string[]} [pictures]   and their previews, as data: URLs, for the window to show again. On a
 *   tool call: the pictures it handed the agent to look at, such as a screenshot, also as data: URLs
 * @property {string[]} [originals] original attachment references, in the same order as `pictures`;
 *   absent on old messages whose originals were not kept
 * @property {true} [editable]       on what you said: it was sent to its agent alone, which can go back to
 *   just before it, and so it can be edited (see Conversations.edit)
 * @property {true} [pinned]         on what you or an agent said: its window keeps it in sight, over the
 *   conversation (see Conversations.pin)
 * @property {{ id: string, name: string }} [toManager]  on what you said: it tagged the conversation's manager,
 *   which was asked it (see Conversations#tagged)
 * @property {true} [onlyManager]    and nobody in the conversation was: it went to the manager alone
 * @property {true} [managerAnswer]  on a reply: the conversation's manager's answer to what you tagged it with, said
 *   in its own conversation (see Conversations#managerAnswered). `speaker` is the manager
 * @property {string} [answers]      on that answer: the message of yours it answers, by id
 * @property {true} [toldHost]       on what you asked the manager alone, or its answer: the conversation's agent was
 *   told it (see Conversations#exchange)
 * @property {true} [dropped]        on what you said: a Stop dropped it while it waited, before anyone read it, so
 *   it was never sent (see Conversations.interrupt)
 * @property {{ replies: string[], nextMessage: string }} [suggested]  on a result: what was offered after the
 *   reply that ended the turn, for the window to offer again after a restart (see Conversations.snapshot)
 */
/** @typedef {import('./archive.js').ArchivedConversation} ArchivedConversation */
/** @typedef {import('./archive.js').ConversationSummary} ConversationSummary */

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** `readJson`, letting the app get on with other things while the file is read. */
async function readJsonLater(file) {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * An entry as its file has it, which is how it is read back: a field that is undefined, say,
 * is not written, so it is not there.
 */
const asWritten = (entry) => JSON.parse(JSON.stringify(entry));

/**
 * A conversation that was added to since the app started, as it is kept in memory.
 * @typedef {Object} Live
 * @property {HistoryEntry[]} entries  all of it; the newest LIMIT at most unless retainAll applies
 * @property {number | null} at        when it was last added to here; null until it is
 * @property {boolean} unsaved         its file doesn't have all of it yet
 * @property {NodeJS.Timeout | null} timer  set while its file was written less than WRITE_EVERY_MS ago
 * @property {number} [revision]      changes in this process, including several in the same millisecond
 */

export class History {
  /**
   * contactId -> the conversation going on, once it is added to. An agent at work adds to it
   * with every tool call: reading its whole file back each time took longer than anything else
   * the app did for one.
   * @type {Map<string, Live>}
   */
  #live = new Map();
  #revision = 0;

  /** @param {string} dir @param {{ retainAll?: (contactId: string) => boolean }} [options] */
  constructor(dir, { retainAll = () => false } = {}) {
    this.dir = dir;
    this.pictures = new Pictures(path.join(dir, 'pictures'));
    this.retainAll = retainAll;
    fs.mkdirSync(dir, { recursive: true });
  }

  #file(contactId) {
    return path.join(this.dir, `${contactId}.json`);
  }

  /** @returns {HistoryEntry[]}  the reader's own: changing them changes nothing that is kept */
  read(contactId) {
    const live = this.#live.get(contactId);
    return live ? live.entries.map((entry) => ({ ...entry })) : readJson(this.#file(contactId)) || [];
  }

  /** When the conversation that is going on was last added to; null before its first message. */
  lastActive(contactId) {
    const live = this.#live.get(contactId);
    if (live?.at != null) return live.at;
    // Asked for every contact each time the list is drawn, so the file is not read for it. Its time
    // was written as a whole millisecond, in seconds, and can come back a hair off: …703.999 for …704.
    const written = fs.statSync(this.#file(contactId), { throwIfNoEntry: false })?.mtimeMs;
    return written === undefined ? null : Math.round(written);
  }

  /** A cache key for the current history, including edits made in the same millisecond. */
  revision(contactId) {
    const revision = this.#live.get(contactId)?.revision;
    return revision === undefined ? `file:${this.lastActive(contactId)}` : `live:${revision}`;
  }

  /** The conversation going on, to add to: read from its file the first time, kept from then on. */
  #open(contactId) {
    let live = this.#live.get(contactId);
    if (!live) {
      live = { entries: readJson(this.#file(contactId)) || [], at: null, unsaved: false, timer: null };
      this.#live.set(contactId, live);
    }
    return live;
  }

  #write(contactId, live) {
    const file = this.#file(contactId);
    fs.writeFileSync(file, JSON.stringify(live.entries));
    // The file says when the conversation was last active, for when it is read after a restart: a
    // pin written since says nothing about that.
    if (live.at !== null) fs.utimesSync(file, new Date(), new Date(live.at));
    live.unsaved = false;
  }

  /**
   * A conversation was added to, or only changed where nobody `heard` anything new, as a pin. Its file
   * follows at once, unless it was only just written.
   */
  #changed(contactId, live, { heard = true } = {}) {
    live.revision = ++this.#revision;
    if (heard) live.at = Date.now();
    live.unsaved = true;
    if (live.timer) return;
    try {
      this.#write(contactId, live);
    } catch {
      // Its folder is gone, or the disk is full. It stays unsaved, and the next change tries again.
      return;
    }
    this.#writeLater(contactId, live);
  }

  /** Once its file may be written again: whatever was added in the meantime goes in, all at once. */
  #writeLater(contactId, live) {
    live.timer = setTimeout(() => {
      live.timer = null;
      if (!live.unsaved) return;
      try {
        this.#write(contactId, live);
      } catch {
        // Its folder is gone, or the disk is full. It stays unsaved, and the next change tries again.
        return;
      }
      this.#writeLater(contactId, live);
    }, WRITE_EVERY_MS);
    // Something still to write is no reason to keep the app running: quitting writes it (see flush).
    live.timer.unref?.();
  }

  /** Writes whatever is still waiting to be written. The app calls this as it quits. */
  flush() {
    for (const [contactId, live] of this.#live) {
      if (!live.unsaved) continue;
      try {
        this.#write(contactId, live);
      } catch {
        // One conversation that can't be written doesn't keep the others from being.
      }
    }
  }

  /** Adds an entry, filling in `id` and `time`. */
  append(contactId, entry) {
    const full = { id: crypto.randomUUID(), time: Date.now(), ...entry };
    if (full.originals) full.originals = full.originals.map((source) => this.pictures.keep(source));
    this.pictures.own(contactId, full.originals ?? []);
    const live = this.#open(contactId);
    live.entries.push(asWritten(full));
    if (!this.retainAll(contactId) && live.entries.length > LIMIT) live.entries.splice(0, live.entries.length - LIMIT);
    this.#changed(contactId, live);
    return full;
  }

  /**
   * @param {string} contactId
   * @param {string} entryId
   * @param {Partial<HistoryEntry>} patch
   * @param {{ heard?: boolean }} [opts]  `heard: false` for a change nobody said anything new in, as what was
   *   offered after a reply: the conversation was last active when it was
   */
  update(contactId, entryId, patch, { heard = true } = {}) {
    const live = this.#open(contactId);
    const at = live.entries.findIndex((e) => e.id === entryId);
    if (at === -1) return;
    live.entries[at] = asWritten({ ...live.entries[at], ...patch });
    if (!heard) live.at ??= this.lastActive(contactId);
    this.#changed(contactId, live, { heard });
  }

  /**
   * Pins an entry of the conversation going on, or takes its pin off. Nobody was heard from: the
   * conversation was last active when it was, and the list sorted by that stays as it is.
   * @param {string} contactId
   * @param {string} entryId
   * @param {boolean} pinned
   * @returns {boolean}  whether the conversation had it. One that didn't is left as it was
   */
  pin(contactId, entryId, pinned) {
    const live = this.#open(contactId);
    const entry = live.entries.find((e) => e.id === entryId);
    if (!entry) return false;
    if (pinned) entry.pinned = true;
    else delete entry.pinned;
    live.at ??= this.lastActive(contactId);
    this.#changed(contactId, live, { heard: false });
    return true;
  }

  /**
   * Goes back to just before an entry of the conversation going on: it is gone, and every entry after it.
   * @returns {boolean}  whether the conversation had it. One that didn't is left as it was
   */
  rewind(contactId, entryId) {
    const live = this.#open(contactId);
    const at = live.entries.findIndex((e) => e.id === entryId);
    if (at === -1) return false;
    live.entries.splice(at);
    this.#changed(contactId, live);
    return true;
  }

  /**
   * Takes one entry out of the conversation going on, as a message taken back before it was read. Nobody
   * was heard from: the conversation was last active when it was.
   * @returns {boolean}  whether the conversation had it
   */
  remove(contactId, entryId) {
    const live = this.#open(contactId);
    const at = live.entries.findIndex((e) => e.id === entryId);
    if (at === -1) return false;
    live.entries.splice(at, 1);
    live.at ??= this.lastActive(contactId);
    this.#changed(contactId, live, { heard: false });
    return true;
  }

  /**
   * Moves entries of the conversation going on to its end, in the order they were in, as messages that
   * waited and are read only now. Nobody was heard from: the conversation was last active when it was.
   * @param {string} contactId
   * @param {string[]} entryIds
   */
  moveToEnd(contactId, entryIds) {
    const live = this.#open(contactId);
    const moving = new Set(entryIds);
    const moved = live.entries.filter((e) => moving.has(e.id));
    if (!moved.length) return;
    live.entries = [...live.entries.filter((e) => !moving.has(e.id)), ...moved];
    live.at ??= this.lastActive(contactId);
    this.#changed(contactId, live, { heard: false });
  }

  clear(contactId) {
    // What was still to be written goes with it: nothing brings the file back.
    clearTimeout(this.#live.get(contactId)?.timer);
    this.#live.delete(contactId);
    fs.rmSync(this.#file(contactId), { force: true });
  }

  /**
   * Has the conversation going on be `entries`, as when a past one is picked up again. The one
   * going on before is gone: archive it first.
   * @param {string} contactId
   * @param {HistoryEntry[]} entries
   */
  begin(contactId, entries) {
    this.pictures.own(
      contactId,
      entries.flatMap((entry) => entry.originals ?? [])
    );
    this.clear(contactId);
    const kept = this.retainAll(contactId) ? entries : entries.slice(-LIMIT);
    const live = { entries: kept.map(asWritten), at: null, unsaved: false, timer: null };
    this.#live.set(contactId, live);
    this.#changed(contactId, live);
  }

  // ---- past conversations -------------------------------------------------------------

  #archiveDir(contactId) {
    return path.join(this.dir, 'archive', contactId);
  }

  #archiveFile(contactId, id) {
    return path.join(this.#archiveDir(contactId), `${id}.json`);
  }

  #writeIndex(contactId, summaries) {
    fs.writeFileSync(path.join(this.#archiveDir(contactId), INDEX), JSON.stringify(summaries));
  }

  /**
   * Moves the conversation that is going on into the archive, leaving an empty one.
   * @param {string} contactId
   * @param {{ cwd: string, provider?: string, sessionId?: string | null, guests?: { id: string, sessionId: string | null }[] }} about
   *   the folder it was about, and the agent sessions in it
   * @returns {ConversationSummary | null}  null when nobody had said anything, so nothing was kept
   */
  archive(contactId, about) {
    const conversation = toArchive(this.read(contactId), { ...about, id: crypto.randomUUID(), contactId });
    if (conversation) {
      const older = this.listArchived(contactId);
      fs.mkdirSync(this.#archiveDir(contactId), { recursive: true });
      fs.writeFileSync(this.#archiveFile(contactId, conversation.id), JSON.stringify(conversation));
      const summaries = [summarize(conversation), ...older];
      for (const dropped of summaries.splice(ARCHIVE_LIMIT)) {
        fs.rmSync(this.#archiveFile(contactId, dropped.id), { force: true });
      }
      this.#writeIndex(contactId, summaries);
    }
    // Last, so a crash on the way leaves the conversation where it was.
    this.clear(contactId);
    return conversation && summarize(conversation);
  }

  /** @returns {ConversationSummary[]} newest first */
  listArchived(contactId) {
    return readJson(path.join(this.#archiveDir(contactId), INDEX)) || this.#reindex(contactId);
  }

  /** The index is only a shortcut: without it, every conversation is read once to write a new one. */
  #reindex(contactId) {
    const dir = this.#archiveDir(contactId);
    if (!fs.existsSync(dir)) return [];
    const summaries = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.json') && name !== INDEX)
      .map((name) => readJson(path.join(dir, name)))
      .filter((conversation) => Array.isArray(conversation?.entries))
      .map(summarize)
      .sort((a, b) => b.endedAt - a.endedAt);
    this.#writeIndex(contactId, summaries);
    return summaries;
  }

  // Only ids the index lists are looked up, so an id can never name a file outside the archive.
  #isArchived(contactId, id) {
    return this.listArchived(contactId).some((c) => c.id === id);
  }

  /** @returns {ArchivedConversation | null} */
  readArchived(contactId, id) {
    return this.#isArchived(contactId, id) ? readJson(this.#archiveFile(contactId, id)) : null;
  }

  /**
   * `readArchived`, letting the app get on with other things while the file is read: the Spending
   * window reads a month of every contact's.
   * @returns {Promise<ArchivedConversation | null>}
   */
  async readArchivedLater(contactId, id) {
    return this.#isArchived(contactId, id) ? readJsonLater(this.#archiveFile(contactId, id)) : null;
  }

  /**
   * Every past conversation with its summary, newest first, each read as it is come to. A search
   * goes through all of them, for every contact: read all at once, they held up every window.
   * One that can't be read is left out.
   * `include` can skip a transcript whose summary already answered the search.
   * @param {string} contactId
   * @param {{ include?: (summary: ConversationSummary) => boolean }} [options]
   * @returns {AsyncGenerator<[ConversationSummary, ArchivedConversation]>}
   */
  async *eachArchived(contactId, { include = () => true } = {}) {
    for (const summary of this.listArchived(contactId)) {
      if (!include(summary)) continue;
      const conversation = await readJsonLater(this.#archiveFile(contactId, summary.id));
      if (conversation) yield [summary, conversation];
    }
  }

  deleteArchived(contactId, id) {
    if (!this.#isArchived(contactId, id)) return;
    fs.rmSync(this.#archiveFile(contactId, id), { force: true });
    this.#writeIndex(
      contactId,
      this.listArchived(contactId).filter((c) => c.id !== id)
    );
  }

  /** Deletes every past conversation. The one that is going on stays. */
  clearArchive(contactId) {
    fs.rmSync(this.#archiveDir(contactId), { recursive: true, force: true });
  }

  /** Deletes everything kept for a contact. */
  purge(contactId) {
    this.clear(contactId);
    this.clearArchive(contactId);
    this.pictures.release(contactId);
  }
}
