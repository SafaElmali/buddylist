// What an agent can ask the app itself to do, next to what it does in its folder:
// open terminals beside the conversation, with a command running in them if one
// is asked for, start another conversation, for work that goes on apart from
// its own, or read and save what its project's agents are told. A project's
// manager (see shared/managers.js) also messages the conversations it oversees,
// answers the questions they wait on where the project settles them,
// invites other agents into them, such as a reviewer for each, looks at what
// they changed, and keeps the project's brief and sources, and
// reports to its project manager. A project manager messages the managers, hands
// a worker's job from one to another, and looks at the teams. The main process offers these as tools to a provider that takes any
// (main/app-tools.js), and a provider says what was asked for as an activity,
// so the windows word it like everything else an agent does.

import { defaultsOf, newContactStart } from './contact-defaults.js';
import { fallbackPermissionModes } from './limit-fallbacks.js';
import { REVIEW_ROLE } from './teams.js';

/** @typedef {import('../providers/contract.js').Activity} Activity */

/** The name the tools are offered under, as one server of them. */
export const APP_SERVER = 'messenger';

export const APP_TOOLS = Object.freeze({
  terminals: 'open_terminals',
  conversation: 'start_conversation',
  instructions: 'project_instructions',
  // A project's manager's alone.
  message: 'message_conversation',
  answer: 'answer_question',
  invite: 'invite_to_conversation',
  look: 'project_conversations',
  brief: 'project_brief',
  sources: 'project_sources',
  report: 'message_project_manager',
  // A project manager's alone.
  tellManager: 'message_manager',
  teams: 'project_teams',
});

/**
 * The agent starting a conversation supplies its service and settings. A guest's permission mode is
 * the one it has here, which may be stricter than in its own conversation. The host still supplies
 * the project and parent, so a guest never sends the worker to its own, unrelated folder.
 * @param {import('../main/storage/store.js').Contact | undefined} host
 * @param {import('../main/storage/store.js').Contact | undefined} speaker
 * @returns {import('../main/storage/store.js').Contact}
 */
export function conversationStarter(host, speaker) {
  if (!host || host.archived) throw new Error('This conversation is put away, so it can’t start another one.');
  if (speaker?.id === host.id) return host;
  const entry = host.guests?.find((guest) => guest.id === speaker?.id);
  if (!entry || !speaker || speaker.archived) {
    throw new Error('The agent is no longer in this conversation, so it can’t start another one.');
  }
  return { ...speaker, permissionMode: entry.permissionMode };
}

/**
 * @typedef {Object} WorkerStart  what a conversation another one's agent starts answers with
 * @property {string} provider
 * @property {string} model  '' for its service's default
 * @property {string | null} effort  null for its model's own
 * @property {string} permissionMode
 */

/**
 * What a conversation a project's manager starts answers with, as its New workers use has it (see NEW_WORKERS in
 * shared/managers.js). Your defaults are what Add a Contact starts out with (see newContactStart): the service of
 * the contact you added last yourself, with the model and effort level Settings > New contacts picks for it, and
 * otherwise that contact's. A manager, or a conversation an agent started, says nothing of yours. With none, the
 * service Add a Contact starts with. A service of your own choosing, or of your defaults, answers in the mode a new
 * contact of it starts in (the one New contacts picks, else its own), and never in the manager's, unless its
 * Permission mode says otherwise (see `mode` on NewWorkers): the same as the manager's, or no looser than it, or a
 * mode the user picked, which is the user's choice and so may be looser. A mode the worker's service doesn't have is
 * its default. The same as the manager is the agent that starts it (see conversationStarter): a guest is never in a
 * looser mode than the manager, or the worker is the manager's own where the guest's service has no mode that strict.
 * @param {import('./managers.js').NewWorkers} workers
 * @param {object} from
 * @param {import('../main/storage/store.js').Contact} from.manager
 * @param {import('../main/storage/store.js').Contact} from.starter  the agent that starts it, as conversationStarter says
 * @param {import('../main/storage/store.js').Contact | null} from.yours  the contact you added last yourself, if any
 * @param {(id: string) => import('../providers/contract.js').ProviderDescriptor} from.descriptor  a service, by id
 * @param {import('../providers/contract.js').ProviderDescriptor} from.first  the service Add a Contact starts with
 * @param {import('./contact-defaults.js').ContactDefaultsByService} [from.defaults]  Settings > New contacts
 * @returns {WorkerStart}
 */
export function workerStart(workers, from) {
  const start = serviceStart(workers, from);
  const { manager, descriptor } = from;
  const service = descriptor(start.provider);
  if (workers.mode === 'picked') {
    const exists = service.permissionModes.some((option) => option.id === workers.permissionMode);
    return { ...start, permissionMode: exists ? workers.permissionMode : service.defaultPermissionMode };
  }
  // Where the service is the manager's, its mode is the manager's; where it is another, the nearest that is no looser.
  if (workers.mode === 'manager' && workers.use !== 'manager') {
    const allowed =
      start.provider === manager.provider
        ? [manager.permissionMode]
        : fallbackPermissionModes(descriptor(manager.provider), manager.permissionMode, service);
    return { ...start, permissionMode: allowed[0] ?? service.defaultPermissionMode };
  }
  return start;
}

/** The service, model and effort of a worker, and the mode its use gives it before its Permission mode says. */
function serviceStart(workers, { manager, starter, yours, descriptor, first, defaults }) {
  const known = (id) => (id && descriptor(id).id === id ? descriptor(id) : null);
  /** A service in the mode a new contact of it starts in: the one Settings > New contacts picks, else its own. */
  const own = (provider, model = '', effort = null) => ({
    provider: provider.id,
    model,
    effort,
    permissionMode: defaultsOf(defaults, provider).permissionMode ?? provider.defaultPermissionMode,
  });
  const like = (contact, permissionMode) => ({
    provider: contact.provider,
    model: contact.model,
    effort: contact.effort ?? null,
    permissionMode,
  });
  if (workers.use === 'manager') {
    if (starter.id === manager.id) return like(manager, manager.permissionMode);
    const same = starter.provider === manager.provider && starter.permissionMode === manager.permissionMode;
    const allowed = same
      ? [starter.permissionMode]
      : fallbackPermissionModes(descriptor(manager.provider), manager.permissionMode, descriptor(starter.provider));
    if (!allowed.length) return like(manager, manager.permissionMode);
    return like(starter, allowed.includes(starter.permissionMode) ? starter.permissionMode : allowed[0]);
  }
  const picked = workers.use === 'picked' && known(workers.provider);
  if (picked) return own(picked, workers.model, workers.effort || null);
  const service = (yours && known(yours.provider)) || first;
  const { model, effort } = newContactStart({ provider: service, defaults, from: yours });
  return own(service, model, effort || null);
}

/** The most terminals one request can be for. */
export const MOST_AT_ONCE = 10;

/** How long a command typed into a terminal can be. */
export const COMMAND_MAX = 500;

/**
 * The instructions of a project an agent reads and saves (see shared/project-settings.js), by the name
 * it gives them: which of the project's they are, and what Settings calls them.
 */
export const INSTRUCTION_PARTS = Object.freeze({
  every_conversation: { key: 'general', title: 'Every conversation' },
  create_pr: { key: 'pullRequest', title: 'Create PR' },
  review_comments: { key: 'review', title: 'Review comments' },
});

/** How long instructions an agent saves can be: the dialog that asks the user shows all of them. */
export const SAVED_INSTRUCTIONS_MAX = 4000;

/** The part of a project's instructions a call is about: what every conversation is told, unless it says. */
export const instructionPart = (part) =>
  Object.hasOwn(INSTRUCTION_PARTS, part) ? INSTRUCTION_PARTS[part] : INSTRUCTION_PARTS.every_conversation;

/**
 * How many a request is for: as many as it names, or as many as it counts when
 * that is more. One when it says neither, and never more than can be asked for at once.
 * @param {unknown} count
 * @param {unknown} [named]  the ones it says something about: a name each
 */
export function howMany(count, named) {
  const counted = Number.isInteger(count) && /** @type {number} */ (count) > 0 ? /** @type {number} */ (count) : 0;
  const listed = Array.isArray(named) ? named.length : 0;
  return Math.min(MOST_AT_ONCE, Math.max(counted, listed, 1));
}

/**
 * A command to type into a terminal, as it is typed: one line, without the room around
 * it. '' when there is none. Of several lines only the first is a command: the rest
 * would be typed into whatever it started.
 * @param {unknown} value
 */
export const cleanCommand = (value) =>
  String(value ?? '')
    .trim()
    .split(/[\r\n]/)[0]
    .trim()
    .slice(0, COMMAND_MAX);

const names = (list) => (Array.isArray(list) ? list : []).map((name) => String(name ?? '').trim()).filter(Boolean);

/**
 * What a manager answered one question with, as the card sends an answer: its own words, or the options it picked.
 * @param {{ options?: unknown, own_answer?: unknown } | undefined} answer
 */
export const answerText = (answer) =>
  String(answer?.own_answer ?? '').trim() || names(Array.isArray(answer?.options) ? answer.options : []).join(', ');

/**
 * What an agent asked the app for, as an activity.
 * @param {string} tool   one of APP_TOOLS
 * @param {Record<string, any>} [input]  what it was called with
 * @returns {Activity | null}  null for a tool that is none of the app's
 */
export function appActivity(tool, input = {}) {
  if (tool === APP_TOOLS.conversation) {
    return {
      kind: 'app',
      action: 'conversation',
      started: input.asked_by_user === true,
      prompt: String(input.prompt ?? '').trim(),
    };
  }
  // Saved where the call has text for them, and only read where it has none.
  if (tool === APP_TOOLS.instructions) {
    const label = instructionPart(input.part).title;
    return typeof input.text === 'string'
      ? { kind: 'app', action: 'save-instructions', label, prompt: input.text.trim() }
      : { kind: 'app', action: 'read-instructions', label };
  }
  if (tool === APP_TOOLS.message || tool === APP_TOOLS.tellManager) {
    const job = String(input.job ?? '').trim();
    return {
      kind: 'app',
      action: 'message',
      urgent: input.urgent === true,
      label: String(input.to ?? '').trim(),
      prompt: String(input.text ?? '').trim(),
      ...(job && { job }),
    };
  }
  // Whose questions, and with what: under each question the card asks, where the tool can say (see main/app-tools.js).
  if (tool === APP_TOOLS.answer) {
    const answers = (Array.isArray(input.answers) ? input.answers : []).map(answerText);
    const questions = Array.isArray(input.questions) ? input.questions : [];
    return {
      kind: 'app',
      action: 'answer-question',
      label: String(input.to ?? '').trim(),
      count: answers.length,
      answers,
      prompt: answers.map((answer, i) => (questions[i] ? `${questions[i]}\n→ ${answer}` : `→ ${answer}`)).join('\n\n'),
    };
  }
  // Who joins which conversation, and as what: a reviewer where no role is named. The tool names the service
  // as the user knows it (see main/app-tools.js); a provider has only the call, with the service's id.
  if (tool === APP_TOOLS.invite) {
    const service = String(input.service ?? '').trim();
    const model = String(input.model ?? '').trim();
    const message = String(input.message ?? '').trim();
    return {
      kind: 'app',
      action: 'invite',
      label: String(input.to ?? '').trim(),
      ...(service && { agent: model ? `${service} (${model})` : service }),
      role: String(input.role ?? '').trim() || REVIEW_ROLE.name,
      ...(message && { prompt: message }),
    };
  }
  // Whom it goes to is the app's to say: its project manager (see main/app-tools.js).
  if (tool === APP_TOOLS.report) {
    return {
      kind: 'app',
      action: 'message',
      label: String(input.to ?? '').trim(),
      prompt: String(input.text ?? '').trim(),
    };
  }
  // At the whole project, at a manager's team, or at one conversation's job.
  if (tool === APP_TOOLS.teams) {
    const name = String(input.conversation ?? '').trim() || String(input.manager ?? '').trim();
    return { kind: 'app', action: 'teams', ...(name && { label: name }) };
  }
  // At all of them, or at one, by name.
  if (tool === APP_TOOLS.look) {
    const name = String(input.name ?? '').trim();
    return { kind: 'app', action: 'look', ...(name && { label: name }) };
  }
  if (tool === APP_TOOLS.brief) {
    return typeof input.text === 'string'
      ? { kind: 'app', action: 'save-brief', prompt: input.text.trim() }
      : { kind: 'app', action: 'read-brief' };
  }
  // Changed where the call adds or takes out any, and only read where it does neither.
  if (tool === APP_TOOLS.sources) {
    const added = names((Array.isArray(input.add) ? input.add : []).map((source) => source?.name || source?.url));
    const changes = added.length > 0 || (Array.isArray(input.remove) && input.remove.length > 0);
    return changes ? { kind: 'app', action: 'save-sources', names: added } : { kind: 'app', action: 'read-sources' };
  }
  if (tool !== APP_TOOLS.terminals) return null;
  const command = cleanCommand(input.command);
  return {
    kind: 'app',
    action: 'terminals',
    count: howMany(input.count, input.names),
    names: names(input.names),
    ...(command && { command }),
  };
}

/** How much of a reply the conversation that started its contact is sent, in characters. The beginning is kept. */
export const REPORT_MAX = 4000;

const REPORTED = ', a conversation you started, finished a turn.';

/**
 * What the agent of a conversation is told when one it started finished a turn (see Conversations).
 * @param {string} name  the contact that answered
 * @param {string} reply  what it said, as it said it
 */
export const reportNote = (name, reply) =>
  [
    `[${name}${REPORTED} This is a note from buddylist, not from the user. If there is nothing useful to add or do, end silently with no reply text. Its last reply:]`,
    reply.length > REPORT_MAX ? `${reply.slice(0, REPORT_MAX)}…` : reply,
  ].join('\n');

/**
 * Who a message is a note from, as `reportNote` writes one: the first of them, where several came together.
 * @param {string} text
 * @returns {string | null}  null for a message that is no such note
 */
export function reportedBy(text) {
  const first = String(text).split('\n')[0];
  const at = first.indexOf(REPORTED);
  return first.startsWith('[') && at > 1 ? first.slice(1, at) : null;
}
