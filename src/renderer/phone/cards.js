// What the phone app's cards ask, and what each of their buttons answers (see Conversations.respond): a permission,
// questions, a plan, project instructions. As the conversation window's cards (see chat/invitations.js, plans.js),
// with nothing to edit.
import { activityRequest, clipLines } from '../../shared/activity-text.js';
import { planTitle } from '../../shared/plan-title.js';
import { ASKS_FIRST_MODE } from '../../shared/remote-access.js';

/** @typedef {import('../../providers/contract.js').PermissionResponse} PermissionResponse */
/** @typedef {{ label: string, answer: PermissionResponse, primary?: boolean, quiet?: boolean }} Choice */

/** What a request answered was, in a line about it later: with the verb of the button that answered it. */
export const PAST = Object.freeze({
  allow: 'allowed',
  always: 'always allowed',
  deny: 'declined',
  feedback: 'sent back',
  answer: 'answered',
  skip: 'skipped',
  'approve-plan': 'approved',
  edit: 'saved with your edits',
  cancelled: 'missed',
});

/** What a call asked to do, as a line about it says it: the command itself, quoted (its first line), where there is one. */
function requestOf(activity) {
  if (activity?.kind !== 'command' || !activity.command) return activityRequest(activity);
  const line = String(activity.command).split('\n')[0];
  return `run “${line.length > 60 ? `${line.slice(0, 60)}…` : line}”`;
}

/** And instructions an agent asked to save. */
const SAVED = Object.freeze({
  allow: 'Saved',
  edit: 'Saved with your edits',
  deny: 'Not saved',
  cancelled: 'Not saved: the turn ended before you answered',
});

/**
 * What a request to use a tool shows to look at before answering: the command, the change, the address.
 * @param {import('../../providers/contract.js').PermissionRequest} prompt
 */
function toolDetail({ detail, activity = /** @type {any} */ ({}) }) {
  if (detail) return detail;
  if (activity.command) return activity.command;
  if (activity.changes?.length)
    return activity.changes
      .flatMap(({ before = '', after = '' }) => [
        ...(before
          ? clipLines(before)
              .split('\n')
              .map((line) => `- ${line}`)
          : []),
        ...(after
          ? clipLines(after)
              .split('\n')
              .map((line) => `+ ${line}`)
          : []),
      ])
      .join('\n');
  if (activity.url || activity.query) return activity.url || activity.query;
  if (activity.kind === 'app' && activity.prompt) return activity.prompt;
  return '';
}

/**
 * A request to use a tool: what it asks, what to look at, and Decline and Allow side by side, Allow last. Always allow,
 * where it is offered, is apart from both and quieter: a slip of the thumb shouldn't give a standing permission. Only a
 * phone with full access offers it (see access.js), for the rest of the conversation too where that is all it covers.
 * @param {import('../../providers/contract.js').PermissionRequest} prompt
 * @param {string} name  who asks
 * @param {{ always?: boolean }} [may]  whether this phone may always allow
 * @returns {{ title: string, detail: string, reason: string, choices: Choice[] }}
 */
export const toolCard = (prompt, name, { always = true } = {}) => ({
  title: prompt.title || `${name} would like to ${activityRequest(prompt.activity)}.`,
  detail: toolDetail(prompt),
  reason: prompt.reason || '',
  choices: [
    { label: 'Decline', answer: { decision: 'deny' } },
    { label: 'Allow', answer: { decision: 'allow' }, primary: true },
    ...(prompt.canAlways && always
      ? [
          {
            label: prompt.alwaysLabel || 'Always allow, don’t ask again',
            answer: /** @type {PermissionResponse} */ ({ decision: 'always' }),
            quiet: true,
          },
        ]
      : []),
  ],
});

/**
 * The answer to questions, once each has one: the options picked, or what was written instead.
 * @param {{ question: string, multiSelect?: boolean }[]} questions
 * @param {{ chosen: string[], other: string }[]} picks  for each question, in order
 * @returns {PermissionResponse | null}  null while one has no answer
 */
export function questionAnswer(questions, picks) {
  const answers = {};
  for (const [i, { question }] of questions.entries()) {
    const { chosen = [], other = '' } = picks[i] || {};
    const said = other.trim() || chosen.join(', ');
    if (!said) return null;
    answers[question] = said;
  }
  return questions.length ? { decision: 'answer', answers } : null;
}

/**
 * The ways a plan can be approved, as its provider has them, each starting work in a permission mode of its own. A
 * phone that may not widen what an agent does unasked (Answer only, see access.js) approves only asking before each
 * change, which is then the one to tap.
 * @param {{ mode: string, label: string, primary?: boolean }[]} [approvals]  the provider's planApprovals
 * @param {{ widen?: boolean }} [may]
 * @returns {Choice[]}
 */
export function planChoices(approvals = [], { widen = true } = {}) {
  const offered = approvals.filter(({ mode }) => widen || mode === ASKS_FIRST_MODE);
  return offered.map(({ mode, label, primary }) => ({
    label,
    answer: { decision: 'approve-plan', mode },
    ...((widen ? primary : offered.length === 1) && { primary: true }),
  }));
}

/**
 * Not yet: the agent goes on planning, with what to change if you said.
 * @param {string} said
 * @returns {PermissionResponse}
 */
export const keepPlanning = (said) => ({
  decision: 'feedback',
  message: said.trim() ? `Keep planning. Feedback: ${said.trim()}` : 'Keep planning.',
});

/**
 * A change to the project's instructions: whose and which, the new text, and Save or Don't save.
 * @param {import('../../providers/contract.js').PermissionRequest} prompt
 * @param {string} name  who asks
 * @returns {{ title: string, detail: string, reason: string, choices: Choice[] }}
 */
export function instructionsCard(prompt, name) {
  const { project = '', part = '', after = '' } = prompt.instructions || {};
  const whose = project ? `${project}’s` : 'the project’s';
  return {
    title:
      prompt.title ||
      `${name} would like to ${after ? 'change' : 'remove'} ${whose} ${part ? `${part} ` : ''}instructions.`,
    detail: after,
    reason: prompt.reason || '',
    choices: [
      { label: 'Don’t save', answer: { decision: 'deny' } },
      { label: 'Save', answer: { decision: 'allow' }, primary: true },
    ],
  };
}

/**
 * What a request answered says in the conversation afterwards, as the conversation window has it. Questions a
 * project's manager answered for you say whose answer it was.
 * @param {{ kind: string, decision: string, activity?: any, title?: string | null, plan?: string,
 *   instructions?: { project?: string, part?: string }, answeredBy?: { name: string }, scope?: string }} answered
 *   `scope`: `conversation` for an Always allow that covered the rest of the conversation only
 * @param {string} name  who asked
 */
export function answeredLine({ kind, decision, activity, title, plan, instructions, answeredBy, scope }, name) {
  const forConversation = decision === 'always' && scope === 'conversation';
  const past = forConversation ? 'allowed for this conversation' : PAST[decision] || decision;
  if (kind === 'question' && answeredBy?.name) return `${answeredBy.name} answered ${name}’s question.`;
  if (kind === 'plan')
    return decision === 'feedback'
      ? `You asked ${name} to keep planning: ${planTitle(plan)}.`
      : `You ${past} ${name}’s plan: ${planTitle(plan)}.`;
  if (kind === 'question') return decision === 'skip' ? `You let ${name} decide.` : `You ${past} ${name}’s question.`;
  if (kind === 'instructions') {
    const { project = '', part = '' } = instructions || {};
    const whose = project ? `${project}’s` : 'the project’s';
    return `${SAVED[decision] || SAVED.deny}: ${name}’s change to ${whose} ${part ? `${part} ` : ''}instructions.`;
  }
  if (title) return `You ${past}: ${title}.`;
  const request = requestOf(activity);
  if (decision === 'allow') return `You allowed ${name} to ${request}.`;
  if (forConversation) return `You allowed ${name} to ${request} for the rest of this conversation.`;
  if (decision === 'always') return `You allowed ${name} to ${request}, and won’t be asked again.`;
  return `You ${past}: ${name} wanted to ${request}.`;
}

/**
 * What a request answered somewhere else says, where this page didn't hear how: on the Mac, or on another phone.
 * @param {{ kind: string, activity?: any, title?: string | null, plan?: string }} prompt
 * @param {string} name  who asked
 */
export function answeredElsewhere({ kind, activity, title, plan }, name) {
  const what =
    kind === 'plan'
      ? `${name}’s plan: ${planTitle(plan)}`
      : kind === 'question'
        ? `${name}’s question`
        : kind === 'instructions'
          ? `${name}’s change to the instructions`
          : title || `${name} wanted to ${requestOf(activity)}`;
  return `Already answered elsewhere: ${what}.`;
}

/**
 * What a card asks, in a sentence of its own: its title, or for questions and a plan who asks and what. A screen
 * reader is told it as the card comes (see announce.js).
 * @param {import('../../providers/contract.js').PermissionRequest} prompt
 * @param {string} name  who asks
 */
export function cardSays(prompt, name) {
  if (prompt.kind === 'question') {
    const count = prompt.questions?.length || 0;
    return `${name} has ${count === 1 ? 'a question' : `${count} questions`} for you.`;
  }
  if (prompt.kind === 'plan') return `${name} has a plan: ${planTitle(prompt.plan)}.`;
  if (prompt.kind === 'instructions') return instructionsCard(prompt, name).title;
  return toolCard(prompt, name).title;
}
