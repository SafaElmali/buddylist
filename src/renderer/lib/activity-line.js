// "ran `npm test`", "edited app.js": what one tool call is said as, after who made it, and what it came to.
// The conversation window folds the calls an agent makes one after another (see chat/activity.js); the phone
// lists them one by one (see phone/).
import { html } from './dom.js';
import { relativePath } from './format.js';
import { activityRequest, activityStatus, appDone } from '../../shared/activity-text.js';
import { checkInWhen, isLoopSentinel } from '../../shared/check-ins.js';

/** @typedef {import('../../providers/contract.js').Activity} Activity */

const clip = (s, max = 160) => (s.length > max ? `${s.slice(0, max)}…` : s);

/**
 * What to say about an activity. Returns trusted markup.
 * @param {Activity} a
 * @param {string} cwd
 */
export function describeActivity(a, cwd) {
  const file = (p) => html`<b title="${p}">${relativePath(p, cwd)}</b>`;
  const code = (s) => html`<code>${clip(String(s || '').split('\n')[0])}</code>`;
  switch (a.kind) {
    case 'command':
      return a.background ? html`started ${code(a.command)} in the background` : html`ran ${code(a.command)}`;
    case 'read':
      return html`read ${file(a.path)}`;
    case 'write':
      return html`wrote ${file(a.path)}`;
    case 'edit':
      return a.changes?.length > 1
        ? html`made ${a.changes.length} changes to ${file(a.path)}`
        : html`edited ${file(a.path)}`;
    case 'search':
      return a.label === 'files'
        ? html`looked for files matching ${code(a.query)}`
        : html`searched for ${code(a.query)}`;
    case 'web':
      return a.url ? html`opened <a href="${a.url}">${clip(a.url, 80)}</a>` : html`searched the web for “${a.query}”`;
    case 'delegate':
      return html`asked a subagent to <i>${a.label}</i>`;
    case 'todo':
      return html`updated the to-do list`;
    case 'plan':
      return html`finished a plan`;
    case 'question':
      return html`asked you a question`;
    case 'skill':
      return html`used the <b>${a.label}</b> skill`;
    case 'schedule': {
      if (a.action === 'cancel') return html`cancelled a check-in`;
      if (a.action === 'list') return html`looked at its check-ins`;
      // What /loop makes up a prompt of its own for is said in why it checks back, where there is one.
      const what = isLoopSentinel(a.prompt) ? a.description : a.prompt;
      return html`will check back ${checkInWhen(a)}${what ? html`: <i>${clip(String(what).split('\n')[0])}</i>` : ''}`;
    }
    case 'app':
      // A conversation is told by what it was started to do.
      if (a.action === 'conversation') {
        return html`${appDone(a)}${a.prompt ? html`: <i>${clip(a.prompt.split('\n')[0])}</i>` : ''}`;
      }
      // Instructions are told by which of them: their first line is often only a heading.
      if (a.action === 'read-instructions' || a.action === 'save-instructions') {
        return html`${appDone(a)}${a.label ? html`: <i>${a.label}</i>` : ''}`;
      }
      // A manager's message is told by whom it went to, and how it starts: a project manager's, with whose job.
      if (a.action === 'message') {
        const job = a.job ? html` about <b>${a.job}</b>’s job` : '';
        return html`sent <b>${a.label}</b> a
          message${job}${a.prompt ? html`: <i>${clip(a.prompt.split('\n')[0])}</i>` : ''}`;
      }
      // A manager's invite is told by who joined which conversation, and as what.
      if (a.action === 'invite') {
        return html`invited ${a.agent ? html`<b>${a.agent}</b>` : 'an agent'} into <b>${a.label}</b>${
            a.role ? html` as <i>${a.role}</i>` : ''
          }`;
      }
      // A manager's answer is told by whose questions it answered, and with what.
      if (a.action === 'answer-question') {
        const said = (a.answers || []).join(' · ');
        const whose = a.label
          ? html`answered <b>${a.label}</b>’s ${a.count > 1 ? `${a.count} questions` : 'question'}`
          : appDone(a);
        return html`${whose}${said ? html`: <i>${clip(said)}</i>` : ''}`;
      }
      if (a.action === 'teams') return html`looked at ${a.label ? html`<b>${a.label}</b>` : 'the teams'}`;
      if (a.action === 'look' && a.label) return html`looked at the changes of <b>${a.label}</b>`;
      // Sources are told by the ones added.
      if (a.action === 'save-sources') {
        return html`${appDone(a)}${a.names?.length ? html`: <i>${a.names.join(', ')}</i>` : ''}`;
      }
      if (['look', 'read-brief', 'save-brief', 'read-sources'].includes(a.action)) return html`${appDone(a)}`;
      return html`${appDone(a)}${a.names?.length ? html`: <i>${a.names.join(', ')}</i>` : ''}${
        a.command ? html`, to run ${code(a.command)}` : ''
      }`;
    default:
      return a.source ? html`used <b>${a.label}</b> from ${a.source}` : html`used <b>${a.label}</b>`;
  }
}

/**
 * What to say about a call that hasn't come back yet, where describeActivity says what one did: "running `npm test`"
 * rather than "ran", or, while its card waits for your answer, "wants to run `npm test`". The phone lists calls as
 * they go (see phone/conversation.js). Returns trusted markup.
 * @param {Activity} a
 * @param {string} cwd
 * @param {{ asked?: boolean }} [opts]  asked: its card waits for your answer
 */
export function describePending(a, cwd, { asked = false } = {}) {
  const file = (p) => html`<b title="${p}">${relativePath(p, cwd)}</b>`;
  const code = (s) => html`<code>${clip(String(s || '').split('\n')[0])}</code>`;
  if (asked)
    switch (a.kind) {
      case 'command':
        return html`wants to run ${code(a.command)}`;
      case 'read':
      case 'write':
      case 'edit':
        return html`wants to ${a.kind} ${file(a.path)}`;
      case 'web':
        return a.url ? html`wants to open <a href="${a.url}">${clip(a.url, 80)}</a>` : html`wants to search the web`;
      default:
        return html`wants to ${activityRequest(a)}`;
    }
  switch (a.kind) {
    case 'command':
      return a.background ? html`starting ${code(a.command)} in the background` : html`running ${code(a.command)}`;
    case 'read':
      return html`reading ${file(a.path)}`;
    case 'write':
      return html`writing ${file(a.path)}`;
    case 'edit':
      return html`editing ${file(a.path)}`;
    case 'search':
      return a.label === 'files'
        ? html`looking for files matching ${code(a.query)}`
        : html`searching for ${code(a.query)}`;
    case 'web':
      return a.url ? html`opening <a href="${a.url}">${clip(a.url, 80)}</a>` : html`searching the web for “${a.query}”`;
    case 'delegate':
      return html`asking a subagent to <i>${a.label}</i>`;
    case 'skill':
      return html`using the <b>${a.label}</b> skill`;
    default: {
      // What its status line says: "Sending a message", "Using lookup".
      const status = activityStatus(a);
      return html`${status[0].toLowerCase()}${status.slice(1)}`;
    }
  }
}

/**
 * What a call came to, as its line says it: '' for one that went through.
 * @param {{ isError?: boolean, declined?: boolean, skipped?: boolean, stopped?: boolean }} result
 */
export const outcomeOf = ({ isError, declined, skipped, stopped }) =>
  declined ? 'declined' : skipped ? 'skipped' : stopped ? 'stopped' : isError ? 'failed' : '';
