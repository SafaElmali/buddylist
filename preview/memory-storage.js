// In-memory versions of src/main/storage (same methods), seeded with example
// contacts so the preview opens in a realistic state.
import { ARCHIVE_LIMIT, summarize, toArchive } from '../src/main/storage/archive.js';
import { keepTabsTogether } from '../src/shared/chat-tabs.js';
import { DEFAULT_QUICK_MESSAGES } from '../src/shared/quick-messages.js';
import { DEFAULT_ROLES, DEFAULT_TEAMS } from '../src/shared/teams.js';
import { DEFAULT_LOOK, FIRST_THEME } from '../src/shared/theme.js';
import { DEFAULT_TURN_LIMIT } from '../src/shared/turn-limit.js';
import { DEFAULT_VOICE_SETTINGS } from '../src/shared/voice-settings.js';

const uid = () => globalThis.crypto.randomUUID();

/** `favorite`, `pinned`, `archived` and `paused` are kept as `true`, or not at all, as in src/main/storage/store.js. */
function tidyFlags(contact, flags = ['favorite', 'pinned', 'archived', 'paused']) {
  for (const flag of flags) {
    if (contact[flag]) contact[flag] = true;
    else delete contact[flag];
  }
}

function withoutGuest(host, guestId) {
  if (!host.guests) return;
  host.guests = host.guests.filter((guest) => guest.id !== guestId);
  if (!host.guests.length) delete host.guests;
}

export class MemoryStore {
  constructor() {
    this.reset();
  }

  reset() {
    const work = { id: uid(), name: 'Work' };
    const side = { id: uid(), name: 'Side projects' };
    this.data = {
      profile: { name: 'You', status: 'online', personalMessage: 'trying out the preview (*)', picture: null },
      settings: {
        sounds: true,
        // Professional, as a new install is, and by day, so the tour looks the same on every computer.
        theme: FIRST_THEME,
        look: DEFAULT_LOOK,
        showActivity: true,
        autoAway: true,
        showListening: false,
        removeWorktrees: false,
        quickMessages: DEFAULT_QUICK_MESSAGES.map((message) => ({ ...message })),
        roles: DEFAULT_ROLES.map((role) => ({ ...role })),
        teams: DEFAULT_TEAMS.map((team) => ({ ...team, roles: [...team.roles] })),
        // Schedules run in the app, which the preview has no Settings of.
        schedules: [],
        turnLimit: DEFAULT_TURN_LIMIT,
        limitFallbacks: {},
        branchPrefix: '',
        models: {},
        contactDefaults: {},
        projectsFolder: '/Users/you/projects',
        // The desktop here is a small one, and the contact list is right next to a conversation
        // on it. The conversation's own list of your contacts starts hidden: Contacts shows it.
        contactsPane: { shown: false },
        shortcuts: {},
        ...DEFAULT_VOICE_SETTINGS,
      },
      groups: [work, side],
      projects: {},
      contacts: [
        {
          id: uid(),
          provider: 'claude',
          name: 'Claude (buddylist)',
          cwd: '/Users/you/projects/buddylist',
          model: '',
          permissionMode: 'default',
          sessionId: null,
          groupId: side.id,
        },
        {
          id: uid(),
          provider: 'claude',
          name: 'Claude (website)',
          cwd: '/Users/you/projects/website',
          model: '',
          permissionMode: 'acceptEdits',
          sessionId: null,
          groupId: work.id,
        },
        {
          id: uid(),
          provider: 'claude',
          name: 'Claude (api)',
          cwd: '/Users/you/projects/api',
          model: '',
          permissionMode: 'default',
          sessionId: null,
          groupId: work.id,
        },
        {
          id: uid(),
          provider: 'codex',
          name: 'Codex (api)',
          cwd: '/Users/you/projects/api',
          model: '',
          permissionMode: 'ask',
          sessionId: null,
          groupId: work.id,
        },
        {
          id: uid(),
          provider: 'claude',
          name: 'Claude (old-blog)',
          cwd: '/Users/you/archive/old-blog',
          model: '',
          permissionMode: 'default',
          sessionId: null,
        },
      ],
    };
  }

  get profile() {
    return this.data.profile;
  }

  updateProfile(patch) {
    return Object.assign(this.data.profile, patch);
  }

  get settings() {
    return this.data.settings;
  }

  updateSettings(patch) {
    return Object.assign(this.data.settings, patch);
  }

  get deletedSessions() {
    return this.data.deletedSessions ?? [];
  }

  rememberDeletedSessions(ids) {
    this.data.deletedSessions = [
      ...new Set([...this.deletedSessions, ...ids.filter((id) => typeof id === 'string' && id)]),
    ];
  }

  get contacts() {
    return this.data.contacts.filter((c) => !c.guestOf);
  }

  getContact(id) {
    return this.data.contacts.find((c) => c.id === id);
  }

  addContact(fields) {
    const contact = { id: uid(), sessionId: null, ...fields };
    this.data.contacts.push(contact);
    return contact;
  }

  updateContact(id, patch) {
    const contact = this.getContact(id);
    if (!contact) return null;
    Object.assign(contact, patch);
    tidyFlags(contact);
    return contact;
  }

  removeContact(id) {
    this.data.contacts = this.data.contacts.filter((c) => c.id !== id && c.guestOf !== id);
    for (const host of this.data.contacts) withoutGuest(host, id);
    for (const contact of this.data.contacts) if (contact.startedBy === id) delete contact.startedBy;
    keepTabsTogether(this.data.contacts, id);
  }

  addGuest(hostId, { id, permissionMode }) {
    const host = this.getContact(hostId);
    if (!host) return null;
    const guest = { id, permissionMode, sessionId: null };
    host.guests = [...(host.guests || []), guest];
    return guest;
  }

  updateGuest(hostId, guestId, patch) {
    const guest = this.getContact(hostId)?.guests?.find((g) => g.id === guestId);
    if (!guest) return null;
    Object.assign(guest, patch);
    tidyFlags(guest, ['paused']);
    return guest;
  }

  removeGuest(hostId, guestId) {
    const host = this.getContact(hostId);
    if (host) withoutGuest(host, guestId);
  }

  get projects() {
    return this.data.projects;
  }

  getProject(key) {
    return this.data.projects[key];
  }

  removeProject(key) {
    delete this.data.projects[key];
  }

  updateProject(key, patch) {
    const project = { ...this.data.projects[key], ...patch };
    this.data.projects[key] = project;
    return project;
  }

  get groups() {
    return this.data.groups;
  }

  addGroup(name) {
    const group = { id: uid(), name };
    this.data.groups.push(group);
    return group;
  }

  renameGroup(id, name) {
    const group = this.data.groups.find((g) => g.id === id);
    return group ? Object.assign(group, { name }) : null;
  }

  removeGroup(id) {
    this.data.groups = this.data.groups.filter((g) => g.id !== id);
    for (const contact of this.data.contacts) {
      if (contact.groupId === id) contact.groupId = null;
    }
  }

  limitsOf(provider, account) {
    return this.data.limits?.[provider]?.[account] || [];
  }

  setLimits(provider, account, limits) {
    const logins = { ...this.data.limits?.[provider] };
    if (limits) logins[account] = limits;
    else delete logins[account];
    this.data.limits = { ...this.data.limits, [provider]: logins };
  }
}

export class MemoryHistory {
  #entries = new Map();
  /** contactId -> archived conversations */
  #archive = new Map();

  read(contactId) {
    return (this.#entries.get(contactId) || []).map((e) => ({ ...e }));
  }

  lastActive(contactId) {
    return this.#entries.get(contactId)?.at(-1)?.time ?? null;
  }

  append(contactId, entry) {
    const full = { id: uid(), time: Date.now(), ...entry };
    this.#entries.set(contactId, [...(this.#entries.get(contactId) || []), full]);
    return full;
  }

  update(contactId, entryId, patch) {
    const entry = (this.#entries.get(contactId) || []).find((e) => e.id === entryId);
    if (entry) Object.assign(entry, patch);
  }

  pin(contactId, entryId, pinned) {
    const entry = (this.#entries.get(contactId) || []).find((e) => e.id === entryId);
    if (!entry) return false;
    if (pinned) entry.pinned = true;
    else delete entry.pinned;
    return true;
  }

  rewind(contactId, entryId) {
    const entries = this.#entries.get(contactId) || [];
    const at = entries.findIndex((e) => e.id === entryId);
    if (at === -1) return false;
    this.#entries.set(contactId, entries.slice(0, at));
    return true;
  }

  remove(contactId, entryId) {
    const entries = this.#entries.get(contactId) || [];
    const at = entries.findIndex((e) => e.id === entryId);
    if (at === -1) return false;
    entries.splice(at, 1);
    return true;
  }

  moveToEnd(contactId, entryIds) {
    const entries = this.#entries.get(contactId);
    if (!entries) return;
    const moving = new Set(entryIds);
    this.#entries.set(contactId, [
      ...entries.filter((e) => !moving.has(e.id)),
      ...entries.filter((e) => moving.has(e.id)),
    ]);
  }

  clear(contactId) {
    this.#entries.delete(contactId);
  }

  begin(contactId, entries) {
    this.#entries.set(
      contactId,
      entries.map((e) => ({ ...e }))
    );
  }

  // ---- past conversations, newest first ---------------------------------------------------

  archive(contactId, about) {
    const conversation = toArchive(this.read(contactId), { ...about, id: uid(), contactId });
    this.clear(contactId);
    if (!conversation) return null;
    this.#archive.set(contactId, [conversation, ...(this.#archive.get(contactId) || [])].slice(0, ARCHIVE_LIMIT));
    return summarize(conversation);
  }

  listArchived(contactId) {
    return (this.#archive.get(contactId) || []).map(summarize);
  }

  readArchived(contactId, id) {
    return (this.#archive.get(contactId) || []).find((c) => c.id === id) || null;
  }

  async *eachArchived(contactId, { include = () => true } = {}) {
    for (const conversation of this.#archive.get(contactId) || []) {
      const summary = summarize(conversation);
      if (include(summary)) yield [summary, conversation];
    }
  }

  deleteArchived(contactId, id) {
    this.#archive.set(
      contactId,
      (this.#archive.get(contactId) || []).filter((c) => c.id !== id)
    );
  }

  clearArchive(contactId) {
    this.#archive.delete(contactId);
  }

  purge(contactId) {
    this.clear(contactId);
    this.clearArchive(contactId);
  }

  clearAll() {
    this.#entries.clear();
    this.#archive.clear();
  }
}
