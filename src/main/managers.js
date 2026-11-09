// A project's manager (see shared/managers.js): a contact turned on from the project's menu or in Settings,
// under the project, that oversees the conversations under it (`managedBy` on a contact). Here it is said which
// those are, and it gets their news: each round of theirs that changed files, and each answer to a message of
// its own, with what they changed against the main line, and each card of questions one waits on. And here is what
// its tools do (see app-tools.js): it messages a worker, answers its questions where the project settles them, looks
// at the workers and their diffs, and keeps the project's brief and its sources. Once
// its context window fills, it writes the brief for a fresh session, which takes over from it.
//
// A project can also have a project manager (`leads` on its contact): a manager over the project's managers at work,
// which oversees no conversation. It acts on what the user asks through the managers, handing a worker's job from one
// team to another, and hears from the managers alone: their answers to its messages and their reports, never their
// workers' changes, so that its context stays small. It looks at the teams when it needs to.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { diffOf, listChanges } from './changes.js';
import { projectOfKey } from './run-command.js';
import { sameName } from '../shared/mentions.js';
import {
  BRIEF_MAX,
  HANDOVER_AT,
  MANAGERS_MAX,
  MESSAGE_MAX,
  REPORT_UP_MAX,
  SAID_MAX,
  SOURCES_MAX,
  TEAMS_LISTED,
  answeredLead,
  answersTo,
  changedParts,
  cleanManager,
  cleanSources,
  cleanWorkers,
  cutShort,
  handoverNote,
  jobLines,
  jobsDropped,
  leadMessage,
  leadStartNote,
  managerGuestInstructions,
  managerInstructions,
  managerMessage,
  managerName,
  managerSwitchMode,
  oneLine,
  projectManagerInstructions,
  projectManagerName,
  questionNote,
  reportToLead,
  settingsNote,
  sourceLine,
  sourceList,
  startNote,
  startedFrom,
  takeoverNote,
  turnedOn,
  workerLines,
  workerNote,
} from '../shared/managers.js';
import { pullRequestTags } from '../shared/pull-request-text.js';
import { REVIEW_ROLE, noSuchRole, roleNamed } from '../shared/teams.js';
import { DEFAULT_TURN_LIMIT } from '../shared/turn-limit.js';
import { percentOf } from '../shared/usage.js';

/** @typedef {import('./storage/store.js').Contact} Contact */
/** @typedef {import('../shared/managers.js').ManagerSettings} ManagerSettings */
/** @typedef {import('../shared/managers.js').WorkerReport} WorkerReport */
/** @typedef {import('../shared/managers.js').JobReport} JobReport */

/** @typedef {import('../providers/contract.js').Question} Question */

/** What a card a worker waits on that is no question is, as a manager is told it can't answer it. */
const APPROVALS = { tool: 'a permission', plan: 'a plan', instructions: 'project instructions' };

/** How much of the workers' diffs one look at a worker hands its manager, in characters. */
export const DIFF_MAX = 40000;
/** How much of each worker's task and last reply a look at all of them has. */
const OVERVIEW_SAID = 300;
/** And how much of a manager's last reply, and of a worker's, a project manager's look at the whole project has. */
const TEAMS_MANAGER_SAID = 200;
const TEAMS_WORKER_SAID = 120;

/** How long a manager's name can be, as a contact's nickname is in its dialog. */
const NAME_MAX = 40;

/** What a worker is doing, as its row in the contact list says it (see Conversations.view). */
const DOING = { busy: 'at work', away: 'waiting for the user', online: 'idle', offline: 'its folder is gone' };

/** What a folder outside a repository, or one git can't say anything about now, has changed. */
const NOTHING = Object.freeze({ branch: null, mainLine: null, files: [], more: 0 });

const filesCount = (count) => (count === 1 ? '1 file' : `${count} files`);

/** A pull request as a project manager is told it: "#412 (Open, 2 failing): https://…". '' for none. */
const pullRequestLine = (pr) => {
  if (!pr) return '';
  const tags = pullRequestTags(pr).map((tag) => tag.text);
  return `#${pr.number}${tags.length ? ` (${tags.join(', ')})` : ''}: ${pr.url}`;
};

/** The list of names, as a sentence says it: "A, B and C". */
const listed = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]);

export class Managers {
  /** manager id:worker id -> what that manager was last told the worker said and changed: the same again is no
   *  news, but an answer is. Another manager it is put under has been told nothing of it yet. */
  #told = new Map();
  /** The managers asked to write the brief for a fresh session, which takes over once that round is over. */
  #handingOver = new Set();
  /**
   * manager id -> what it owes its project manager an answer on, by the key of the message it was sent: a worker's
   * job, by the worker's name, until it reports; another message, by its beginning, until it answers. The project
   * manager hears of the ones left once that manager is turned off, put away or deleted.
   * @type {Map<string, Map<string, { lead: string, about: string, job: boolean }>>}
   */
  #owed = new Map();
  /**
   * manager id -> the line in its conversation of the latest message its project manager sent it without the user's
   * approval: until the user writes to it after that, the conversations it starts wait for the user (see
   * startsAtOnce).
   */
  #unapproved = new Map();

  /**
   * @param {object} deps
   * @param {Pick<import('./storage/store.js').Store, 'contacts' | 'getContact' | 'addContact' | 'settings'>} deps.store
   * @param {Pick<import('./storage/history.js').History, 'read'>} deps.history
   * @param {Pick<import('./project-settings.js').Projects, 'known' | 'settings' | 'update'>} deps.projects
   * @param {Pick<import('./conversations.js').Conversations, 'pass' | 'notice' | 'view' | 'end' | 'reset' | 'restoreContact' | 'setModel' | 'inviteAsked' | 'waitingOn' | 'answerFor'> & Partial<Pick<import('./conversations.js').Conversations, 'hurryNote' | 'stopped' | 'switchProvider'>>} deps.conversations
   * @param {(id: string) => import('../providers/contract.js').ProviderDescriptor} deps.descriptor  a service, by id
   * @param {string[]} deps.worktreesHomes  where contacts' worktrees go, and went before: a project's are in a folder of its name
   * @param {() => void} deps.onContactsChanged  a manager was added, put back on the list, or turned off
   * @param {(key: string) => void} deps.onProjectChanged  a manager saved its project's brief
   * @param {() => void} [deps.onInvited]  a manager invited an agent into one of its workers, which joined: for
   *   analytics.js to count
   * @param {() => void} [deps.onAnswered]  a manager answered a card of questions one of its workers waited on: for
   *   analytics.js to count, as the user's answer is
   * @param {{ list: typeof listChanges, diff: typeof diffOf }} [deps.changes]  stand-ins for tests: what a folder
   *   changed against the main line, and a file's diff
   */
  constructor({
    store,
    history,
    projects,
    conversations,
    descriptor,
    worktreesHomes,
    onContactsChanged,
    onProjectChanged,
    onInvited = () => {},
    onAnswered = () => {},
    changes = { list: listChanges, diff: diffOf },
  }) {
    this.store = store;
    this.history = history;
    this.projects = projects;
    this.conversations = conversations;
    this.descriptor = descriptor;
    this.worktreesHomes = worktreesHomes;
    this.onContactsChanged = onContactsChanged;
    this.onProjectChanged = onProjectChanged;
    this.onInvited = onInvited;
    this.onAnswered = onAnswered;
    this.changes = changes;
  }

  /** What a project's first manager is set up with, or what the first one it gets starts with. @param {string} key */
  #first(key) {
    return this.projects.settings(key).manager;
  }

  /** What a project's other managers are set up with, each named by its contact. @param {string} key */
  #others(key) {
    return this.projects.settings(key).managers;
  }

  /**
   * The contact that is a project's first manager, archived or not, turned on or not: the one its settings name.
   * Data from before managers were named there, or saved again by a version from then, names none: then it is the
   * contact that manages the project and is none of its other managers.
   * @param {string} key
   */
  #managerOfKey(key) {
    const { id } = this.#first(key);
    const named = id ? this.store.getContact(id) : null;
    if (named?.manages === key) return named;
    const others = new Set(this.#others(key).map((one) => one.id));
    return (
      this.store.contacts.find((contact) => contact.manages === key && !contact.leads && !others.has(contact.id)) ??
      null
    );
  }

  /**
   * A project's project manager, archived or not, turned on or not. Null for a project that has none.
   * @param {string} key
   * @returns {Contact | null}
   */
  #leadOfKey(key) {
    return this.#managersOf(key).find((one) => one.leads) ?? null;
  }

  /**
   * Whether a contact is its project's project manager, turned on or not: it oversees the project's managers, and
   * no conversation.
   * @param {Contact | null | undefined} contact
   */
  leads(contact) {
    return Boolean(contact?.manages && contact.leads && this.#settingsOf(contact));
  }

  /**
   * The project manager at work over a manager: its project's, while both are turned on and not put away. None for a
   * project manager, or a contact that is no manager at work. The contact list draws the manager under it (see
   * `ledBy` in Conversations.view).
   * @param {Contact | null | undefined} contact
   * @returns {Contact | null}
   */
  leadOf(contact) {
    if (!contact?.manages || contact.leads || contact.archived || !this.oversees(contact)) return null;
    const lead = this.#leadOfKey(contact.manages);
    return lead && !lead.archived && this.oversees(lead) ? lead : null;
  }

  /**
   * The managers a project manager oversees: its project's at work, itself aside, its first first.
   * @param {Contact} lead
   * @returns {Contact[]}
   */
  managersUnder(lead) {
    return this.leads(lead) ? this.#managersOf(lead.manages).filter((one) => this.leadOf(one)?.id === lead.id) : [];
  }

  /**
   * A project's managers, archived or not, turned on or not: its first, then the others as they were added.
   * @param {string} key
   * @returns {Contact[]}
   */
  #managersOf(key) {
    const first = this.#managerOfKey(key);
    const others = this.#others(key)
      .map((one) => this.store.getContact(one.id))
      .filter((one) => one?.manages === key);
    return first ? [first, ...others] : others;
  }

  /**
   * What a manager is set up with: its project's first manager's settings, or its own among the others. Null for
   * a contact that is no manager.
   * @param {Contact | null | undefined} contact
   * @returns {ManagerSettings | null}
   */
  #settingsOf(contact) {
    if (!contact?.manages) return null;
    if (this.#managerOfKey(contact.manages)?.id === contact.id) return this.#first(contact.manages);
    return this.#others(contact.manages).find((one) => one.id === contact.id) ?? null;
  }

  /**
   * What one of a project's managers is set up with, by its contact: the first's for none, or for one that is none
   * of the others. With no manager yet, what the first one starts with.
   * @param {string} key
   * @param {string} [id]
   * @returns {ManagerSettings}
   */
  settingsOf(key, id) {
    return (id && this.#others(key).find((one) => one.id === id)) || this.#first(key);
  }

  /**
   * Keeps what one of a project's managers is set up with: the one `settings` names among the others, or else the
   * first.
   * @param {string} key
   * @param {ManagerSettings} settings
   * @returns {ManagerSettings}  as it is kept
   */
  set(key, settings) {
    const others = this.#others(key);
    if (!settings.id || !others.some((one) => one.id === settings.id)) {
      return this.projects.update(key, { manager: settings }).manager;
    }
    const kept = this.projects.updateManagers(
      key,
      others.map((one) => (one.id === settings.id ? settings : one))
    );
    return /** @type {ManagerSettings} */ (kept.managers.find((one) => one.id === settings.id));
  }

  /**
   * Keeps what a manager is set up with, and Settings hears of it.
   * @param {Contact} manager
   * @param {ManagerSettings} settings
   */
  #save(manager, settings) {
    this.set(manager.manages, { ...settings, id: manager.id });
    this.onProjectChanged(manager.manages);
  }

  /**
   * The contact that is a project's first manager, by id, for a window to open its conversation: archived or not,
   * turned on or not. Null for a project that has none, as it never had or its managers were deleted.
   * @param {string} key
   */
  managerIdOf(key) {
    return this.#managerOfKey(key)?.id ?? null;
  }

  /**
   * A project's managers, its first first, with what each is set up with and how many conversations are under it,
   * the archived ones aside: for a window to list them, as in Add a Contact's Under and in Settings.
   * @param {string} key
   * @returns {{ id: string, name: string, permissionMode: string, archived: boolean, leads?: true, settings: ManagerSettings, conversations: number }[]}
   *   `leads`: its project manager, which oversees the others and no conversation
   */
  managersIn(key) {
    return this.#managersOf(key).map((manager) => ({
      id: manager.id,
      name: manager.name,
      permissionMode: manager.permissionMode,
      archived: Boolean(manager.archived),
      ...(manager.leads && { leads: true }),
      settings: /** @type {ManagerSettings} */ (this.#settingsOf(manager)),
      conversations: this.store.contacts.filter((one) => one.managedBy === manager.id && !one.archived).length,
    }));
  }

  /**
   * Whether a contact is one of its project's managers, turned on: it gets the manager's tools and is told what
   * it does.
   * @param {Contact | undefined} contact
   */
  oversees(contact) {
    return Boolean(this.#settingsOf(contact)?.on);
  }

  /**
   * What the conversations one of a project's managers starts answer with, as its New workers use has it in
   * Settings, turned on or not. Null for a contact that is no manager: the ones it starts are like the agent
   * that starts them.
   * @param {Contact | undefined} contact
   * @returns {import('../shared/managers.js').NewWorkers | null}
   */
  newWorkers(contact) {
    const settings = this.#settingsOf(contact);
    return settings ? cleanWorkers(settings.workers) : null;
  }

  /**
   * The manager that oversees a contact: the one it is under (`managedBy`), while that one is turned on and not put
   * away. A chat tab is under the one the conversation it was opened from is under. None for a manager, a guest or a
   * contact put away. The contact list draws it under that manager (see `overseenBy` in Conversations.view).
   * @param {Contact | undefined} contact
   * @returns {Contact | null}
   */
  managerOf(contact) {
    if (!contact || contact.manages || contact.guestOf || contact.archived) return null;
    const first = contact.tabOf ? this.store.getContact(contact.tabOf) : contact;
    const manager = first?.managedBy ? this.store.getContact(first.managedBy) : null;
    return manager && !manager.leads && !manager.archived && this.oversees(manager) ? manager : null;
  }

  /**
   * The conversations a manager oversees: the ones under it, the archived ones aside (see `managerOf`).
   * @param {Contact} manager
   * @returns {Contact[]}
   */
  workersOf(manager) {
    return this.store.contacts.filter((one) => this.managerOf(one)?.id === manager.id);
  }

  /**
   * The manager a new conversation is under: the one that started it, or the one the conversation that started it
   * is under, as its work goes on from there. Any other is under the one it was added under (`under`, in Add a
   * Contact, or the + of a manager's row), when that is one of its project's managers, and else under none.
   * Turned off, a manager has it all the same, for when it is turned on again.
   * @param {{ key: string, startedBy?: string | null, under?: unknown }} conversation  its project, the contact that
   *   started it, and the manager it was added under, by id
   * @returns {string | null}  that manager, by id; null for none
   */
  managerFor({ key, startedBy = null, under = null }) {
    const starter = startedBy ? this.store.getContact(startedBy) : null;
    if (starter) {
      // A project manager starts none: its managers do.
      if (starter.manages) return starter.leads ? null : starter.id;
      const first = starter.tabOf ? (this.store.getContact(starter.tabOf) ?? starter) : starter;
      return first.managedBy ?? null;
    }
    const manager = typeof under === 'string' && under ? this.store.getContact(under) : null;
    return manager?.manages === key && !manager.leads && this.#settingsOf(manager) ? manager.id : null;
  }

  /**
   * Puts a conversation under one of its project's managers, or under none: from its menu, or dragged onto a
   * manager's row or out from under one. A chat tab goes with the conversation it was opened from. Throws, for the
   * user, for a contact that is no conversation of its own and for a manager of another project.
   * @param {string} contactId
   * @param {string | null} managerId  null for none
   * @returns {Promise<Contact>}  the conversation that was put
   */
  async assign(contactId, managerId) {
    const [contact] = await this.assignAll([contactId], managerId);
    return contact;
  }

  /**
   * Puts many conversations under one of their project's managers, or under none, at once: from a manager's Assign
   * conversations... (see renderer/contacts/assign-dialog.js). Each is as `assign` puts it, and the contact list hears
   * of them once. None is put when one can't be: it throws, as `assign` does, for the first that can't.
   * @param {string[]} contactIds
   * @param {string | null} managerId  null for none
   * @returns {Promise<Contact[]>}  the conversations that were put, each once
   */
  async assignAll(contactIds, managerId) {
    const contacts = [
      ...new Map(
        contactIds.map((id) => {
          const asked = this.store.getContact(id);
          if (!asked || asked.manages || asked.guestOf) {
            throw new Error('Only a conversation can be put under a manager.');
          }
          const contact = (asked.tabOf && this.store.getContact(asked.tabOf)) || asked;
          return [contact.id, contact];
        })
      ).values(),
    ];
    const manager = managerId ? this.store.getContact(managerId) : null;
    if (manager?.leads) throw new Error(`${manager.name} oversees the project’s managers, not its conversations.`);
    if (managerId) {
      const keys = await Promise.all(contacts.map(async (contact) => (await this.projects.known(contact.cwd)).key));
      const other = keys.findIndex((key) => !manager || manager.manages !== key || !this.#settingsOf(manager));
      if (other >= 0) {
        throw new Error(`${manager?.name ?? 'That manager'} is no manager of ${projectOfKey(keys[other]).name}.`);
      }
    }
    // Not one that was deleted while git answered.
    const put = contacts.filter((contact) => this.store.getContact(contact.id));
    for (const contact of put) this.store.updateContact(contact.id, { managedBy: manager?.id });
    if (put.length) this.onContactsChanged();
    return put;
  }

  /**
   * Puts the conversations working on a project that are under no manager under its manager, once: the ones there
   * were before every conversation was under a manager of its own, when a manager oversaw them all (see Store's v7).
   * Never after: one under no manager since then was left so. A folder that is gone is known by where it was, as the
   * contact list lists it. The chat tabs go with the conversation they were opened from.
   * @param {string} key
   * @param {string} managerId
   * @returns {Promise<number>}  how many were put under it
   */
  async adopt(key, managerId) {
    const loose = this.store.contacts.filter((one) => !one.manages && !one.guestOf && !one.tabOf && !one.managedBy);
    const keys = await Promise.all(loose.map(async (one) => (await this.projects.known(one.cwd)).key));
    const theirs = loose.filter((one, i) => {
      // Not one that was deleted, or put under another, while git answered.
      const now = this.store.getContact(one.id);
      return now && !now.managedBy && (keys[i] === key || this.#wasIn(one.cwd, key));
    });
    for (const one of theirs) this.store.updateContact(one.id, { managedBy: managerId });
    if (theirs.length) this.onContactsChanged();
    return theirs.length;
  }

  /** Puts the conversations of each project the store asks it of under that project's manager (see Store's v7). */
  async adoptPending() {
    for (const key of this.store.toAdopt) {
      const manager = this.#managerOfKey(key);
      if (manager) await this.adopt(key, manager.id);
      this.store.adopted(key);
    }
  }

  /**
   * Whether a folder that is gone was one of a project's worktrees.
   * @param {string} cwd
   * @param {string} key
   */
  #wasIn(cwd, key) {
    if (fs.existsSync(cwd)) return false;
    const { name } = projectOfKey(key);
    return this.worktreesHomes.some((home) => cwd.startsWith(path.join(home, name) + path.sep));
  }

  /**
   * For a contact that manages its project, what its agent is told on top of what the project tells every
   * agent, and where it reads besides its own folder: the project's worktrees. With a guest, what that guest's agent
   * is told there instead: it is part of the manager in its conversation. Null for any other.
   * @type {import('./conversations.js').Managing['forAgent']}
   */
  forAgent(contact, guest) {
    if (!this.oversees(contact)) return null;
    const { name } = projectOfKey(contact.manages);
    const settings = /** @type {ManagerSettings} */ (this.#settingsOf(contact));
    // The project's other managers at work, each with conversations of its own.
    const others = this.#managersOf(contact.manages)
      .filter((one) => one.id !== contact.id && !one.leads && !one.archived && this.oversees(one))
      .map((one) => one.name);
    const instructions = contact.leads
      ? projectManagerInstructions(name, settings, { name: contact.name, managers: others })
      : managerInstructions(name, settings, { name: contact.name, others, lead: this.leadOf(contact)?.name ?? '' });
    return {
      instructions: guest
        ? managerGuestInstructions(
            name,
            { guest: guest.name, manager: contact.name, lead: Boolean(contact.leads), role: guest.role },
            instructions
          )
        : instructions,
      dirs: this.worktreesHomes.map((home) => path.join(home, name)).filter((dir) => fs.existsSync(dir)),
    };
  }

  /**
   * A round in a conversation went through. The manager it is under hears of one that changed files, and of
   * every answer to a message of its own (a round that read one), with what the worker changed against the main
   * line by now: once, as a round that says and changes what the last one it heard of did is no news. A round of
   * the manager's own may have filled its context window.
   * @param {string} contactId
   * @param {import('./conversations.js').Round} round
   * @returns {Promise<boolean>}  whether the manager told of it, now or before, started the worker: what it is
   *   told has what the worker said last, so it needs no other note of it
   */
  async roundOver(contactId, { changed, context = null, waiting = 0, read = [] }) {
    const worker = this.store.getContact(contactId);
    if (!worker) return false;
    // Before anything else is sent to it, as it is free.
    if (this.oversees(worker)) {
      this.#roundOfManager(worker, context, waiting);
      this.#answeredLead(worker, read);
      return false;
    }
    const manager = this.managerOf(worker);
    if (!manager) return false;
    // A message of its manager's that it read in this round is one it answered: one still waiting is not yet.
    const answered = read.some((key) => key.startsWith(`${manager.id}:`));
    // What a guest a manager invited said after the worker is news too, though the worker changed nothing.
    const reviewed = this.#reviewsOf(worker).length > 0;
    if (!changed && !answered && !reviewed) return false;
    const report = await this.#report(worker, { shared: this.#settingsOf(manager)?.checks.includes('overlap') });
    // What it changed was taken back, and it was asked nothing: there is nothing to look at.
    if (!answered && !report.files.length && !report.reviews?.length) return false;
    const told = JSON.stringify([report.reply, report.files, report.more, report.reviews ?? []]);
    const again = !answered && this.#told.get(`${manager.id}:${worker.id}`) === told;
    this.#told.set(`${manager.id}:${worker.id}`, told);
    const count = report.files.length + report.more;
    const review = report.reviews?.at(-1);
    if (!again) {
      this.conversations.pass(manager.id, {
        key: worker.id,
        line: answered
          ? `${worker.name} answered: ${oneLine(report.reply)}`
          : review
            ? `${review.name} reviewed ${worker.name}: ${oneLine(review.text)}`
            : `${worker.name} changed ${filesCount(count)}: ${oneLine(report.reply)}`,
        note: workerNote(report, { answered }),
        from: worker.id,
      });
    }
    return worker.startedBy === manager.id;
  }

  /**
   * A round of a manager's own is over. Once its context window is HANDOVER_AT full, it is asked to write the
   * brief for a fresh session, and once that round is over, the fresh session takes over from it. A window that
   * emptied meanwhile, as Claude Code compacted it or the user started over, needs none.
   * @param {Contact} manager
   * @param {import('./conversations.js').Round['context']} context
   * @param {number} waiting  the user's messages that wait in its session: they are for the session they were sent to
   */
  #roundOfManager(manager, context, waiting) {
    const percent = context ? percentOf(context.used, context.size) : 0;
    if (percent < HANDOVER_AT) return void this.#handingOver.delete(manager.id);
    if (!this.#handingOver.has(manager.id)) {
      this.#handingOver.add(manager.id);
      // It is free, so it reads this at once, with the news that waited.
      this.conversations.pass(manager.id, {
        key: 'handover',
        line: `Its context window is ${percent}% full, so it writes the brief for a fresh session to take over from.`,
        note: handoverNote(percent),
      });
      return;
    }
    if (waiting) return;
    this.#handingOver.delete(manager.id);
    // What its workers passed on that it hasn't read yet is news of the project: the fresh session reads it.
    this.conversations.reset(manager.id, { keepNotes: true });
    this.conversations.notice(
      manager.id,
      `${manager.name} goes on in a fresh session, as the last one’s context window was ${percent}% full. ` +
        'That conversation is in its message history.'
    );
    this.conversations.pass(manager.id, {
      key: 'handover',
      line: 'It starts from the brief the last session wrote.',
      note: takeoverNote(
        projectOfKey(manager.manages).name,
        /** @type {ManagerSettings} */ (this.#settingsOf(manager)),
        { lead: Boolean(manager.leads) }
      ),
    });
  }

  /**
   * A round of a manager's own is over: where it read messages of its project manager's, that one hears its answer,
   * whatever it changed. Where nothing it said came after the message, it hears that it said nothing. A message that
   * handed it no job is answered by this; a job is once the manager reports on it.
   * @param {Contact} manager
   * @param {string[]} read  the notes it read in that round, by key
   */
  #answeredLead(manager, read) {
    const lead = this.leadOf(manager);
    const keys = lead ? read.filter((key) => key.startsWith(`${lead.id}:`)) : [];
    if (!lead || !keys.length) return;
    const owed = this.#owed.get(manager.id);
    for (const key of keys) if (owed?.get(key)?.job === false) owed.delete(key);
    const reply = this.#saidSince(manager.id, lead.id);
    this.conversations.pass(lead.id, {
      key: `answer:${manager.id}`,
      line: `${manager.name} answered: ${reply ? oneLine(reply) : 'it said nothing'}`,
      note: answeredLead(manager.name, reply),
      from: manager.id,
    });
  }

  /**
   * What a manager said last after the newest line from `from` in its conversation: its answer to that. '' for none.
   * @param {string} managerId
   * @param {string} from  the contact whose message it answered
   */
  #saidSince(managerId, from) {
    const entries = this.history.read(managerId);
    const at = entries.findLastIndex((entry) => entry.kind === 'notice' && entry.from === from);
    return entries.slice(at + 1).findLast((entry) => entry.kind === 'assistant')?.text ?? '';
  }

  /**
   * A round of a conversation was stopped or went wrong. Where a manager had read its project manager's message in
   * it, the project manager hears so, and that the message waits: nothing came of it yet.
   * @param {string} contactId
   * @param {{ read?: string[] }} round  the notes its host's agent read in it, by key
   */
  roundCut(contactId, { read = [] }) {
    const manager = this.store.getContact(contactId);
    const lead = this.leadOf(manager);
    if (!manager || !lead || !read.some((key) => key.startsWith(`${lead.id}:`))) return;
    const ended = this.history.read(manager.id).findLast((entry) => entry.kind === 'result' && !entry.speaker);
    const stopped = Boolean(ended?.stopped);
    this.conversations.pass(lead.id, {
      key: `answer:${manager.id}`,
      line: `${manager.name}’s turn ${stopped ? 'was stopped' : 'failed'} before it answered.`,
      note: cutShort(manager.name, { stopped, error: ended?.errorText ?? '' }),
      from: manager.id,
    });
  }

  /**
   * A manager will answer its project manager no more: it was turned off, put away or deleted. The project manager
   * hears of what it owed an answer on, if anything.
   * @param {Contact} manager
   * @param {'turned-off' | 'put-away' | 'deleted'} why
   */
  #gone(manager, why) {
    const owed = this.#owed.get(manager.id);
    this.#owed.delete(manager.id);
    this.#unapproved.delete(manager.id);
    if (!owed?.size) return;
    const byLead = Map.groupBy(owed.values(), (one) => one.lead);
    for (const [leadId, jobs] of byLead) {
      const lead = this.store.getContact(leadId);
      if (!lead || lead.archived || !this.oversees(lead)) continue;
      this.conversations.pass(lead.id, {
        key: `gone:${manager.id}`,
        line: `${manager.name} ${why === 'deleted' ? 'was deleted' : why === 'put-away' ? 'was put away' : 'was turned off'} before it reported back.`,
        note: jobsDropped(
          manager.name,
          why,
          jobs.map((one) => one.about)
        ),
        from: manager.id,
      });
    }
  }

  /**
   * A contact was put away. A manager that owed its project manager an answer won't give it: that one hears so.
   * @param {Contact | undefined} contact
   */
  putAway(contact) {
    if (contact?.manages && !contact.leads) this.#gone(contact, 'put-away');
  }

  /**
   * What a worker's folder changed against the main line. Nothing, where git can't say.
   * @param {string} cwd
   * @returns {Promise<Pick<WorkerReport, 'branch' | 'mainLine' | 'files' | 'more'>>}
   */
  async #changesOf(cwd) {
    try {
      const changes = await this.changes.list(cwd);
      return changes.repository ? changes : NOTHING;
    } catch {
      return NOTHING;
    }
  }

  /**
   * What a manager is told about a worker. With `shared`, the files it changed that another conversation on its
   * project changed too, under any manager.
   * @param {Contact} worker
   * @param {{ shared?: boolean }} [opts]
   * @returns {Promise<WorkerReport>}
   */
  async #report(worker, { shared = false } = {}) {
    const entries = this.history.read(worker.id);
    const { branch, mainLine, files, more } = await this.#changesOf(worker.cwd);
    const invited = this.#invitedIn(worker);
    const reviews = this.#reviewsOf(worker);
    const report = {
      name: worker.name,
      provider: this.descriptor(worker.provider).name,
      status: DOING[this.conversations.view(worker).status] ?? 'idle',
      branch,
      folder: worker.cwd,
      // A slash command is the host's alone, and no task.
      task: entries.find((entry) => entry.kind === 'user' && !entry.text.startsWith('/'))?.text ?? '',
      // Its own, or another agent's that answers with it: not a guest's that a manager invited, which is a review.
      reply: entries.findLast((entry) => entry.kind === 'assistant' && !invited.has(entry.speaker))?.text ?? '',
      mainLine,
      files,
      more,
      ...(reviews.length && { reviews }),
    };
    if (!shared || !files.length) return report;
    const others = await this.#onProject(worker);
    const theirs = await Promise.all(
      others.map(async (one) => ({
        name: one.name,
        paths: new Set((await this.#changesOf(one.cwd)).files.map((file) => file.path)),
      }))
    );
    const both = files.flatMap(({ path: file }) => {
      const by = theirs.filter(({ paths }) => paths.has(file)).map(({ name }) => name);
      return by.length ? [{ path: file, by }] : [];
    });
    return { ...report, shared: both };
  }

  /**
   * The guests of a worker's conversation that a project's manager invited, by id.
   * @param {Contact} worker
   * @returns {Set<string>}
   */
  #invitedIn(worker) {
    return new Set((worker.guests ?? []).map((guest) => guest.id).filter((id) => this.store.getContact(id)?.invitedBy));
  }

  /**
   * What each guest a manager invited into a worker's conversation said last, where that came after the worker's
   * own last reply: what it found in the work since. In the order they said it.
   * @param {Contact} worker
   * @returns {{ name: string, text: string }[]}
   */
  #reviewsOf(worker) {
    const invited = this.#invitedIn(worker);
    if (!invited.size) return [];
    const entries = this.history.read(worker.id);
    const since = entries.findLastIndex((entry) => entry.kind === 'assistant' && !invited.has(entry.speaker));
    const last = new Map();
    for (const entry of entries.slice(since + 1)) {
      if (entry.kind === 'assistant' && invited.has(entry.speaker)) {
        last.delete(entry.speaker);
        last.set(entry.speaker, entry);
      }
    }
    return [...last.values()].map((entry) => ({
      name: this.store.getContact(entry.speaker)?.name ?? entry.speakerName ?? 'A guest',
      text: entry.text,
    }));
  }

  /**
   * The other conversations on a worker's project, whichever manager they are under, or none: their branches are
   * merged into the same one as its. A chat tab in its folder has the same changes, and is none of them.
   * @param {Contact} worker
   * @returns {Promise<Contact[]>}
   */
  async #onProject(worker) {
    const { key } = await this.projects.known(worker.cwd);
    const others = this.store.contacts.filter(
      (one) => !one.manages && !one.guestOf && !one.archived && one.cwd !== worker.cwd
    );
    const keys = await Promise.all(others.map(async (one) => (await this.projects.known(one.cwd)).key));
    return others.filter((_, i) => keys[i] === key);
  }

  /**
   * The manager a tool is asked of, its project, and what it is set up with. Throws for a contact that is no
   * manager, or turned off.
   * @param {string} managerId
   */
  #asking(managerId) {
    const manager = this.store.getContact(managerId);
    if (!this.oversees(manager)) throw new Error('Only a project’s manager has this, and this conversation is none.');
    const settings = /** @type {ManagerSettings} */ (this.#settingsOf(manager));
    return { manager, key: manager.manages, project: projectOfKey(manager.manages).name, settings };
  }

  /**
   * One of a manager's workers, by name. Throws, with the names there are, for one that is none of them.
   * @param {Contact} manager
   * @param {string} project
   * @param {string} name
   */
  #worker(manager, project, name) {
    const workers = this.workersOf(manager);
    const worker = workers.find((one) => sameName(one.name, String(name ?? '')));
    if (worker) return worker;
    const names = workers.map((one) => one.name);
    throw new Error(
      `No conversation working on ${project} is called “${name}”. ` +
        (names.length ? `These are: ${names.join(', ')}.` : 'There is none yet.')
    );
  }

  /**
   * How many messages a manager sent a worker since the user last wrote to it.
   * @param {string} workerId
   * @param {string} managerId
   */
  #sentSinceUser(workerId, managerId) {
    const entries = this.history.read(workerId);
    const since = entries.findLastIndex((entry) => entry.kind === 'user');
    return entries.slice(since + 1).filter((entry) => entry.kind === 'notice' && entry.from === managerId).length;
  }

  /**
   * A manager's message for one of its workers. Its window shows it at once, and its agent reads it once it
   * is free. A worker is sent as many as the agents of a conversation take turns on one message of the user's:
   * past that, the user is the one to hear of it.
   * @param {string} managerId
   * @param {string} to  the worker, by name
   * @param {string} text
   * @param {boolean} [urgent]  use the worker's Send now path for a correction
   * @returns {Promise<string>}  what the manager is told
   */
  async say(managerId, to, text, urgent = false) {
    const { manager, project } = this.#asking(managerId);
    const worker = this.#worker(manager, project, to);
    const said = String(text ?? '').trim();
    if (!said) throw new Error('Say what the message is.');
    if (said.length > MESSAGE_MAX) throw new Error(`A message is at most ${MESSAGE_MAX} characters.`);
    const limit = this.store.settings.turnLimit ?? DEFAULT_TURN_LIMIT;
    if (this.#sentSinceUser(worker.id, manager.id) >= limit) {
      throw new Error(
        `${worker.name} was sent ${limit} messages of yours since the user last wrote to it, which is as many ` +
          'as it is sent. Tell the user what is left instead.'
      );
    }
    const busy = this.conversations.view(worker).status !== 'online';
    // The user stopped it: what it is sent waits for them, also an urgent message (see Conversations#hurryNote).
    const stopped = Boolean(this.conversations.stopped?.(worker.id));
    const key = `${manager.id}:${crypto.randomUUID()}`;
    this.conversations.pass(worker.id, {
      // Each its own: several sent while it works are all read.
      key,
      line: `${manager.name} says: ${oneLine(said, SAID_MAX)}`,
      note: managerMessage(manager.name, said),
      from: manager.id,
    });
    const delivery = stopped
      ? 'stopped'
      : urgent
        ? await this.conversations.hurryNote(worker.id, key)
        : busy
          ? 'waiting'
          : 'sent';
    const timing =
      delivery === 'stopped'
        ? '. The user stopped it, so it waits until the user writes to it or sends it now'
        : delivery === 'next-step'
          ? ', requested through Send now; delivery is at its next step after the current turn is interrupted'
          : delivery === 'waiting'
            ? ', and it waits until the worker is free'
            : '';
    return (
      `${worker.name} has your message${timing}. ` +
      'You are sent its answer: carry on meanwhile, without waiting for it.'
    );
  }

  /**
   * A conversation's agent asks on a card of questions, and waits for the answer: the manager over it hears at once,
   * with everything it needs to answer (see answer_question in main/app-tools.js), as its turn goes on only once
   * someone does. A manager's own questions are the user's.
   * @param {string} contactId
   * @param {{ requestId: string, speaker?: string, questions?: Question[] }} prompt
   */
  questionAsked(contactId, { requestId, speaker, questions = [] }) {
    const worker = this.store.getContact(contactId);
    if (!worker || worker.manages || !questions.length) return;
    const manager = this.managerOf(worker);
    if (!manager) return;
    // A guest in its conversation, such as a reviewer the manager invited, can ask too.
    const asker = speaker && speaker !== worker.id ? (this.store.getContact(speaker)?.name ?? '') : '';
    const asks = questions.length === 1 ? 'asks' : `asks ${questions.length} questions`;
    this.conversations.pass(manager.id, {
      key: `question:${requestId}`,
      line: `${asker ? `${asker} in ${worker.name}` : worker.name} ${asks}: ${oneLine(questions.map((q) => q.question).join(' '))}`,
      note: questionNote(worker.name, questions, { card: requestId, asker }),
      from: worker.id,
    });
  }

  /**
   * A manager answers a card of questions one of its workers waits on (see answer_question in main/app-tools.js), as
   * the user would on the card: the worker goes on with the answers as theirs, and its window says whose they are. The
   * first answer counts. Throws, in a sentence for the manager, for a conversation it doesn't oversee, one that waits
   * on no question, a card answered already, and answers that don't fit the card. A permission, a plan or project
   * instructions are never answered so: those are the user's.
   * @param {string} managerId
   * @param {string} to  the worker, by name
   * @param {{ options?: string[], own_answer?: string }[]} answers  one for each question, in order
   * @param {string} [card]  which card, by its id as the note gives it, where the worker waits on more than one
   * @returns {Promise<string>}  what the manager is told
   */
  async answer(managerId, to, answers, card = '') {
    const { manager, project } = this.#asking(managerId);
    const worker = this.#worker(manager, project, to);
    const { requestId, questions = [] } = this.#questionCard(worker, String(card ?? '').trim());
    const given = answersTo(worker.name, questions, answers);
    // Checked and answered at once, with nothing in between: the user's answer can't come first and be undone.
    if (!this.conversations.answerFor(worker.id, requestId, given, { id: manager.id, name: manager.name })) {
      throw new Error(`${worker.name}’s question was answered already. Nothing was sent.`);
    }
    this.onAnswered();
    const goesOn = questions.length > 1 ? 'answers, and goes on with them' : 'answer, and goes on with it';
    return [
      `${worker.name} has your ${goesOn}:`,
      ...questions.map((question, i) => `${i + 1}. ${question.question} ${given[question.question]}`),
    ].join('\n');
  }

  /**
   * What the card of questions a manager's worker waits on asks, for the manager's answer to be shown under: the
   * one card, or the one `card` names. None for anything else, as for a contact that is no manager.
   * @param {string} managerId
   * @param {string} to  the worker, by name
   * @param {string} [card]
   * @returns {string[]}
   */
  questionsOf(managerId, to, card = '') {
    try {
      const { manager, project } = this.#asking(managerId);
      const { questions = [] } = this.#questionCard(this.#worker(manager, project, to), String(card ?? '').trim());
      return questions.map((question) => question.question);
    } catch {
      return [];
    }
  }

  /**
   * The card of questions a worker waits on: its one, or the one `card` names. Throws, for the manager, where there is
   * none to answer: it waits on an approval, which is the user's, or none at all, or its last was answered already.
   * @param {Contact} worker
   * @param {string} card  a card's id, or '' for its one
   * @returns {{ requestId: string, questions?: Question[] }}
   */
  #questionCard(worker, card) {
    const waiting = this.conversations.waitingOn(worker.id);
    const cards = waiting.filter((prompt) => prompt.kind === 'question');
    const approvals = waiting.filter((prompt) => prompt.kind !== 'question');
    const named = card ? cards.find((prompt) => prompt.requestId === card) : cards.length === 1 ? cards[0] : null;
    if (named) return named;
    if (cards.length > 1 && !card) {
      throw new Error(
        `${worker.name} has ${cards.length} question cards waiting: say which with card, by the id its note gives: ` +
          `${cards.map((prompt) => prompt.requestId).join(', ')}.`
      );
    }
    if (approvals.length && (!card || approvals.some((prompt) => prompt.requestId === card))) {
      const what = listed(approvals.map((prompt) => APPROVALS[prompt.kind] ?? 'a permission'));
      const which =
        approvals.length === 1
          ? `an approval (${what}), which is`
          : `${approvals.length} approvals (${what}), which are`;
      throw new Error(
        `${worker.name} has no question waiting: it waits on ${which} the user’s to answer. Tell the user what it waits on.`
      );
    }
    const last = this.#lastQuestion(worker, card);
    if (card && last) throw new Error(`${worker.name}’s question ${last}. Nothing was sent.`);
    if (card) throw new Error(`${worker.name} has no question card ${card} waiting.`);
    throw new Error(`${worker.name} has no question waiting${last ? `: its last one ${last}` : ''}.`);
  }

  /**
   * How a worker's last card of questions was answered, or the one `card` names, as its history keeps it: '' for none.
   * @param {Contact} worker
   * @param {string} card
   */
  #lastQuestion(worker, card) {
    const entry = this.history
      .read(worker.id)
      .findLast(
        (one) => one.kind === 'permission' && one.promptKind === 'question' && (!card || one.requestId === card)
      );
    if (!entry) return '';
    if (entry.decision === 'skip') return 'was skipped by the user';
    if (entry.decision !== 'answer') return 'went away unanswered, as its turn ended';
    const said = Object.values(entry.answers ?? {}).join('; ');
    return `was answered already, by ${entry.answeredBy?.name ?? 'the user'}${said ? `: ${said}` : ''}`;
  }

  /**
   * A manager invites another agent into one of its workers' conversations (see invite_to_conversation in
   * main/app-tools.js): of the service named, or the role's, with the model and effort level asked for, and the
   * role of the user's it names, by name. Without a role it is a reviewer (REVIEW_ROLE). Throws, for the manager,
   * for a conversation it doesn't oversee, one put away, and a role there isn't.
   * @param {string} managerId
   * @param {{ to: string, service?: string, model?: string, effort?: string, role?: string, message?: string }} asked
   * @returns {Promise<string>}  what the manager is told
   */
  async invite(managerId, { to, service = '', model = '', effort = '', role: roleName = '', message = '' }) {
    const { manager, project } = this.#asking(managerId);
    const worker = this.#overseen(manager, project, to);
    const roles = this.store.settings.roles ?? [];
    const wanted = String(roleName ?? '').trim();
    const role = wanted ? roleNamed(roles, wanted) : null;
    if (wanted && !role) throw new Error(`${noSuchRole(roles, wanted)} Leave role out for a reviewer.`);
    const provider = String(service ?? '').trim() || role?.provider || '';
    if (!provider) throw new Error('Say which service it is to be, such as claude or codex.');
    const said = String(message ?? '').trim();
    if (said.length > MESSAGE_MAX) throw new Error(`A message is at most ${MESSAGE_MAX} characters.`);
    const joined = await this.conversations.inviteAsked(worker.id, {
      provider,
      model: String(model ?? '').trim(),
      effort: String(effort ?? '').trim(),
      role,
      by: manager,
      message: said,
    });
    const where = `${worker.name}’s conversation`;
    if (joined.already) return `${joined.agent} is in ${where} already, as ${joined.name}. Nobody else joined.`;
    this.onInvited();
    const answers = (role ?? REVIEW_ROLE).answers;
    const when = joined.starts
      ? 'It starts on what you asked once it has the turn.'
      : said
        ? `${worker.name}’s conversation waits for the user to write to it (its round was stopped, or took all its ` +
          'turns), so it starts on what you asked with its next turn.'
        : answers === 'changes'
          ? `It answers once ${worker.name} next changes files.`
          : answers === 'mentioned'
            ? 'It answers when it is mentioned there.'
            : `It answers the next message there with ${worker.name}.`;
    return (
      `${joined.agent} has joined ${where} as ${joined.name}. ${when} ` +
      `What it says there reaches you in ${worker.name}’s notes, once its round is over.`
    );
  }

  /**
   * One of a manager's workers, by name, for an agent to join. Throws for one put away, and as `#worker` does for
   * any that is none of them.
   * @param {Contact} manager
   * @param {string} project
   * @param {string} name
   */
  #overseen(manager, project, name) {
    const away = this.store.contacts.find(
      (one) =>
        one.archived &&
        !one.manages &&
        !one.guestOf &&
        ((one.tabOf ? this.store.getContact(one.tabOf) : one)?.managedBy ?? null) === manager.id &&
        sameName(one.name, String(name ?? ''))
    );
    if (away && !this.workersOf(manager).some((one) => sameName(one.name, String(name ?? '')))) {
      throw new Error(`${away.name} is put away, so nobody can join it.`);
    }
    return this.#worker(manager, project, name);
  }

  /**
   * A manager looks at its workers: each with where it works, what it was asked and said last, and what it
   * changed. Or at one of them, by name, with its diff.
   * @param {string} managerId
   * @param {string} [name]
   * @returns {Promise<string>}
   */
  async look(managerId, name) {
    const { manager, project, settings } = this.#asking(managerId);
    const heading = (report) => `${report.name} (${report.provider}, ${report.status})`;
    if (!String(name ?? '').trim()) {
      const workers = this.workersOf(manager);
      if (!workers.length) return `No other conversation works on ${project} yet.`;
      const reports = await Promise.all(workers.map((worker) => this.#report(worker)));
      return [
        `The conversations working on ${project}:`,
        ...reports.map((report) => `${heading(report)}\n${workerLines(report, { said: OVERVIEW_SAID })}`),
      ].join('\n\n');
    }
    const worker = this.#worker(manager, project, name);
    const report = await this.#report(worker, { shared: settings.checks.includes('overlap') });
    return [heading(report), workerLines(report), await this.#diff(worker.cwd, report.files)]
      .filter(Boolean)
      .join('\n\n');
  }

  /**
   * The diff of the files a worker changed, as far as DIFF_MAX goes.
   * @param {string} cwd
   * @param {WorkerReport['files']} files
   */
  async #diff(cwd, files) {
    const parts = [];
    let left = DIFF_MAX;
    for (const [at, file] of files.entries()) {
      if (left <= 0) {
        const more = files.length - at;
        parts.push(`(The diff of ${more} more ${more === 1 ? 'file' : 'files'} is left out: read them in its folder.)`);
        break;
      }
      try {
        const { text, binary } = await this.changes.diff(cwd, file);
        if (binary || !text) continue;
        const kept = text.length > left ? `${text.slice(0, left)}…` : text;
        parts.push(kept);
        left -= kept.length;
      } catch {
        // Gone since it was listed.
      }
    }
    return parts.length ? `The diff:\n${parts.join('\n')}` : '';
  }

  // ---- a project manager's tools ---------------------------------------------------------------

  /**
   * The project manager a tool is asked of, its project and its name. Throws for a contact that is none, or turned
   * off, or put away.
   * @param {string} leadId
   */
  #leading(leadId) {
    const lead = this.store.getContact(leadId);
    if (!lead || lead.archived || !this.leads(lead) || !this.oversees(lead)) {
      throw new Error('Only a project manager has this, and this conversation is none.');
    }
    return { lead, key: lead.manages, project: projectOfKey(lead.manages).name };
  }

  /**
   * One of the managers a project manager oversees, by name. Throws, for the project manager to pass on, for one that
   * is turned off, put away or none of the project's, with the ones at work.
   * @param {Contact} lead
   * @param {string} project
   * @param {string} name
   */
  #managerNamedBy(lead, project, name) {
    const asked = String(name ?? '').trim();
    const working = this.managersUnder(lead);
    const found = working.find((one) => sameName(one.name, asked));
    if (found) return found;
    const atWork = working.length ? `The managers at work are: ${working.map((one) => one.name).join(', ')}.` : '';
    const other = this.#managersOf(lead.manages).find((one) => !one.leads && sameName(one.name, asked));
    if (other) {
      throw new Error(`${other.name} is ${other.archived ? 'put away' : 'turned off'}, so it can’t take it. ${atWork}`);
    }
    throw new Error(`No manager of ${project} is called “${asked}”. ${atWork || 'None is at work yet.'}`);
  }

  /**
   * The conversations working on a project, under any manager or none: the ones on its contact list, its managers,
   * guests and chat tabs aside. A folder that is gone is known by where it was.
   * @param {string} key
   * @returns {Promise<Contact[]>}
   */
  async #conversationsOf(key) {
    const listed = this.store.contacts.filter((one) => !one.manages && !one.guestOf && !one.tabOf && !one.archived);
    const keys = await Promise.all(listed.map(async (one) => (await this.projects.known(one.cwd)).key));
    return listed.filter((one, i) => keys[i] === key || this.#wasIn(one.cwd, key));
  }

  /**
   * One of a project's conversations, by name, whose job a project manager hands on or looks at. Throws, with the
   * ones there are, for one that is none of them.
   * @param {string} key
   * @param {string} project
   * @param {string} name
   */
  async #jobOf(key, project, name) {
    const asked = String(name ?? '').trim();
    const conversations = await this.#conversationsOf(key);
    const found = conversations.find((one) => sameName(one.name, asked));
    if (found) return found;
    const names = conversations.slice(0, TEAMS_LISTED).map((one) => one.name);
    throw new Error(
      `No conversation working on ${project} is called “${asked}”. ` +
        (names.length
          ? `These are: ${names.join(', ')}${conversations.length > names.length ? ', …' : ''}.`
          : 'There is none yet.')
    );
  }

  /**
   * A worker's job as a project manager hands it on: what its manager is told of it, with the manager it is under
   * and its pull request.
   * @param {Contact} worker
   * @returns {Promise<JobReport>}
   */
  async #jobReport(worker) {
    const report = await this.#report(worker);
    return {
      ...report,
      manager: this.managerOf(worker)?.name ?? '',
      pullRequest: pullRequestLine(this.conversations.view(worker).pullRequest),
    };
  }

  /** What a manager is doing, as a project manager is told it. @param {Contact} manager */
  #managerState(manager) {
    if (manager.archived) return 'put away';
    if (!this.oversees(manager)) return 'turned off';
    if (this.conversations.stopped?.(manager.id)) return 'stopped by the user: messages wait until the user writes';
    return DOING[this.conversations.view(manager).status] ?? 'idle';
  }

  /** A manager as a project manager's look at the teams has it, on a line. @param {Contact} manager */
  #managerLine(manager) {
    const settings = this.#settingsOf(manager);
    const service = this.descriptor(manager.provider).name;
    const team = this.store.contacts.filter((one) => one.managedBy === manager.id && !one.archived).length;
    const said = this.history.read(manager.id).findLast((entry) => entry.kind === 'assistant')?.text ?? '';
    return (
      `- ${manager.name} (${this.#managerState(manager)}, ${service}${settings?.model ? ` ${settings.model}` : ''}, ` +
      `${team === 1 ? '1 conversation' : `${team} conversations`})` +
      (said ? `: “${oneLine(said, TEAMS_MANAGER_SAID)}”` : '')
    );
  }

  /**
   * A project manager looks at its project's teams. Without a name: each manager, then the workers most recently at
   * work, as many as TEAMS_LISTED, with how many more there are, a line each. With a manager's name: its workers,
   * each with its task, last reply and changed files. With a conversation's name: that worker's job, as a manager is
   * handed it. Never a diff: the reviewers read those.
   * @param {string} leadId
   * @param {{ manager?: string, conversation?: string }} [asked]
   * @returns {Promise<string>}
   */
  async teams(leadId, { manager: managerName = '', conversation = '' } = {}) {
    const { lead, key, project } = this.#leading(leadId);
    if (String(conversation ?? '').trim()) {
      const job = await this.#jobReport(await this.#jobOf(key, project, conversation));
      return [`${job.name} (${job.provider}, ${job.status})`, jobLines(job)].join('\n');
    }
    const managers = this.#managersOf(key).filter((one) => !one.leads);
    if (String(managerName ?? '').trim()) {
      const manager = managers.find((one) => sameName(one.name, String(managerName).trim()));
      if (!manager) {
        throw new Error(
          `No manager of ${project} is called “${String(managerName).trim()}”. ` +
            (managers.length ? `These are: ${managers.map((one) => one.name).join(', ')}.` : 'It has none yet.')
        );
      }
      const workers = this.store.contacts.filter(
        (one) => one.managedBy === manager.id && !one.archived && !one.tabOf && !one.guestOf
      );
      const jobs = await Promise.all(workers.map((worker) => this.#jobReport(worker)));
      return [
        this.#managerLine(manager).slice(2),
        ...(jobs.length
          ? jobs.map(
              (job) =>
                `${job.name} (${job.provider}, ${job.status})\nPull request: ${job.pullRequest || 'none yet'}\n` +
                workerLines(job, { said: OVERVIEW_SAID })
            )
          : ['No conversation is under it.']),
      ].join('\n\n');
    }
    const conversations = (await this.#conversationsOf(key)).sort(
      (a, b) => (this.history.lastActive(b.id) ?? 0) - (this.history.lastActive(a.id) ?? 0)
    );
    const listed = conversations.slice(0, TEAMS_LISTED);
    const lines = await Promise.all(
      listed.map(async (worker) => {
        const { branch, files, more } = await this.#changesOf(worker.cwd);
        const view = this.conversations.view(worker);
        const said = this.history.read(worker.id).findLast((entry) => entry.kind === 'assistant')?.text ?? '';
        const pr = view.pullRequest;
        const tags = pr ? pullRequestTags(pr).map((tag) => tag.text) : [];
        return [
          `- ${worker.name}`,
          this.managerOf(worker) ? `under ${this.managerOf(worker)?.name}` : 'under no manager',
          DOING[view.status] ?? 'idle',
          branch ?? 'no branch',
          ...(pr ? [`PR #${pr.number}${tags.length ? ` (${tags.join(', ')})` : ''}`] : []),
          `${filesCount(files.length + more)} changed`,
          ...(said ? [`“${oneLine(said, TEAMS_WORKER_SAID)}”`] : []),
        ].join(' · ');
      })
    );
    const rest = conversations.length - listed.length;
    return [
      `${project}: ${managers.length === 1 ? '1 manager' : `${managers.length} managers`}, ` +
        `${conversations.length === 1 ? '1 conversation' : `${conversations.length} conversations`}.`,
      managers.length ? ['Managers:', ...managers.map((one) => this.#managerLine(one))].join('\n') : 'No managers yet.',
      listed.length
        ? [
            'Workers, the most recently at work first:',
            ...lines,
            ...(rest ? [`and ${rest} more: ask with manager or conversation for them.`] : []),
          ].join('\n')
        : 'No conversation works on it yet.',
      `You are ${lead.name}.`,
    ].join('\n\n');
  }

  /**
   * A project manager's message for one of the managers it oversees, with a worker's job where it hands one on. The
   * manager's window shows it at once, and its agent reads it once it is free, as an approved message where the user
   * approved it. One that went without the user's approval holds that manager's new conversations for the user
   * until the user writes to it (see startsAtOnce). A manager is sent as many as the agents of a conversation take
   * turns on one message of the user's: past that, the user is the one to hear of it.
   * @param {string} leadId
   * @param {string} to  the manager, by name
   * @param {string} text
   * @param {{ job?: string, urgent?: boolean, approve: () => Promise<boolean> }} how  `job`: a conversation of the
   *   project, by name. `approve` asks the user, once the message can go: true where they approved it, false where
   *   the mode they picked lets it go unasked. It throws where they didn't, and nothing goes
   * @returns {Promise<string>}  what the project manager is told
   */
  async tellManager(leadId, to, text, { job = '', urgent = false, approve }) {
    const said = String(text ?? '').trim();
    if (!said) throw new Error('Say what the message is.');
    if (said.length > MESSAGE_MAX) throw new Error(`A message is at most ${MESSAGE_MAX} characters.`);
    // Whom it goes to, about which job, and whether it may go at all, are known before the user is asked.
    const check = async () => {
      const { lead, key, project } = this.#leading(leadId);
      const manager = this.#managerNamedBy(lead, project, to);
      const worker = String(job ?? '').trim() ? await this.#jobOf(key, project, job) : null;
      const limit = this.store.settings.turnLimit ?? DEFAULT_TURN_LIMIT;
      if (this.#sentSinceUser(manager.id, lead.id) >= limit) {
        throw new Error(
          `${manager.name} was sent ${limit} messages of yours since the user last wrote to it, which is as many ` +
            'as it is sent. Tell the user what is left instead.'
        );
      }
      return { lead, manager, worker };
    };
    await check();
    const approved = await approve();
    // As things are once the user answered: the manager may have been turned off meanwhile.
    const { lead, manager, worker } = await check();
    // Its own worker it knows already: the job is told in full to another team's manager alone.
    const yours = worker && this.managerOf(worker)?.id === manager.id ? worker.name : '';
    const report = worker && !yours ? await this.#jobReport(worker) : null;
    const stopped = Boolean(this.conversations.stopped?.(manager.id));
    const busy = this.conversations.view(manager).status !== 'online';
    const noteKey = `${lead.id}:${approved ? 'ok' : 'own'}:${crypto.randomUUID()}`;
    this.conversations.pass(manager.id, {
      key: noteKey,
      // Another team's job is handed over; a word about one of its own workers is said about it.
      line: `${lead.name} ${yours ? `says, about ${yours}` : worker ? `hands over ${worker.name}’s job` : 'says'}: ${oneLine(said, SAID_MAX)}`,
      note: leadMessage(lead.name, said, { approved, job: report, yours }),
      from: lead.id,
    });
    if (!approved) {
      const line = this.history.read(manager.id).findLast((entry) => entry.kind === 'notice' && entry.from === lead.id);
      if (line) this.#unapproved.set(manager.id, line.id);
    }
    if (!this.#owed.has(manager.id)) this.#owed.set(manager.id, new Map());
    this.#owed.get(manager.id)?.set(noteKey, {
      lead: lead.id,
      about: worker ? `${worker.name}’s job` : `“${oneLine(said, 60)}”`,
      job: Boolean(worker),
    });
    // The user stopped it: Send now would undo that, so an urgent message waits like any other.
    const delivery = stopped
      ? 'stopped'
      : urgent && this.conversations.hurryNote
        ? await this.conversations.hurryNote(manager.id, noteKey)
        : busy
          ? 'waiting'
          : 'sent';
    const timing =
      delivery === 'stopped'
        ? '. The user stopped it, so it waits until the user writes to it'
        : delivery === 'next-step'
          ? ', requested through Send now; delivery is at its next step after the current turn is interrupted'
          : delivery === 'waiting'
            ? ', and it waits until the manager is free'
            : '';
    return (
      `${manager.name} has your message${timing}. ` +
      (approved
        ? 'The user approved it. '
        : 'It went without the user’s approval, so it is that manager’s own idea. ') +
      'You are sent its answer, and its report once the result is in: carry on meanwhile, without waiting for it.'
    );
  }

  /**
   * A manager's report to its project manager: a job's result that came in later, such as a review's verdict. It is
   * answered as a worker's answer is, without asking the user. A manager sends as many as the user allows for each
   * of their messages to the project manager: past that, it tells the user.
   * @param {string} managerId
   * @param {string} text
   * @returns {string}  what the manager is told
   */
  report(managerId, text) {
    const { manager, project } = this.#asking(managerId);
    if (manager.leads) throw new Error('A project manager reports to the user, in its own conversation.');
    const lead = this.leadOf(manager);
    if (!lead) {
      throw new Error(`No project manager oversees the managers of ${project}, so there is nobody to report to.`);
    }
    const said = String(text ?? '').trim();
    if (!said) throw new Error('Say what the report is.');
    if (said.length > REPORT_UP_MAX) {
      throw new Error(
        `A report is at most ${REPORT_UP_MAX} characters: the verdict, what must change, and which worker.`
      );
    }
    const limit = this.store.settings.turnLimit ?? DEFAULT_TURN_LIMIT;
    const entries = this.history.read(lead.id);
    const since = entries.findLastIndex((entry) => entry.kind === 'user');
    const reports = entries
      .slice(since + 1)
      .filter(
        (entry) =>
          entry.kind === 'notice' && entry.from === manager.id && entry.text?.startsWith(`${manager.name} reports:`)
      );
    if (reports.length >= limit) {
      throw new Error(
        `You sent ${lead.name} ${limit} reports since the user last wrote to it, which is as many as it is sent. ` +
          'Tell the user instead.'
      );
    }
    this.conversations.pass(lead.id, {
      key: `report:${manager.id}:${crypto.randomUUID()}`,
      line: `${manager.name} reports: ${oneLine(said, SAID_MAX)}`,
      note: reportToLead(manager.name, said),
      from: manager.id,
    });
    const owed = this.#owed.get(manager.id);
    for (const [noteKey, one] of owed ?? []) if (one.lead === lead.id) owed?.delete(noteKey);
    return `${lead.name} has your report. Carry on meanwhile, without waiting for its answer.`;
  }

  /**
   * Whether a conversation a contact's agent starts may start at once where it says the user asked for it. Not for a
   * manager its project manager sent a message without the user's approval, until the user writes to it after that:
   * what it starts meanwhile is its own idea, and waits for the user to send its first message.
   * @param {string} hostId
   */
  startsAtOnce(hostId) {
    const noted = this.#unapproved.get(hostId);
    if (!noted) return true;
    const entries = this.history.read(hostId);
    const at = entries.findIndex((entry) => entry.id === noted);
    if (at >= 0 && !entries.slice(at + 1).some((entry) => entry.kind === 'user')) return false;
    this.#unapproved.delete(hostId);
    return true;
  }

  /**
   * A manager reads its project's brief, or saves it. Settings shows it, under the project.
   * @param {string} managerId
   * @param {string} [text]  all of it from now on; left out to read it
   * @returns {string}  what the manager is told
   */
  brief(managerId, text) {
    const { manager, project, settings } = this.#asking(managerId);
    if (text === undefined) {
      return settings.brief ? `The brief of ${project}:\n\n${settings.brief}` : `${project} has no brief yet.`;
    }
    if (String(text).length > BRIEF_MAX) {
      throw new Error(`A brief is at most ${BRIEF_MAX} characters. Keep what matters most.`);
    }
    this.#save(manager, { ...settings, brief: text });
    return `Saved the brief of ${project}. The user sees it in Settings, on the project’s Manager page.`;
  }

  /**
   * A manager reads its project's sources, or adds some and takes some out: a link the user shared with it,
   * say. One that is there already, by its link or else by its name, is not added again. Settings shows them,
   * under the project.
   * @param {string} managerId
   * @param {{ add?: unknown[], remove?: unknown[] }} [change]  sources to add; ones to take out, by name or link
   * @returns {string}  what the manager is told
   */
  sources(managerId, { add = [], remove = [] } = {}) {
    const { manager, project, settings } = this.#asking(managerId);
    const asked = cleanSources(add);
    const out = new Set(
      remove
        .map((one) =>
          String(one ?? '')
            .trim()
            .toLowerCase()
        )
        .filter(Boolean)
    );
    if (!asked.length && !out.size) {
      return settings.sources.length
        ? `The sources of ${project}:\n${sourceList(settings.sources)}`
        : `${project} has no sources yet.`;
    }
    const named = (source, words) => words.has(source.name.toLowerCase()) || words.has(source.url.toLowerCase());
    const removed = settings.sources.filter((source) => named(source, out));
    const kept = settings.sources.filter((source) => !named(source, out));
    const same = (a, b) => (a.url || b.url ? a.url === b.url : a.name.toLowerCase() === b.name.toLowerCase());
    const added = [];
    const there = [];
    for (const source of asked) {
      if ([...kept, ...added].some((one) => same(one, source))) there.push(source);
      else added.push(source);
    }
    if (kept.length + added.length > SOURCES_MAX) {
      throw new Error(`A project has at most ${SOURCES_MAX} sources. Take out the ones that no longer hold first.`);
    }
    if (added.length || removed.length) {
      this.#save(manager, { ...settings, sources: [...kept, ...added] });
    }
    const said = (sources) => sources.map(sourceLine).join(', ');
    return [
      added.length && `Added to the sources of ${project}: ${said(added)}.`,
      removed.length && `Taken out: ${said(removed)}.`,
      there.length && `Already there: ${said(there)}.`,
      out.size > removed.length && 'Some you asked to take out were not there.',
      (added.length || removed.length) && 'The user sees them in Settings, on the project’s Manager page.',
    ]
      .filter(Boolean)
      .join(' ');
  }

  /**
   * The user changed what one of a project's managers is set up with, in Settings: the one `after` names, or the
   * first. Turned on, the project's first gets its manager: the contact that was its manager before, or a new one
   * in its main checkout, which starts by learning the project. It oversees the conversations under it: the ones
   * the user left under no manager stay so. Turned off, that contact stays, with its conversation and the ones
   * under it, and oversees nothing. While it is on, it is told what else changed. On or off, it answers with the
   * model picked for it. Throws, for the user, when the project has no main checkout to work in any more.
   * @param {string} key
   * @param {ManagerSettings} before
   * @param {ManagerSettings} after
   */
  settingsChanged(key, before, after, fallback = null, permissionMode) {
    const provider = this.#provider(after);
    const current = this.#managerNamed(key, after.id);
    if (current && (current.provider !== provider.id || fallback)) {
      const mode =
        fallback?.permissionMode ??
        permissionMode ??
        managerSwitchMode(this.descriptor(current.provider), current.permissionMode, provider);
      if (!provider.permissionModes.some((option) => option.id === mode)) {
        throw new Error(`Choose a permission mode for ${provider.name} before switching.`);
      }
      const recent = this.history
        .read(current.id)
        .filter((entry) => ['user', 'assistant', 'notice'].includes(entry.kind) && entry.text)
        .slice(-30)
        .map((entry) => `${entry.speakerName || entry.kind}: ${entry.text}`)
        .join('\n\n')
        .slice(-20000);
      this.conversations.switchProvider(current.id, provider, after.model, fallback, mode);
      if (current.archived && after.on) this.conversations.restoreContact(current.id);
      fallback?.ready();
      this.#handingOver.delete(current.id);
      this.onContactsChanged();
      if (after.on)
        this.conversations.pass(current.id, {
          key: 'settings',
          line: `${provider.name} takes over from the brief and recent conversation.`,
          note: [
            takeoverNote(projectOfKey(key).name, after, { lead: Boolean(current.leads) }),
            recent && `[Recent conversation before switching services]\n${recent}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        });
      return;
    }
    if (after.on && !before.on) return this.#start(key, after);
    const manager = this.#managerNamed(key, after.id);
    if (!manager) return;
    // On or off, it answers with the model picked for it here.
    if (after.model !== before.model) this.#answersWith(manager, after.model);
    if (!after.on && before.on) {
      // Its session was started with a manager's tools and instructions: the next one starts without.
      this.conversations.end(manager.id);
      // Turned on again, it is asked anew.
      this.#handingOver.delete(manager.id);
      this.conversations.notice(
        manager.id,
        `${manager.name} no longer oversees ${manager.leads ? 'the managers of ' : ''}${projectOfKey(key).name}.`
      );
      // What it owed its project manager an answer on, nobody is on now.
      if (!manager.leads) this.#gone(manager, 'turned-off');
      // Its row no longer leads its project's section.
      this.onContactsChanged();
      return;
    }
    const note = after.on && settingsNote(before, after);
    if (!note) return;
    const parts = changedParts(before, after);
    this.conversations.pass(manager.id, {
      key: 'settings',
      line: `Its ${listed(parts)} changed in Settings.`,
      note,
    });
  }

  /** A solo manager keeps its brief, notes and identity when a checked fallback takes over. */
  fallback(contactId, entry, permissionMode, ready) {
    const manager = this.store.getContact(contactId);
    const before = this.#settingsOf(manager);
    if (!manager || !before?.on) throw new Error('This manager is no longer active.');
    const after = { ...before, provider: entry.provider, model: entry.model };
    this.#save(manager, after);
    this.settingsChanged(manager.manages, before, after, { ...entry, permissionMode, ready });
  }

  /**
   * One of a project's managers, by its contact; the first for none, or for a contact that is none of them.
   * @param {string} key
   * @param {string | undefined} id
   */
  #managerNamed(key, id) {
    const named = id ? this.store.getContact(id) : null;
    return named?.manages === key && this.#settingsOf(named) ? named : this.#managerOfKey(key);
  }

  /** @param {ManagerSettings} settings */
  #provider(settings) {
    const id = settings.provider || 'claude';
    const provider = this.descriptor(id);
    if (provider.id !== id || !provider.appTools) throw new Error('Choose a service that supports manager tools.');
    return provider;
  }

  /** @param {string} key @param {ManagerSettings} settings */
  #start(key, settings) {
    const { name, root } = projectOfKey(key);
    let manager = this.#managerNamed(key, settings.id);
    if (manager?.archived) this.conversations.restoreContact(manager.id);
    if (!manager) {
      if (!fs.existsSync(root)) {
        throw new Error(`${name}’s main checkout is not at ${root} any more, so a manager has nowhere to work.`);
      }
      const provider = this.#provider(settings);
      manager = this.store.addContact({
        provider: provider.id,
        name: managerName(name),
        cwd: root,
        model: settings.model,
        permissionMode: provider.defaultPermissionMode,
        manages: key,
      });
    }
    // The first's settings name it, whichever contact it was found as.
    if (this.#managerOfKey(key)?.id === manager.id && this.#first(key).id !== manager.id) {
      this.projects.update(key, { manager: { ...this.#first(key), id: manager.id } });
    }
    this.#answersWith(manager, settings.model);
    this.#begin(manager, settings);
  }

  /**
   * A manager turned on, or added: its session is started anew, with a manager's tools and instructions, and it
   * starts by learning the project. One added from another manager's settings is told whose brief it has, if any.
   * @param {Contact} manager
   * @param {ManagerSettings} settings
   * @param {{ from?: string, brief?: boolean }} [start]  the manager it was added from, by name, and whether with its
   *   brief
   */
  #begin(manager, settings, { from = '', brief = false } = {}) {
    const { name } = projectOfKey(manager.manages);
    this.conversations.end(manager.id);
    this.onContactsChanged();
    if (manager.leads) {
      this.conversations.notice(
        manager.id,
        `${manager.name} oversees the managers of ${name}. It hears from them alone, and hands their work on as you ask.`
      );
      this.conversations.pass(manager.id, {
        key: 'settings',
        line: settings.brief ? 'It starts by reading the brief.' : 'It starts by looking at the teams.',
        note: leadStartNote(name, settings),
      });
      return;
    }
    this.conversations.notice(
      manager.id,
      `${manager.name} oversees the conversations on ${name} that are under it. It hears from each one that ` +
        'changes files.' +
        (from ? ` It starts from ${from}’s settings${brief ? ' and brief' : ''}.` : '')
    );
    this.conversations.pass(manager.id, {
      key: 'settings',
      line: settings.sources.length
        ? 'It starts by reading the sources.'
        : 'It starts by looking at the conversations.',
      note: startNote(name, settings, { briefOf: brief ? from : '' }),
    });
  }

  /**
   * Adds a manager to a project: a contact of the name given, in its main checkout, which oversees the
   * conversations put under it and starts by learning the project. A project without one has it for its first.
   * Another starts from nothing, or from what one of the project's managers is set up with (see startedFrom), with
   * that one's brief or without. Throws, for the user, for no name or one another of its managers has, for a project
   * with as many managers as one can have, for one whose main checkout is gone, and for a manager to start from that
   * is none of the project's.
   * @param {string} key
   * @param {{ name?: unknown, provider?: string, model?: unknown, link?: unknown, scope?: unknown, from?: unknown, withBrief?: unknown }} picked
   *   in "Add another manager": `from` is the manager it starts from, by id
   * @returns {Contact}
   */
  add(key, picked) {
    const { name: project, root } = projectOfKey(key);
    const lead = picked?.lead === true;
    const name =
      String(picked?.name ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, NAME_MAX) || (lead ? projectManagerName(project).slice(0, NAME_MAX) : '');
    if (!name) throw new Error('Give it a name, such as “release manager”.');
    const managers = this.#managersOf(key);
    const namesake = managers.find((one) => sameName(one.name, name));
    if (namesake) throw new Error(`${project} has a manager called ${namesake.name} already.`);
    if (lead) {
      const there = managers.find((one) => one.leads);
      if (there) throw new Error(`${project} has a project manager already: ${there.name}.`);
      if (!managers.some((one) => !one.archived)) {
        throw new Error(`${project} has no manager yet. Add one first: a project manager oversees the managers.`);
      }
    } else if (managers.filter((one) => !one.leads).length >= MANAGERS_MAX) {
      throw new Error(`${project} has ${MANAGERS_MAX} managers, as many as a project can have.`);
    }
    if (!fs.existsSync(root)) {
      throw new Error(`${project}’s main checkout is not at ${root} any more, so a manager has nowhere to work.`);
    }
    // Only one of this project's managers, archived or not, as one deleted meanwhile is none.
    const from = picked?.from ? managers.find((one) => one.id === picked.from) : null;
    if (picked?.from && !from) {
      throw new Error(`The manager to start from is no manager of ${project} any more. Pick another, or nothing.`);
    }
    const brief = Boolean(from) && picked?.withBrief === true;
    const model = typeof picked?.model === 'string' ? picked.model.trim() : '';
    const link = typeof picked?.link === 'string' ? picked.link : '';
    const provider = this.#provider(picked || {});
    const manager = this.store.addContact({
      provider: provider.id,
      name,
      cwd: root,
      model,
      permissionMode: provider.defaultPermissionMode,
      manages: key,
      ...(lead && { leads: true }),
    });
    // A project manager is never its project's first: that is a manager of conversations.
    const first = !lead && this.#managerOfKey(key)?.id === manager.id;
    // The first starts from what its project kept for it, as a manager deleted left it. Another from the one picked,
    // with the service, model and link picked in the dialog all the same.
    const base =
      from && !lead
        ? startedFrom(/** @type {ManagerSettings} */ (this.#settingsOf(from)), { brief })
        : first
          ? this.#first(key)
          : cleanManager({});
    const settings = cleanManager({
      ...turnedOn(base, { model, link, provider: provider.id }),
      // It oversees managers: what it checks, the conversations it starts out over and its workers are none of its.
      ...(picked?.scope !== undefined && !lead && { scope: picked.scope }),
      id: manager.id,
    });
    if (first) this.projects.update(key, { manager: settings });
    else this.projects.updateManagers(key, [...this.#others(key), settings]);
    this.onProjectChanged(key);
    this.#begin(manager, settings, lead ? {} : { from: from?.name, brief });
    // Its managers are drawn under it from now on.
    if (lead) this.onContactsChanged();
    return manager;
  }

  /**
   * A manager answers with `model` from now on: its session switches to it, and one it starts later starts with it.
   * @param {Contact} manager
   * @param {string} model
   */
  #answersWith(manager, model) {
    if (manager.model === model) return;
    // Kept on the contact before this resolves: a session that can't switch, such as one that is ending, starts with it.
    this.conversations.setModel(manager.id, model).catch(() => {});
  }

  /**
   * A contact was given another model, in its conversation or in its Edit dialog. A manager's is the one
   * Settings shows for it, under its project.
   * @param {string} contactId
   */
  modelChanged(contactId) {
    const contact = this.store.getContact(contactId);
    const settings = this.#settingsOf(contact);
    if (!contact || !settings || settings.model === contact.model) return;
    this.#save(contact, { ...settings, model: contact.model });
  }

  /**
   * A contact is being deleted. A project's first manager makes way for the next of the others; without one, the
   * project has no manager from now on, and what it was set up with stays, for the one added next to start with.
   * The conversations it had are under no manager (see Store.removeContact).
   * @param {Contact} contact
   */
  forgotten(contact) {
    const settings = this.#settingsOf(contact);
    if (!settings) return;
    const key = contact.manages;
    if (!contact.leads) this.#gone(contact, 'deleted');
    const others = this.#others(key);
    // The project manager is never the first: the next manager of conversations is.
    const next = others.find((one) => !this.store.getContact(one.id ?? '')?.leads);
    if (this.#managerOfKey(key)?.id !== contact.id) {
      this.projects.updateManagers(
        key,
        others.filter((one) => one.id !== contact.id)
      );
    } else if (next) {
      this.projects.update(key, { manager: next });
      this.projects.updateManagers(
        key,
        others.filter((one) => one !== next)
      );
    } else {
      if (!settings.id && !settings.on) return;
      const kept = { ...settings, on: false };
      delete kept.id;
      this.projects.update(key, { manager: kept });
    }
    this.onProjectChanged(key);
  }
}
