// What the phone app's conversation says in its own lines: how a turn ended, who is talking, which of your
// messages wait to be read, and whether there is anyone to stop.
import { el, html } from '../lib/dom.js';
import { sentence, took } from '../lib/format.js';
import { basename } from '../../shared/activity-text.js';
import { pathInside } from '../../shared/paths.js';
import { yourComputer } from './host.js';

/** What a conversation's header says while someone in it is at work, or waits for you. */
const STATES = Object.freeze({
  connecting: 'Starting',
  working: 'Working',
  waiting: 'Waiting for you',
});

/**
 * What a conversation's header says of it: what goes on in it, else whether its contact can be reached. One with no
 * session yet is "offline" by its state, and as reachable as ever.
 * @param {string} state  the conversation's, as chat:init and its state events say it
 * @param {string} [status]  its contact's, as its view says it
 */
export const stateLabel = (state, status = 'online') => STATES[state] || (status === 'offline' ? 'Offline' : 'Online');

/** Whether there is anyone at work to stop, as the conversation window's Stop has it. @param {string} state */
export const canStop = (state) => ['working', 'waiting', 'connecting'].includes(state);

/**
 * How a turn ended, in its line: "Done in 4s", "Stopped.", or what went wrong.
 * @param {{ isError?: boolean, stopped?: boolean, usageLimited?: boolean, errorText?: string, durationMs?: number }} result
 */
export function resultLine({ isError, stopped, usageLimited, errorText, durationMs }) {
  if (stopped) return 'Stopped.';
  if (usageLimited) return errorText || 'Usage limit reached.';
  if (isError) return `Stopped early: ${sentence(errorText || 'something went wrong')}`;
  return `Done in ${took(durationMs || 0)}`;
}

/**
 * Your messages that wait to be read: the newest `count` of them, as the app counts them (see the `waiting` event).
 * @template T
 * @param {T[]} messages  yours, oldest first
 * @param {number} count
 * @returns {T[]}
 */
export const queuedOf = (messages, count) => (count > 0 ? messages.slice(-count) : []);

/**
 * Who said something in a conversation: the participant it names, else its host. A guest that has left keeps the
 * name it was saved with, and no picture: nobody here knows it. As the conversation window's (see chat/participants.js).
 * @param {{ id: string, name: string, avatar?: string }[]} participants  the host first
 * @param {{ speaker?: string, speakerName?: string }} [said]
 */
export function speakerOf(participants, { speaker, speakerName } = {}) {
  const here = participants.find((one) => one.id === speaker);
  const who = here || participants[0] || { id: '', name: '' };
  return { name: speakerName ?? who.name, avatar: here || !speakerName ? who.avatar : null };
}

/**
 * What a nudge or a wink says: sent by you, or by the contact to you. A nudge of yours is the app's Stop (see
 * Conversations.interrupt), and says so.
 * @param {{ kind: string, from?: string }} entry
 * @param {string} name  the contact's
 */
export function signalLine({ kind, from }, name) {
  if (from !== 'me') return `${name} has just sent you a ${kind}.`;
  return kind === 'nudge' ? 'You stopped it.' : `You have just sent a ${kind}.`;
}

/**
 * How far along a to-do list is: "1 of 3 done · Editing cart.js", or "1 of 3 done · stopped" once a Stop ended
 * what it was doing.
 * @param {{ text: string, activeForm?: string, status: string }[]} todos
 * @param {{ stopped?: boolean }} [opts]
 */
export function todoProgress(todos, { stopped = false } = {}) {
  const done = todos.filter((todo) => todo.status === 'completed').length;
  const now = todos.find((todo) => todo.status === 'in_progress');
  const doing = now && (stopped ? 'stopped' : now.activeForm || now.text);
  return `${done} of ${todos.length} done${doing ? ` · ${doing}` : ''}`;
}

/**
 * What the phone makes of a reply's Markdown once it is drawn. The pictures it names on the Mac (file: addresses, or
 * paths from the top: see pictureAddress in shared/links.js) are asked of the Mac where they are in the contact's
 * folder, each in a tile (see pictures.js) with what the reply calls it under it. One elsewhere, such as in /tmp, is
 * said by its name, with where it is on the Mac. Pictures from the web or of the page itself (data:, blob:) stay.
 * Code and tables, which scroll on their own, can be reached from a keyboard, and are named.
 * @param {ParentNode} root  a reply's Markdown, as it was drawn
 * @param {{ pictures?: import('./pictures.js').ConversationPictures | null, folder?: string, who?: string }} [shown]
 *   what draws its pictures, the contact's folder, and whose reply it is
 */
export function fitForPhone(root, { pictures = null, folder = '', who = '' } = {}) {
  for (const picture of root.querySelectorAll('img')) {
    const address = picture.getAttribute('src') || '';
    if (!/^(file:|\/(?!\/))/.test(address)) continue;
    let path = address;
    try {
      path = decodeURIComponent(new URL(address, 'file:///').pathname);
    } catch {
      // Said as it was written.
    }
    const name = basename(path);
    const alt = (picture.getAttribute('alt') || '').trim();
    // In the contact's folder, where the Mac shows it from (and decides again): one elsewhere is said by its name.
    if (pictures && folder && pathInside(path, folder)) {
      const shown = el(html`<span class="ph-reply-pic"></span>`);
      shown.append(
        pictures.tile({ which: { file: address }, title: alt || name, who, name }, { label: `Picture: ${alt || name}` })
      );
      if (alt) shown.append(el(html`<span class="ph-reply-pic-said" aria-hidden="true">${alt}</span>`));
      picture.replaceWith(shown);
      continue;
    }
    picture.replaceWith(
      el(
        html`<span class="ph-mac-picture" title="${path}"
          >Picture on ${yourComputer()}: ${alt ? `${alt} (${name})` : name}</span
        >`
      )
    );
  }
  for (const table of root.querySelectorAll('table')) {
    table.setAttribute('tabindex', '0');
    table.setAttribute('aria-label', 'Table');
  }
  for (const code of root.querySelectorAll('pre')) {
    code.setAttribute('tabindex', '0');
    code.setAttribute('role', 'group');
    code.setAttribute('aria-label', 'Code');
  }
}
