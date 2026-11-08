// Plain-text descriptions of provider-neutral activities.
// Shared by the main process (contact status lines) and the windows.

/** @typedef {import('../providers/contract.js').Activity} Activity */

export const basename = (p = '') => String(p).split(/[\\/]/).filter(Boolean).pop() || String(p);

const firstLine = (s = '', max = 60) => {
  const line = String(s).split('\n')[0];
  return line.length > max ? `${line.slice(0, max)}…` : line;
};

/** How many lines of each side of a file change are kept: as many as the windows show. */
export const CHANGE_LINES = 40;

/**
 * One side of a file change as it is kept: its first CHANGE_LINES lines, then a line saying how
 * many more there were. An agent can write a whole file in one go, and its conversation keeps
 * every change it makes. Clipping what was clipped already changes nothing.
 * @param {string} text
 */
export function clipLines(text) {
  const lines = text.split('\n');
  // One line over is kept as it is: the line saying so would take its place.
  if (lines.length <= CHANGE_LINES + 1) return text;
  return [...lines.slice(0, CHANGE_LINES), `… ${lines.length - CHANGE_LINES} more lines`].join('\n');
}

/**
 * A change to a file, as an activity has it: each side clipped.
 * @param {string} before
 * @param {string} after
 */
export const fileChange = (before, after) => ({ before: clipLines(before), after: clipLines(after) });

/**
 * The terminals the app was asked for, counted: "a terminal", "3 terminals".
 * @param {Activity} activity  one of kind `app`
 */
const terminals = ({ count = 1 }) => (count === 1 ? 'a terminal' : `${count} terminals`);

/** How many questions a manager answered: "a question", "2 questions". */
const questions = ({ count = 1 }) => (count === 1 ? 'a question' : `${count} questions`);

/**
 * What the app did for an agent, for its line in the conversation: "opened 3 terminals". A
 * conversation an agent started of its own accord waits for the user to send it its first message.
 * @param {Activity} activity  one of kind `app`
 */
export function appDone(activity) {
  if (activity.action === 'read-instructions') return 'read the project’s instructions';
  if (activity.action === 'save-instructions') return 'saved the project’s instructions';
  if (activity.action === 'message') return 'sent a message';
  if (activity.action === 'invite') return 'invited an agent';
  if (activity.action === 'answer-question') return `answered ${questions(activity)}`;
  if (activity.action === 'look') return activity.label ? 'looked at the changes' : 'looked at the conversations';
  if (activity.action === 'teams') return activity.label ? `looked at ${activity.label}` : 'looked at the teams';
  if (activity.action === 'read-brief') return 'read the project’s brief';
  if (activity.action === 'save-brief') return 'saved the project’s brief';
  if (activity.action === 'read-sources') return 'read the project’s sources';
  if (activity.action === 'save-sources') return 'updated the project’s sources';
  if (activity.action !== 'conversation') return `opened ${terminals(activity)}`;
  return activity.started ? 'started a conversation' : 'added a conversation for you to start';
}

/** What an agent asking the app for something is up to, for its status line, where it opens no terminals. */
const APP_STATUS = {
  conversation: 'Starting a conversation',
  'read-instructions': 'Reading the project’s instructions',
  'save-instructions': 'Saving the project’s instructions',
  message: 'Sending a message',
  invite: 'Inviting an agent',
  'answer-question': 'Answering a question',
  look: 'Looking at the conversations',
  teams: 'Looking at the teams',
  'read-brief': 'Reading the project’s brief',
  'save-brief': 'Saving the project’s brief',
  'read-sources': 'Reading the project’s sources',
  'save-sources': 'Updating the project’s sources',
};

/** And what it asks to do, where it is asked about. */
const APP_REQUEST = {
  conversation: 'start a conversation',
  'read-instructions': 'read the project’s instructions',
  'save-instructions': 'save the project’s instructions',
  message: 'send a message',
  invite: 'invite an agent',
  look: 'look at the conversations',
  teams: 'look at the teams',
  'read-brief': 'read the project’s brief',
  'save-brief': 'save the project’s brief',
  'read-sources': 'read the project’s sources',
  'save-sources': 'update the project’s sources',
};

/** What an agent doing something about its check-ins is up to, by what it does. */
const SCHEDULE_STATUS = {
  set: 'Setting a check-in',
  cancel: 'Cancelling a check-in',
  list: 'Looking at its check-ins',
};

/**
 * What a contact is up to, for its status line: "Running npm test".
 * @param {Activity} activity
 */
export function activityStatus(activity) {
  switch (activity?.kind) {
    case 'command':
      return `Running ${firstLine(activity.command)}`;
    case 'read':
      return `Reading ${basename(activity.path)}`;
    case 'write':
    case 'edit':
      return `Editing ${basename(activity.path)}`;
    case 'search':
      return 'Searching the project';
    case 'web':
      return 'Browsing the web';
    case 'delegate':
      return 'Delegating to a subagent';
    case 'todo':
      return 'Updating the to-do list';
    case 'plan':
      return 'Finishing a plan';
    case 'question':
      return 'Asking you a question';
    case 'skill':
      return `Using the ${activity.label} skill`;
    case 'schedule':
      return SCHEDULE_STATUS[activity.action] || SCHEDULE_STATUS.set;
    case 'app':
      return APP_STATUS[activity.action] || `Opening ${terminals(activity)}`;
    case 'account':
      return `Switching to ${activity.label}`;
    default:
      return `Using ${activity?.label || 'a tool'}`;
  }
}

/**
 * Someone doing something, as a sentence says it: "Claude is running npm test".
 * @param {string} who
 * @param {string} status  what they are doing, as a status line says it: "Running npm test"
 */
export const isDoing = (who, status) => `${who} is ${status[0].toLowerCase()}${status.slice(1)}`;

/**
 * What a contact still writing out a tool call is up to, from as much of the call as has come in:
 * "Writing schema.rb". A long file, command or plan takes a while to write before it is run.
 * @param {Activity} activity
 */
export function draftingStatus(activity) {
  const path = (doing, what) => (activity.path ? `${doing} ${basename(activity.path)}` : `${doing} ${what}`);
  switch (activity?.kind) {
    case 'write':
      return path('Writing', 'a file');
    case 'edit':
      return path('Editing', 'a file');
    case 'read':
      return path('Reading', 'a file');
    case 'command':
      return 'Writing a command';
    case 'plan':
      return 'Writing a plan';
    case 'question':
      return 'Writing you a question';
    case 'delegate':
      return 'Briefing a subagent';
    case 'skill':
      return 'Picking a skill';
    default:
      return activityStatus(activity);
  }
}

/**
 * What is said of helpers that are still at it: "2 subagents at work". It is the status line of a
 * contact whose own turn is over, and the line at the top of the Subagents tab.
 * @param {number} count
 */
export const helpersAtWork = (count) => `${count} ${count === 1 ? 'subagent' : 'subagents'} at work`;

/**
 * What the agent wants permission for: "run a command".
 * @param {Activity} activity
 * @param {(path: string) => string} [showPath]
 */
export function activityRequest(activity, showPath = basename) {
  switch (activity?.kind) {
    case 'command':
      return 'run a command';
    case 'write':
      return `create ${showPath(activity.path)}`;
    case 'edit':
      return `edit ${showPath(activity.path)}`;
    case 'read':
      return `read ${showPath(activity.path)}`;
    case 'web':
      return activity.url ? 'open a web page' : 'search the web';
    case 'search':
      return 'search your files';
    case 'delegate':
      return 'ask a subagent';
    case 'skill':
      return `use the ${activity.label} skill`;
    case 'schedule':
      if (activity.action === 'cancel') return 'cancel a check-in';
      return activity.action === 'list' ? 'look at its check-ins' : 'check back later';
    case 'app':
      // A manager's message, by whom it is for: a project manager's, with whose job it hands on.
      if (activity.action === 'message' && activity.label)
        return `send ${activity.label} a message${activity.job ? ` about ${activity.job}’s job` : ''}${
          activity.urgent ? ' using Send now (may interrupt its running tool)' : ''
        }`;
      // A manager's invite, by who joins which conversation, and as what.
      if (activity.action === 'invite' && activity.label)
        return `invite ${activity.agent || 'an agent'} into ${activity.label}${activity.role ? ` as ${activity.role}` : ''}`;
      // A manager's answer, by whose questions.
      if (activity.action === 'answer-question')
        return activity.label
          ? `answer ${activity.label}’s ${questions(activity).replace(/^a /, '')}`
          : `answer ${questions(activity)}`;
      if (APP_REQUEST[activity.action]) return APP_REQUEST[activity.action];
      // Which command is under the request, as for one the agent runs itself.
      return activity.command
        ? `open ${terminals(activity)} and run a command in ${activity.count === 1 ? 'it' : 'each'}`
        : `open ${terminals(activity)}`;
    case 'account':
      return `switch to ${activity.label}`;
    default:
      return `use ${activity?.label || 'a tool'}${activity?.source ? ` (${activity.source})` : ''}`;
  }
}
