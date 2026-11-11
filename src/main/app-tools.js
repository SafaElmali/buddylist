// The tools an agent has for the app itself (see shared/app-tools.js): what the
// agent is told each is for, what it takes, and what it does here. A provider
// that can give its agent tools wraps these its own way (providers/claude/app-tools.js).
import { z } from 'zod';
import {
  APP_TOOLS,
  COMMAND_MAX,
  INSTRUCTION_PARTS,
  MOST_AT_ONCE,
  SAVED_INSTRUCTIONS_MAX,
  appActivity,
  cleanCommand,
  conversationIdLine,
  howMany,
  instructionPart,
} from '../shared/app-tools.js';
import { DRAFT_LIMIT } from '../shared/github-item.js';
import { BRIEF_MAX, MESSAGE_MAX, REPORT_UP_MAX, SOURCES_MAX } from '../shared/managers.js';
import { cleanInstructions } from '../shared/project-settings.js';
import { pullRequestStatus } from '../shared/pull-request-text.js';
import { ROLE_NAME_MAX } from '../shared/teams.js';
import { cleanTerminalName } from '../shared/terminal.js';

/**
 * @typedef {Object} AppTool
 * @property {string} name
 * @property {string} description  what the agent is told it is for
 * @property {Record<string, import('zod').ZodType>} input  what it takes, each part with a word on it for the agent
 * @property {(input: any) => boolean} ask  whether the user is asked first, as for anything else an agent
 *   wants to do. It can depend on what is asked for
 * @property {(input: any, context: ToolContext) => Promise<string> | string} run  does it and answers the agent. What
 *   it throws is what went wrong, in a sentence the agent can pass on
 * @property {(input: any) => import('../providers/contract.js').Activity} [activity]  what the user is shown it
 *   does, where its input alone doesn't say. Without one it is worded from its input (shared/app-tools.js)
 */

/**
 * What a tool is given as it runs, by the session of the agent that called it.
 * @typedef {Object} ToolContext
 * @property {(request: import('../providers/contract.js').PermissionRequest) =>
 *   Promise<import('../providers/contract.js').PermissionResponse>} ask  asks the user in the conversation, on a
 *   card of the request's kind, whatever the conversation lets its agent do unasked. It answers `cancelled` once
 *   the turn is interrupted or the session closed before the user did: nothing asked is kept for later
 * @property {boolean} [unasked]  the mode the user picked lets the agent act without asking, such as Never ask: a
 *   tool that asks on its own card shows none then, and what it does went without the user's approval
 */

/**
 * An agent asked to be in a conversation: by its service alone, or with the model, effort level or role it is to
 * have, each as the agent wrote it.
 * @typedef {string | { service: string, model?: string, effort?: string, role?: string }} Invitee
 */

/**
 * Makes a contact for a conversation another one's agent starts, listed under that one, with the agents
 * `invite` names in it, and starts it when `now` says to. Answers with the names of the agents
 * that joined. Throws what went wrong, in a sentence for the agent.
 * `speakerId` is bound to the calling session, never chosen by the agent's tool input. `setupWaits`: its project's
 * setup script waits for the user to start it.
 * @typedef {(hostId: string, opts: { prompt: string, now: boolean, fromHere: boolean, invite: Invitee[], speakerId?: string }) =>
 *   Promise<{ id: string, name: string, worktree: boolean, setupWaits?: boolean, joined: string[] }>} StartConversation
 */

/** @typedef {import('../shared/project-settings.js').Instructions} Instructions */

/**
 * What a contact's project is told, for the agent to read and, once the user said yes, to save.
 * @typedef {Object} ProjectInstructions
 * @property {(hostId: string) => Promise<{ key: string, name: string, instructions: Instructions }>} of  the project
 *   the contact works on, with its instructions as they are now
 * @property {(key: string, instructions: Instructions) => void} save  keeps them, for every window to show
 */

const several = (count, one, many) => (count === 1 ? one : `${count} ${many}`);

/** How long a model's name an agent asks for can be, as the model pickers keep one. */
const MODEL_ASKED_MAX = 200;
/** And an effort level's. */
const EFFORT_ASKED_MAX = 20;

/** What an agent wrote, on one line, without the room around it: '' for nothing. */
const asked = (value) => String(value ?? '').trim();

/**
 * The agents asked to be in a conversation, each once: a service alone as it was asked for, and one with a model,
 * effort level or role with only what was said of it. One with nothing more than its service is that service.
 * @param {unknown} invite
 * @param {string[]} services  the ones there are
 * @returns {Invitee[]}
 */
function invitees(invite, services) {
  const seen = new Set();
  return (Array.isArray(invite) ? invite : []).flatMap((one) => {
    const service = typeof one === 'string' ? one : asked(one?.service);
    if (!services.includes(service)) return [];
    const more =
      typeof one === 'string' ? {} : { model: asked(one.model), effort: asked(one.effort), role: asked(one.role) };
    const said = Object.fromEntries(Object.entries(more).filter(([, value]) => value));
    const invitee = Object.keys(said).length ? { service, ...said } : service;
    const key = JSON.stringify(invitee);
    if (seen.has(key)) return [];
    seen.add(key);
    return [invitee];
  });
}

/** What an invitee may say of itself besides its service: a model, an effort level and a role, each by name. */
const inviteeFields = {
  model: z
    .string()
    .max(MODEL_ASKED_MAX)
    .optional()
    .describe(
      'Its model, by its id or its name as the model picker lists it, such as opus or Opus 5.5. Its service’s default when left out.'
    ),
  effort: z
    .string()
    .max(EFFORT_ASKED_MAX)
    .optional()
    .describe('Its effort level, such as high, one its model takes. Its model’s own when left out.'),
  role: z
    .string()
    .max(ROLE_NAME_MAX)
    .optional()
    .describe('A role from Settings > Roles & teams, by name: it answers and changes files as the role says.'),
};

/** The list of names, as a sentence says it: "A, B and C". */
const listed = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]);

/** What the card for a command a read-only agent wants typed into a terminal says of where it runs. */
export const OUTSIDE_SANDBOX = 'It runs in your own shell, outside the read-only sandbox, so it can change files.';

/**
 * @param {string} hostId
 * @param {Pick<import('./terminals.js').Terminals, 'wanted'>} terminals
 * @param {boolean} [readOnly]  the agent asking changes no files: its session keeps it from that, and a terminal is
 *   the user's own shell, which nothing keeps
 * @returns {AppTool}
 */
function openTerminals(hostId, terminals, readOnly = false) {
  return {
    name: APP_TOOLS.terminals,
    description:
      'Open terminals beside this conversation, each in a tab of its own: the user’s own shell, in the folder ' +
      'you work in. Use it when the user asks for terminals. With a command, that is typed into each of them ' +
      'once its shell is up, for what the user wants running there: "claude", a dev server, a test watcher. ' +
      'You are not told what happens in a terminal, and you can’t type into one afterwards.',
    input: {
      count: z
        .number()
        .int()
        .min(1)
        .max(MOST_AT_ONCE)
        .optional()
        .describe('How many terminals to open. One when left out.'),
      names: z
        .array(z.string())
        .max(MOST_AT_ONCE)
        .optional()
        .describe('A name for a terminal’s tab, such as "dev server", in order. One without a name is numbered.'),
      command: z
        .string()
        .max(COMMAND_MAX)
        .optional()
        .describe(
          'One line to type into every one of them and run, as the user would type it. The user is asked first.'
        ),
    },
    // A terminal by itself runs nothing and changes nothing: the user gets their own shell. One that
    // is to run something is asked about, as a command the agent runs itself is. One a read-only agent wants run
    // is asked about on a card of its own as it runs, whatever its mode: its commands run unasked only where its
    // sandbox holds them, and none holds the user's shell.
    ask: ({ command } = {}) => !readOnly && Boolean(cleanCommand(command)),
    run: async ({ count, names, command }, context) => {
      if (/[\r\n]/.test(String(command ?? '').trim())) throw new Error('A command for a terminal is one line.');
      const typed = cleanCommand(command);
      const tabs = Array.from({ length: howMany(count, names) }, (_, i) => cleanTerminalName(names?.[i]) || null);
      if (readOnly && typed) {
        const answer = await context.ask({
          kind: 'tool',
          canAlways: false,
          activity: appActivity(APP_TOOLS.terminals, { count, names, command: typed }),
          reason: OUTSIDE_SANDBOX,
        });
        if (answer.decision === 'cancelled') {
          throw new Error('The turn ended before the user answered. No terminal was opened.');
        }
        if (!['allow', 'always'].includes(answer.decision)) {
          throw new Error(answer.message || 'The user chose not to run it. No terminal was opened.');
        }
      }
      if (!terminals.wanted(hostId, tabs, typed || null)) {
        throw new Error('The conversation’s window is closed, so no terminal was opened.');
      }
      const opening = `${several(tabs.length, 'A terminal is', 'terminals are')} opening beside the conversation`;
      return typed ? `${opening}, with ${typed} typed into ${tabs.length === 1 ? 'it' : 'each'}.` : `${opening}.`;
    },
  };
}

/**
 * @param {string} hostId
 * @param {StartConversation} start
 * @param {() => boolean} startsAnyway  whether one the agent thought of starts at once too, as Settings has it now
 * @param {{ id: string, name: string }[]} agents  the services whose agents can be in it from the start
 * @param {string} speakerId  the agent asking, which can be a guest in the host's conversation
 * @param {boolean} [manages]  the host is a project's manager, whose New workers use says what the ones it starts
 *   answer with
 * @param {Map<string, { input: string, result: ReturnType<StartConversation> }>} starts  attempts kept across sessions
 * @param {(hostId: string) => boolean} [userAsks]  whether the host's agent may say the user asked for one: not a
 *   manager's while it acts on a project manager's message the user did not approve (see Managers.startsAtOnce)
 * @param {boolean} [drafts]  every one it starts waits for the user: the agent asking works read-only, outside a
 *   manager's conversation, and what it starts could change files. Its word that the user asked isn't taken, nor is
 *   Settings' start at once, which is for the agents that change files themselves
 * @returns {AppTool}
 */
function startConversation(
  hostId,
  start,
  startsAnyway,
  agents,
  speakerId,
  manages = false,
  starts,
  userAsks = () => true,
  drafts = false
) {
  // One the user asked for starts at once, and so does one the agent thought of when the user said so in Settings.
  const startsNow = (input) => !drafts && ((input?.asked_by_user === true && userAsks(hostId)) || startsAnyway());
  const waits = drafts || !startsAnyway();
  const services = agents.map((agent) => agent.id);
  return {
    name: APP_TOOLS.conversation,
    description:
      'Start another conversation, for work that should go on apart from this one: a contact of its own in the ' +
      'user’s contact list, listed under this conversation, with its own worktree in a git project. Its agent knows ' +
      'nothing of this conversation, so the prompt must tell it everything it needs. You hear its first reply, ' +
      'then progress replies wait while background work runs: the latest is sent when it finishes, or a later ' +
      'reply supersedes it. Questions, approvals, file changes and failed or stopped turns do not wait. ' +
      (drafts
        ? ''
        : 'When the user asks for work, such as "fix this", or approves ' +
          'work you proposed, set asked_by_user to true: they need not ask for a new conversation or name this tool. ') +
      'Give each intended conversation a request_id and reuse it with the same inputs when retrying a cancelled ' +
      'or lost call: the same attempt and its result are kept while the app is running. Use a new ID for another ' +
      'conversation, even with the same prompt. ' +
      (manages
        ? 'Its main agent’s service, model, effort and permission mode are as the manager’s settings say under New ' +
          'workers use: unless the user chose otherwise, those a contact the user adds starts with, in the mode a ' +
          'new contact of that service starts in, not the manager’s, unless the user set its Permission mode there. '
        : 'Its main agent uses your service, model, effort and permission mode, also when you are a guest in this ' +
          'conversation. ') +
      (services.length
        ? 'Other agents, such as Codex, can be in it from the start, as in a group chat: they take turns on each ' +
          'message with its own agent. '
        : '') +
      (drafts
        ? 'It waits with the prompt in its message box until the user starts it, also one the user asked for: you ' +
          'work read-only here, and the conversation you start can change files.'
        : waits
          ? 'It starts at once only when the user asked for it: one you thought of waits with the prompt in its ' +
            'message box until the user sends it.'
          : 'It starts at once, also one you thought of: the user has it so in their settings.'),
    input: {
      prompt: z
        .string()
        .min(1)
        .max(DRAFT_LIMIT)
        .describe('Its first message: what it is to do, and everything it needs to know to do it.'),
      ...(!drafts && {
        asked_by_user: z
          .boolean()
          .optional()
          .describe(
            waits
              ? 'True when the user asked for this work (for example, "fix this") or approved work you proposed: it then starts at once. They need not ask for a new conversation or name this tool. Otherwise false: it waits for the user.'
              : 'True when the user asked for this work (for example, "fix this") or approved work you proposed. They need not ask for a new conversation or name this tool.'
          ),
      }),
      request_id: z
        .string()
        .trim()
        .min(1)
        .max(128)
        .optional()
        .describe(
          'A unique ID for this intended conversation. Reuse it with the same inputs on retry to avoid starting ' +
            'another worker, including after a cancelled wait. A failed attempt is kept too; a retry does not run it again.'
        ),
      from_this_branch: z
        .boolean()
        .optional()
        .describe(
          'Start its branch from this conversation’s branch, as far as it is committed, instead of from the main line.'
        ),
      ...(services.length > 0 && {
        invite: z
          .array(
            z.union([
              z.enum(/** @type {[string, ...string[]]} */ (services)),
              z.object({ service: z.enum(/** @type {[string, ...string[]]} */ (services)), ...inviteeFields }),
            ])
          )
          .max(MOST_AT_ONCE)
          .optional()
          .describe(
            'Other agents to be in it from the start, by service, such as codex for Codex, or as { service, model, ' +
              'effort, role } for one with a model, effort level or role of its own: each joins as in a group ' +
              'chat, before its first message. Use it when the user wants them to work on it together.'
          ),
      }),
    },
    // Nothing runs that the user did not ask for: a conversation the agent thought of waits for them,
    // unless they said in Settings that it needn't. One a read-only agent starts waits for them whatever it says.
    ask: () => false,
    // Whether it started is up to Settings too, not only to what the agent said.
    activity: (input) => ({ ...appActivity(APP_TOOLS.conversation, input), started: startsNow(input) }),
    run: async (input) => {
      const { prompt, from_this_branch: fromHere = false } = input;
      const text = String(prompt ?? '').trim();
      if (!text) throw new Error('Say what the new conversation is to do.');
      const now = startsNow(input);
      // Each once, and only of the services there are: one asked for twice would join twice.
      const invite = invitees(input.invite, services);
      const options = {
        prompt: text,
        now,
        fromHere,
        invite,
        ...(speakerId !== hostId && { speakerId }),
      };
      const requestId = String(input.request_id ?? '').trim();
      const key = requestId ? JSON.stringify([hostId, speakerId, requestId]) : null;
      const signature = JSON.stringify(options);
      let attempt = key ? starts.get(key) : null;
      if (attempt && attempt.input !== signature) {
        throw new Error(
          'That request_id already belongs to a different conversation request. Use a new ID for new work.'
        );
      }
      if (!attempt) {
        // Record the promise before creation starts. Losing a caller's transport or waiting turn must not
        // lose the attempt. Keep failures too: creation may have failed after the contact was already added.
        attempt = { input: signature, result: Promise.resolve().then(() => start(hostId, options)) };
        if (key) starts.set(key, attempt);
      }
      const started = await attempt.result;
      const where = started.worktree ? ', in a worktree of its own' : '';
      const joined = started.joined ?? [];
      const others = joined.length ? `, with ${listed(joined)} in it` : '';
      // Its conversation says why one couldn't join.
      const missed =
        joined.length < invite.length ? ' Not every agent you asked for could join: its conversation says why.' : '';
      const later =
        'You hear its first reply and later outcomes; progress waits while background work runs. Carry on meanwhile, without waiting for notes.';
      const identity = started.id ? conversationIdLine(started.id) : '';
      // Code on none of the project's branches, a pull request's above all, is set up only once the user says so.
      const setup = started.setupWaits
        ? ' Its project’s setup script waits for the user to start it: its branch has code that is not on the project’s own branches.'
        : '';
      return now
        ? `${started.name} has started${where}${others}.${identity} It is listed under this conversation.${setup}${missed} ${later}`
        : `${started.name} is in the user’s contact list${where}${others}, under this conversation, with the prompt ` +
            `waiting in its message box.${identity} Nothing runs until the user sends it.${setup}${missed} ${later}`;
    },
  };
}

/**
 * @param {string} hostId
 * @param {ProjectInstructions} project
 * @returns {AppTool}
 */
function projectInstructions(hostId, project) {
  return {
    name: APP_TOOLS.instructions,
    description:
      'Read or save what the agents of this project are told on top of what the user types, kept in the app’s ' +
      'Settings under Projects: what every new conversation is told, such as how far to take a change without ' +
      'asking (opening the pull request, merging it once its checks pass), and what the Create PR button and ' +
      'review comments ask for. Use it when the user asks to see or change them. Without text it answers with ' +
      'what is there now. Text replaces all of it, so read it first and keep what should stay. The user is shown ' +
      'what it changes, in this conversation, and saves it, edits it first or doesn’t: nothing is saved ' +
      'otherwise. The answer says whether they edited it, and what was saved. What every conversation is told ' +
      'reaches the conversations started after it, not this one. What every project is told comes before ' +
      'these, from Settings > Every project > Instructions: only the user changes that, there.',
    input: {
      part: z
        .enum(/** @type {[string, ...string[]]} */ (Object.keys(INSTRUCTION_PARTS)))
        .optional()
        .describe('Which of them: every_conversation when left out.'),
      text: z
        .string()
        .max(SAVED_INSTRUCTIONS_MAX)
        .optional()
        .describe('All of what they are to be from now on; empty to take them out. Leave it out to read them.'),
    },
    // Saving asks the user on a card of its own in the conversation, whatever the conversation lets its agent do
    // unasked: what is saved is told to every conversation after it. Reading changes nothing.
    ask: () => false,
    run: async ({ part, text }, { ask }) => {
      const { key, title } = instructionPart(part);
      const { key: projectKey, name, instructions } = await project.of(hostId);
      const now = instructions[key];
      if (text === undefined) {
        return now ? `The ${title} instructions of ${name}:\n\n${now}` : `${name} has no ${title} instructions.`;
      }
      if (String(text).length > SAVED_INSTRUCTIONS_MAX) {
        throw new Error(
          `Instructions an agent saves are at most ${SAVED_INSTRUCTIONS_MAX} characters, for the user to read ` +
            'before saving them. Longer ones are typed in Settings.'
        );
      }
      // As Settings keeps them, so that the user is shown what is kept.
      const next = cleanInstructions({ [key]: text })[key];
      if (next === now) return `The ${title} instructions of ${name} are that already. Nothing was changed.`;
      const answer = await ask({
        kind: 'instructions',
        activity: appActivity(APP_TOOLS.instructions, { part, text: next }),
        instructions: { project: name, part: title, before: now, after: next },
      });
      if (answer.decision === 'cancelled') {
        throw new Error('The turn ended before the user answered. Nothing was changed.');
      }
      if (!['allow', 'edit'].includes(answer.decision)) {
        throw new Error('The user chose not to save them. Nothing was changed.');
      }
      // What the user saved is theirs to say: the text they edited, kept as Settings keeps it.
      const saved = answer.decision === 'edit' ? cleanInstructions({ [key]: answer.text })[key] : next;
      const edited = saved !== next;
      // As they are by now: the card waited while the user could change the others in Settings.
      const { instructions: latest } = await project.of(hostId);
      project.save(projectKey, { ...latest, [key]: saved });
      const how = edited ? ' with the user’s edits' : saved ? ' as you wrote them' : '';
      const done = `${saved ? 'Saved' : 'Removed'}${how}`;
      const kept = saved ? ` They are now:\n\n${saved}` : '';
      const replaced = now ? `\n\nWhat they were before:\n\n${now}` : '';
      return `${done}: the ${title} instructions of ${name}.${kept}${replaced}`;
    },
  };
}

/**
 * What a conversation's agent does about the pull request shown for it (see pull-request-link.js).
 * @typedef {Object} PullRequestLinks
 * @property {(hostId: string) => boolean} offered  the conversation works in a repository, and wears a pull request's
 *   status: not a project's manager, nor one on This computer
 * @property {(hostId: string, text: string) => Promise<import('./contact-card.js').PullRequest | null>} link  links the
 *   pull request `text` names, answering with what is shown now; throws why it can't, in a sentence
 * @property {(hostId: string) => import('./contact-card.js').PullRequest | null} unlink  answers with what is shown now
 */

/** What the card for a link a read-only agent wants says of what a link changes. */
export const LINK_ACTS =
  'Auto-merge, Fix conflicts and Archive once merged act on the pull request shown for this conversation.';

/**
 * Links a pull request to the conversation, or takes it away: shown as the one of its branch is. Nothing on GitHub
 * changes, and Unlink takes it back, so an agent that changes files does it unasked, as the user told it to. A
 * read-only agent is asked about on a card every time: what is shown is what Auto-merge, Fix conflicts and Archive
 * once merged act on.
 * @param {string} hostId
 * @param {PullRequestLinks} links
 * @param {boolean} [readOnly]
 * @returns {AppTool}
 */
function linkPullRequest(hostId, links, readOnly = false) {
  return {
    name: APP_TOOLS.link,
    description:
      'Link a pull request to this conversation, so the app shows its status where it shows the one of this ' +
      'conversation’s branch: its checks, reviews, conflicts and merge, in the title bar, the contact list and on ' +
      'the phone. Use it when the user asks you to link or watch a pull request here, or after you pushed the work ' +
      'under another branch name than this folder’s branch, or from the main checkout: the app finds only the ' +
      'pull request of the branch checked out. Only a pull request of this conversation’s repository, or of a fork ' +
      'among its remotes. It changes nothing on GitHub. Linking another replaces it; unlink takes it away.',
    input: {
      pull_request: z
        .string()
        .max(300)
        .optional()
        .describe('Its number, such as #12, or the link to its page. Leave it out to unlink.'),
      unlink: z
        .boolean()
        .optional()
        .describe('True to take the linked pull request away, so the one of the branch is shown again.'),
    },
    ask: () => false,
    run: async ({ pull_request: text, unlink = false }, context) => {
      if (!unlink && !String(text ?? '').trim()) {
        throw new Error('Say which pull request: its number, such as #12, or the link to its page.');
      }
      if (readOnly) {
        const answer = await context.ask({
          kind: 'tool',
          canAlways: false,
          activity: appActivity(APP_TOOLS.link, { pull_request: text, unlink }),
          reason: LINK_ACTS,
        });
        if (answer.decision === 'cancelled') {
          throw new Error('The turn ended before the user answered. Nothing was linked or unlinked.');
        }
        if (!['allow', 'always'].includes(answer.decision)) {
          throw new Error(answer.message || 'The user chose not to. Nothing was linked or unlinked.');
        }
      }
      if (unlink) {
        const shown = links.unlink(hostId);
        return shown
          ? `Unlinked. The title bar shows pull request #${shown.number} of this branch again.`
          : 'Unlinked. This conversation shows no pull request now.';
      }
      const shown = await links.link(hostId, String(text));
      if (!shown) throw new Error('The pull request could not be linked here.');
      return (
        `Linked pull request #${shown.number}${shown.title ? ` (${shown.title})` : ''} to this conversation: ` +
        `${pullRequestStatus(shown)}. The title bar, the contact list and the phone show its status from now on.`
      );
    },
  };
}

/** @typedef {Pick<import('./managers.js').Managers, 'oversees' | 'say' | 'answer' | 'questionsOf' | 'invite' | 'look' | 'brief' | 'sources' | 'leads' | 'leadOf' | 'teams' | 'tellManager' | 'report' | 'startsAtOnce'>} Managing */

/**
 * A manager invites another agent into one of its workers' conversations: a guest there, as the user's Invite has
 * one join, that the user sees in its Agents tab. Without a role it is a reviewer (see REVIEW_ROLE in shared/teams.js). One the user asked
 * for joins unasked; any other the user approves first, as a message to a worker is.
 * @param {string} hostId
 * @param {Managing} managers
 * @param {{ id: string, name: string }[]} agents  the services whose agents can join
 * @param {(hostId: string) => boolean} userAsks  whether the manager's agent may say the user asked for it: not
 *   while it acts on a project manager's message the user did not approve (see Managers.startsAtOnce)
 * @param {() => import('../shared/teams.js').Role[]} roles  the user's roles, as Settings has them now
 * @returns {AppTool}
 */
function inviteToConversation(hostId, managers, agents, userAsks, roles) {
  const services = /** @type {[string, ...string[]]} */ (agents.map((agent) => agent.id));
  const serviceName = (id) => agents.find((agent) => agent.id === id)?.name ?? id;
  return {
    name: APP_TOOLS.invite,
    description:
      'Invite another agent into one of the conversations you oversee: it joins that worker’s own conversation, as ' +
      'a guest the user sees in its Agents tab, and works in its folder beside it. Use it when the user asks for ' +
      'an agent in a worker, such as "invite a Claude Opus reviewer for each worker": once for each worker, ' +
      'instead of subagents of your own. Without a role it is a reviewer: it changes no files, and answers once ' +
      'the worker has changed files. What it finds that has to change it hands to the worker with @, and the ' +
      'hand-offs stop at the conversation’s limit until the user writes. With a role from Settings > Roles & ' +
      'teams it does what the role says instead. Say in message what it is to do first, such as what to review ' +
      'and against which ticket: it starts on that once it has the turn. Without one it waits, as its role says. ' +
      'What it says reaches you with the worker’s notes once their round is over. A service that can’t work ' +
      'read-only can’t review. The same agent asked for again is there already. The user approves an invite ' +
      'unless they asked for it: then set asked_by_user to true.',
    input: {
      to: z.string().min(1).describe('The conversation, by its name as the notes and project_conversations give it.'),
      service: z
        .enum(services)
        .optional()
        .describe('Its service, such as claude or codex. The role’s, when a role is named and this is left out.'),
      ...inviteeFields,
      message: z
        .string()
        .max(MESSAGE_MAX)
        .optional()
        .describe(
          'What it is to do first, such as what to review and against which ticket. It is also told this later on.'
        ),
      asked_by_user: z
        .boolean()
        .optional()
        .describe(
          'True when the user asked for this agent, such as "invite a reviewer into each worker": it joins without ' +
            'asking them again. Otherwise the user approves it first.'
        ),
    },
    // Another agent joins and works there: the user says whether it does, unless they asked for it.
    ask: (input) => !(input?.asked_by_user === true && userAsks(hostId)),
    // The service as the user knows it, the role's where none is named.
    activity: (input) => {
      const role = roles().find((one) => one.name.toLowerCase() === asked(input?.role).toLowerCase());
      const service = asked(input?.service) || role?.provider || '';
      return appActivity(APP_TOOLS.invite, { ...input, service: service && serviceName(service) });
    },
    run: (input) =>
      managers.invite(hostId, {
        to: asked(input.to),
        service: asked(input.service),
        model: asked(input.model),
        effort: asked(input.effort),
        role: asked(input.role),
        message: asked(input.message),
      }),
  };
}

/** How long a card's id can be, as a manager names one. */
const CARD_MAX = 128;

/**
 * A manager answers a card of questions one of its workers waits on, as the user would on it: an option by its label,
 * several for a question that takes any number, or words of its own. The worker goes on with that as the user's
 * answer, so the user is asked first, as for a message, in whichever mode they picked: one that lets the manager act
 * unasked lets it answer unasked. It answers questions alone. A permission, an approval or a plan stays the user's.
 * @param {string} hostId
 * @param {Managing} managers
 * @returns {AppTool}
 */
function answerQuestion(hostId, managers) {
  return {
    name: APP_TOOLS.answer,
    description:
      'Answer a card of questions one of the conversations you oversee waits on: the one its agent asked the user, ' +
      'as its note gives it, with each question and its options. Answer only where the project’s brief, its sources ' +
      'or what the user decided earlier settle it, and then every question on the card, in order: an option by its ' +
      'label, several where a question takes any number, or words of your own. Otherwise leave the question to the ' +
      'user, and tell them what it asks. The user is asked first, and reads your answers before they go. The first ' +
      'answer counts: one the user gave already stands, and the worker goes on with yours as if the user gave it. It ' +
      'never answers a permission request, an approval to run a command or use a tool, or a plan: those stay with the ' +
      'user.',
    input: {
      to: z.string().min(1).describe('The conversation, by its name as the notes and project_conversations give it.'),
      answers: z
        .array(
          z.object({
            options: z
              .array(z.string().max(MESSAGE_MAX))
              .max(MOST_AT_ONCE)
              .optional()
              .describe('The options picked, by their labels: one, or several where the question takes any number.'),
            own_answer: z
              .string()
              .max(MESSAGE_MAX)
              .optional()
              .describe('An answer in your own words, in place of the options.'),
          })
        )
        .min(1)
        .max(MOST_AT_ONCE)
        .describe('One answer for each question on the card, in the order it asks them.'),
      card: z
        .string()
        .max(CARD_MAX)
        .optional()
        .describe('Which card, by the id its note gives: only where the conversation waits on more than one.'),
    },
    // Another agent acts on it as the user's answer: the user says whether it goes, unless they let this one act unasked.
    ask: () => true,
    // Under each question the card asks, for the user to read before it goes.
    activity: (input) =>
      appActivity(APP_TOOLS.answer, {
        ...input,
        questions: managers.questionsOf(hostId, asked(input?.to), asked(input?.card)),
      }),
    run: ({ to, answers, card }) => managers.answer(hostId, asked(to), answers, asked(card)),
  };
}

/**
 * A project's manager's tools (see main/managers.js): it messages the conversations it oversees, answers the
 * questions they wait on, looks at them and at what they changed, and keeps the project's brief and sources. Nothing
 * it does changes a file. A message or an answer sets another agent to work, so the user is asked first, as for
 * anything else an agent wants to do.
 * @param {string} hostId
 * @param {Managing} managers
 * @param {() => string} leadName  its project manager at work, by name: '' for none
 * @param {AppTool | null} [invites]  its invite_to_conversation, where there are services to invite
 * @returns {AppTool[]}
 */
function managerTools(hostId, managers, leadName, invites = null) {
  return [
    {
      name: APP_TOOLS.message,
      description:
        'Send one of the conversations you oversee a message: what it has to change, why, and where that was ' +
        'said. The user is asked first, and reads it before it goes. Its window shows it then, and its agent ' +
        'reads it once it is free, as a note from you. Use urgent only for corrections that must reach it before ' +
        'it continues: stop, do not push or merge, or wrong direction. Urgent uses the worker’s Send now behaviour, ' +
        'which may interrupt its current turn and running tool. It cannot undo completed work. ' +
        'Its answer is sent back to you. A conversation is sent a ' +
        'few at most for each message of the user’s to it.',
      input: {
        to: z.string().min(1).describe('The conversation, by its name as the notes and project_conversations give it.'),
        text: z.string().min(1).max(MESSAGE_MAX).describe('The message.'),
        urgent: z
          .boolean()
          .optional()
          .default(false)
          .describe('Use Send now for a time-sensitive correction. Defaults to false.'),
      },
      // Another agent acts on it: the user says whether it goes, unless they let this one act unasked.
      ask: () => true,
      run: ({ to, text, urgent = false }) => managers.say(hostId, to, text, urgent),
    },
    answerQuestion(hostId, managers),
    ...(invites ? [invites] : []),
    {
      name: APP_TOOLS.look,
      description:
        'Look at the conversations you oversee. Without a name: each of them, with its branch, its folder, its ' +
        'task, its last reply, and the files it changed against the main line. With a name: that one, with its ' +
        'diff, and the files the others changed too.',
      input: {
        name: z.string().optional().describe('One conversation, by name, for its diff. Leave it out for all of them.'),
      },
      ask: () => false,
      run: ({ name }) => managers.look(hostId, name),
    },
    {
      name: APP_TOOLS.brief,
      description:
        'Read or save the project’s brief: what you know of what it is building, from its sources. The goals, the ' +
        'decisions and where they were made, the acceptance criteria of each ticket, the open questions, and ' +
        'which conversation is on what. Without text it answers with the brief as it is. Text replaces all of ' +
        'it, so keep what should stay. The user reads it in Settings, and may edit it there.',
      input: {
        text: z.string().max(BRIEF_MAX).optional().describe('All of the brief from now on. Leave it out to read it.'),
      },
      ask: () => false,
      run: ({ text }) => managers.brief(hostId, text),
    },
    {
      name: APP_TOOLS.sources,
      description:
        'Read the project’s sources, or add and take out some: where you learn what it is building, such as a ' +
        'PRD, a ticket, a Slack thread or a design. Add a link the user shares about the project, named by what ' +
        'it is. Without either it answers with the sources as they are. The user sees them in Settings.',
      input: {
        add: z
          .array(
            z.object({
              name: z.string().max(80).optional().describe('What it is, such as "PRD" or "COM-630".'),
              url: z.string().max(2000).optional().describe('Its link; left out for one known by name alone.'),
            })
          )
          .max(SOURCES_MAX)
          .optional()
          .describe('Sources to add.'),
        remove: z.array(z.string()).optional().describe('Sources to take out, by name or link.'),
      },
      ask: () => false,
      run: ({ add, remove }) => managers.sources(hostId, { add, remove }),
    },
    {
      name: APP_TOOLS.report,
      description:
        'Report to your project’s project manager, where one oversees the managers: a job’s result that came in ' +
        'after you answered its message, such as a review worker’s verdict on a job it handed you, or what it ' +
        'asked you to tell it. A short outcome: the verdict, what must change, and which worker it is about. Your ' +
        'reply to its message goes back to it by itself: this is for what comes later. Without a project manager ' +
        'it says so.',
      input: {
        text: z.string().min(1).max(REPORT_UP_MAX).describe('The report.'),
      },
      // An answer goes back as a worker's answer does: the project manager asks the user before it acts on it.
      ask: () => false,
      activity: (input) => ({ ...appActivity(APP_TOOLS.report, input), label: leadName() || 'the project manager' }),
      run: ({ text }) => managers.report(hostId, text),
    },
  ];
}

/**
 * A project manager's tools (see main/managers.js): it messages the managers it oversees, hands a worker's job from
 * one to another, looks at the teams, and keeps its brief and sources. Nothing it does changes a file, and it starts
 * no conversation: the managers do. A message sets another agent to work, so the user is asked first, on a card of
 * its own: whether they approved it decides whether the work it asks for is the user's.
 * @param {string} hostId
 * @param {Managing} managers
 * @returns {AppTool[]}
 */
function projectManagerTools(hostId, managers) {
  const [, , , brief, sources] = managerTools(hostId, managers, () => '');
  return [
    {
      name: APP_TOOLS.tellManager,
      description:
        'Send one of the managers you oversee a message, as the user asks. With job, hand it that worker’s job: ' +
        'its branch, folder, pull request, task, last reply and changed files go with your message, and the ' +
        'manager starts its own workers for it. Pass a verdict back the same way, with job set to the worker it ' +
        'is about, to that worker’s manager. The user is asked first, and reads it before it goes. Use urgent only ' +
        'for a correction that must reach the manager before it continues. Its reply is sent back to you, and its ' +
        'report once the result is in. A manager is sent a few at most for each message of the user’s to it.',
      input: {
        to: z.string().min(1).describe('The manager, by its name as project_teams gives it.'),
        text: z.string().min(1).max(MESSAGE_MAX).describe('The message: what is to be done, and why.'),
        job: z
          .string()
          .optional()
          .describe('A conversation of the project, by name, whose job this hands on or is about.'),
        urgent: z
          .boolean()
          .optional()
          .default(false)
          .describe('Use Send now for a time-sensitive correction. Defaults to false.'),
      },
      // Asked on a card of its own as it runs, once the manager and the job are known: the provider doesn't ask.
      ask: () => false,
      run: ({ to, text, job, urgent = false }, context) =>
        managers.tellManager(hostId, to, text, {
          job,
          urgent,
          approve: async () => {
            if (context?.unasked) return false;
            const answer = await context.ask({
              kind: 'tool',
              canAlways: false,
              activity: appActivity(APP_TOOLS.tellManager, { to, text, job, urgent }),
            });
            if (answer.decision === 'cancelled')
              throw new Error('The turn ended before the user answered. Nothing was sent.');
            if (!['allow', 'always'].includes(answer.decision)) {
              throw new Error(answer.message || 'The user chose not to send it. Nothing was sent.');
            }
            return true;
          },
        }),
    },
    {
      name: APP_TOOLS.teams,
      description:
        'Look at the project’s teams. Without arguments: each manager, and the workers most recently at work, a ' +
        'line each, with how many more there are. With manager: that manager’s workers, each with its task, last ' +
        'reply and changed files. With conversation: that worker’s job, as a manager is handed it. It has no diffs: ' +
        'the reviewers read those.',
      input: {
        manager: z.string().optional().describe('One manager, by name, for its team.'),
        conversation: z.string().optional().describe('One conversation, by name, for its job.'),
      },
      ask: () => false,
      run: ({ manager, conversation }) => managers.teams(hostId, { manager, conversation }),
    },
    brief,
    sources,
  ];
}

/**
 * How the session of the agent asking for its tools has it: whether it is kept from changing files (see `readOnly` on
 * SessionContact).
 * @typedef {{ readOnly?: boolean }} Seat
 */

/**
 * The app's own tools for the agents of a conversation.
 * @param {object} deps
 * @param {Pick<import('./storage/store.js').Store, 'getContact' | 'settings'>} deps.store
 * @param {Pick<import('./terminals.js').Terminals, 'wanted'>} deps.terminals
 * @param {StartConversation} deps.startConversation
 * @param {ProjectInstructions} deps.instructions
 * @param {Partial<Managing>} [deps.managers]  what a project’s manager does with its tools; no contact is one when left out
 * @param {{ id: string, name: string }[]} [deps.agents]  the services whose agents can join a conversation one
 *   starts; none when left out
 * @param {PullRequestLinks} [deps.links]  links a pull request to a conversation; nobody is offered it when left out
 * @returns {(hostId: string, speakerId?: string, seat?: Seat) => AppTool[]}  tools bound to the agent answering in
 *   that conversation, as its session has it
 */
export function appTools({
  store,
  terminals,
  startConversation: start,
  instructions,
  managers: given = {},
  agents = [],
  links = null,
}) {
  // What a stand-in leaves out does nothing: no contact leads, and a conversation the user asked for starts. Each is
  // bound to what was given, a Managers or a plain stand-in: a class's methods are on its prototype, not its own.
  const fallbacks = {
    oversees: () => false,
    say: async () => '',
    answer: async () => '',
    questionsOf: () => [],
    invite: async () => '',
    look: async () => '',
    brief: () => '',
    sources: () => '',
    leads: () => false,
    leadOf: () => null,
    teams: async () => '',
    tellManager: async () => '',
    report: () => '',
    startsAtOnce: () => true,
  };
  const managers = /** @type {Managing} */ (
    Object.fromEntries(
      Object.entries(fallbacks).map(([name, fallback]) => [
        name,
        typeof given[name] === 'function' ? given[name].bind(given) : fallback,
      ])
    )
  );
  const startsAnyway = () => store.settings.startConversations === true;
  // This factory lives as long as the app. Rebuilding a provider session must not create another worker
  // for a request whose result was lost. Host and speaker identity are bound by the app, never by input.
  const starts = new Map();
  return (hostId, speakerId = hostId, { readOnly = false } = {}) => {
    const contact = store.getContact(hostId);
    if (!contact) return [];
    // A project manager starts no conversation and messages no worker: it acts through its managers.
    if (managers.leads(contact)) {
      return [
        openTerminals(hostId, terminals, readOnly),
        projectInstructions(hostId, instructions),
        ...(managers.oversees(contact) ? projectManagerTools(hostId, managers) : []),
      ];
    }
    const leadName = () => managers.leadOf(store.getContact(hostId))?.name ?? '';
    const userAsks = (id) => managers.startsAtOnce(id);
    // A manager's conversation changes no files, and hands work to the workers it starts: its agents start the ones
    // the user asked for at once, as far as the manager may (see Managers.startsAtOnce). Any other read-only agent's
    // word that the user asked isn't taken: what it starts could change files, so it waits for the user to start it.
    const drafts = readOnly && !managers.oversees(contact);
    // With services there are to invite: only a manager's conversation has them.
    const invites =
      agents.length > 0
        ? inviteToConversation(hostId, managers, agents, userAsks, () => store.settings.roles ?? [])
        : null;
    return [
      openTerminals(hostId, terminals, readOnly),
      startConversation(
        hostId,
        start,
        startsAnyway,
        agents,
        speakerId,
        Boolean(contact.manages),
        starts,
        userAsks,
        drafts
      ),
      projectInstructions(hostId, instructions),
      ...(links?.offered(hostId) ? [linkPullRequest(hostId, links, readOnly)] : []),
      ...(managers.oversees(contact) ? managerTools(hostId, managers, leadName, invites) : []),
    ];
  };
}
