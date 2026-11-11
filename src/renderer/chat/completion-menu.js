// The list that opens over the message box to finish what you are typing: a
// slash command after "/", a file after "@", and in a group, the agents' names.
// In a worker's conversation, its manager comes first (see manager-tag.js): greyed
// out, with why, while it can't be asked. In a project's manager's conversation,
// the conversations it oversees come after the agents. Then the terminals beside the conversation, and before the
// files: picking one takes the "@" out and puts a card in the box, as Send Files
// does a file. Comments on changes complete names only. Arrow keys with
// Enter or Tab pick one, or the mouse does, and Esc puts the list away. A name's
// or a file's list opens at its @, a command's at the start of the box.
import { buddy, smallIcon } from '../lib/icons.js';
import { closeMenu, openMenu, position } from '../lib/menu.js';
import { letterAt } from './caret-line.js';
import { commandAt, commandNames, completeCommand } from './command-completion.js';
import { taggable } from './conversation-tags.js';
import { managerRow, tagManagerOf } from './manager-tag.js';
import { completeMention, dropMention, mentionAt, outputAt } from './mention-completion.js';
import { buddyStatus, isGroup } from './participants.js';
import { sameName } from '../../shared/mentions.js';
import { completeFile, fileAt } from './file-completion.js';

// Keys that move the caret without typing anything.
const CARET_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];

/**
 * @typedef {Object} Completion
 * @property {string} key  what is on offer, to tell when typing changes that
 * @property {number} [from]  where the word it finishes starts in the box: the @ of a name or a file, where the
 *   list opens. A command has none, as it starts the message: its list opens against the whole box
 * @property {{ label?: string, icon?: string, hint?: string, title?: string, ariaLabel?: string, disabled?: boolean, separator?: boolean, complete?: (text: string, caret: number) => { text: string, caret: number }, picked?: () => void }[]} items
 *   `complete` gives the message with the item written out, and where the caret goes. `picked`: what else
 *   picking it does, once it is written. A separator sets the next kind apart
 */

/** `items`, set apart from those before them, if there are any. */
const after = (before, items) => (before.length && items.length ? [{ separator: true }, ...items] : items);

/**
 * Who an @ can name in a conversation: in a group, the agents in it, a mention of which says who answers; in a
 * worker's conversation, its manager, which answers here (see manager-tag.js), and `held`, the one that can't be
 * asked now; in a project's manager's conversation, the conversations it oversees, which a tag points at (see
 * conversation-tags.js). With one agent, and no conversation it oversees, nobody.
 * @param {{ participants: { id: string, name: string }[], contact: any, contacts?: any[] }} ctx
 */
export const nameable = ({ participants, contact, contacts = [] }) => {
  const tag = tagManagerOf(contact, contacts);
  // A guest by the manager's name is the one a mention names.
  const own = tag && !participants.some((one) => one.id === tag.manager.id || sameName(one.name, tag.manager.name));
  return {
    mentionable: isGroup(participants) ? participants : [],
    manager: own && !tag.why ? tag.manager : null,
    held: own && tag.why ? tag : null,
    tags: taggable(contact, contacts, participants),
  };
};

/**
 * What can be finished at the caret: the command the message starts with, or a mention or a tag. The agents in
 * the conversation come first, then the conversations to tag, then the terminals whose output can go with it.
 * @param {string} value  what is in the box
 * @param {number} caret
 * @param {{ contact: any, provider: any, commands: string[], participants: any[], contacts?: any[] }} ctx
 * @param {boolean} [commands]  false where a slash command would not run
 * @param {object} [terminals]
 * @param {import('../../shared/terminal-mentions.js').OutputCard[]} [terminals.outputs]  the side pane's
 * @param {(card: import('../../shared/terminal-mentions.js').OutputCard) => void} [terminals.pick]  puts one in the box
 * @returns {Completion | null}
 */
export function completionAt(value, caret, ctx, commands = true, { outputs = [], pick = () => {} } = {}) {
  const command = commands && commandAt(value, caret, commandNames(ctx));
  if (command) {
    return {
      key: `/${command.matches.join()}`,
      items: command.matches.map((name) => ({
        label: `/${name}`,
        complete: (text, at) => completeCommand(text, at, name),
      })),
    };
  }
  const { mentionable, manager, held, tags } = nameable(ctx);
  // The manager first: it answers here, whoever else is named.
  const mention = mentionAt(value, caret, [...(manager ? [manager] : []), ...mentionable, ...tags]);
  // One that can't be asked is said once its name is begun, to say why: it is never written in.
  const greyed = held && mentionAt(value, caret, [held.manager]);
  const output = outputAt(value, caret, outputs);
  if (!mention && !output && !greyed) return null;
  const from = (mention ?? output ?? greyed).at;
  const folderGone = ctx.contact.status === 'offline';
  const people = (mention?.matches ?? []).map((person) =>
    person === manager
      ? {
          label: person.name,
          // As the contact list has it: its buddy with the star of a manager.
          icon: buddy(person.status, 16, { lead: true }),
          ...managerRow({ manager: person, why: null }),
          complete: (text, at) => completeMention(text, from, at, person),
        }
      : {
          label: person.name,
          // A conversation to tag wears its buddy as the contact list has it, an agent here as the Agents tab has it.
          icon: buddy(tags.includes(person) ? person.status : buddyStatus(person.state, folderGone, person.paused)),
          complete: (text, at) => completeMention(text, from, at, person),
        }
  );
  if (greyed) {
    people.unshift({
      label: held.manager.name,
      icon: buddy('offline', 16, { lead: true }),
      ...managerRow(held),
    });
  }
  const terminals = (output?.matches ?? []).map((card) => ({
    label: card.name,
    icon: smallIcon.terminal(),
    hint: card.kind === 'script' ? 'Script' : 'Terminal',
    complete: (text, at) => dropMention(text, from, at),
    picked: () => pick(card),
  }));
  return {
    key: `${from}:${[...(greyed ? [held.manager] : []), ...(mention?.matches ?? []), ...(output?.matches ?? [])].map((one) => one.id).join()}`,
    from,
    items: [...people, ...after(people, terminals)],
  };
}

export class CompletionMenu {
  #revision = 0;
  #redrawing = false;
  /** Where the open list's word starts (see Completion), for the list to stay at it while you type. */
  #from;
  /**
   * @param {HTMLTextAreaElement} input
   * @param {{ contact: any, provider: any, commands: string[], participants: import('../../providers/contract.js').Participant[], contacts?: any[] }} ctx
   *   `contacts`: every contact, as the contact list has them, for the conversations a manager oversees
   * @param {() => void} changed  a command or a name was written into the message
   * @param {{ commands?: boolean, above?: boolean, files?: (query: string) => Promise<{ paths: string[], more: boolean, limited?: boolean }>,
   *   outputs?: () => import('../../shared/terminal-mentions.js').OutputCard[],
   *   pickOutput?: (card: import('../../shared/terminal-mentions.js').OutputCard) => void }} [opts]
   *   `commands`: false where a slash command would not run, as in a comment on a line of a diff.
   *   `above`: false for a box with room under it, where the list goes unless there is none.
   *   `outputs`: the terminals "@" offers, as they are now, and `pickOutput` puts one picked in the box
   */
  constructor(
    input,
    ctx,
    changed,
    { commands = true, above = true, files = null, outputs = null, pickOutput = null } = {}
  ) {
    this.input = input;
    this.ctx = ctx;
    this.changed = changed;
    this.commands = commands;
    this.above = above;
    this.files = files;
    this.outputs = outputs;
    this.pickOutput = pickOutput;
    /** The open list: what it offers, to tell when typing changes that. Empty while it is closed. */
    this.offered = '';
    /** @type {HTMLElement | null} */
    this.node = null;
    input.addEventListener('input', () => this.update());
    input.addEventListener('click', () => this.update());
    input.addEventListener('keyup', (e) => {
      if (CARET_KEYS.includes(e.key)) this.update();
    });
    // Scrolling the box takes the word along, and its list with it.
    input.addEventListener('scroll', () => this.#place());
    input.addEventListener('blur', () => {
      this.#revision++;
      if (this.node) closeMenu();
    });
    // Enter picks from an open menu already (see lib/menu.js). Tab does too. A list
    // still loading, or showing an empty/error row, must not send an unfinished @path.
    input.addEventListener(
      'keydown',
      (e) => {
        if (e.isComposing || e.defaultPrevented || !this.node || !['Tab', 'Enter'].includes(e.key)) return;
        e.preventDefault();
        /** @type {HTMLElement} */ (this.node.querySelector('.menu-item.active'))?.click();
      },
      true
    );
  }

  /** What can be finished at the caret, with nothing selected. @returns {Completion | null} */
  #found() {
    const { value, selectionStart, selectionEnd } = this.input;
    if (selectionStart !== selectionEnd) return null;
    const terminals = this.outputs ? { outputs: this.outputs(), pick: this.pickOutput } : undefined;
    return completionAt(value, selectionStart, this.ctx, this.commands, terminals);
  }

  /** Opens, redraws or closes the list to go with what is typed at the caret. */
  update() {
    const revision = ++this.#revision;
    const found = this.#found();
    const { value, selectionStart, selectionEnd } = this.input;
    const file =
      this.files && this.ctx.contact?.cwd && selectionStart === selectionEnd ? fileAt(value, selectionStart) : null;
    // A fully typed agent name remains ready to send, as before file completion existed. So does a tag.
    const { mentionable, manager, tags } = nameable(this.ctx);
    const named = [...mentionable, ...(manager ? [manager] : []), ...tags].some(
      (person) => person.name.trim().toLowerCase() === file?.query.toLowerCase()
    );
    if (!file || named || found?.key.startsWith('/')) return this.#draw(found);
    const { contactId, contact } = this.ctx;
    const cwd = contact.cwd;
    const items = found?.items ?? [];
    this.#draw({
      key: `files:${value}:${selectionStart}:loading`,
      from: file.at,
      items: [...items, ...after(items, [{ label: 'Finding files…', disabled: true }])],
    });
    Promise.resolve()
      .then(() => this.files(file.query))
      .then(
        ({ paths, more, limited }) => {
          if (
            revision !== this.#revision ||
            contactId !== this.ctx.contactId ||
            cwd !== this.ctx.contact.cwd ||
            value !== this.input.value ||
            selectionStart !== this.input.selectionStart
          )
            return;
          // A file already typed to its end needs no completion, so Enter can send it.
          if (!items.length && paths.length === 1 && paths[0] === file.query.replace(/^\.\//, '') && !file.quoted) {
            return this.#draw(null);
          }
          const files = paths.map((path) => ({
            label: path,
            icon: smallIcon.doc(),
            complete: (text, caret) => completeFile(text, file.at, caret, path),
          }));
          const note = limited
            ? 'Some files omitted. Use Attach files for more.'
            : more
              ? 'Keep typing to narrow the files.'
              : null;
          this.#draw({
            key: `files:${value}:${selectionStart}:${JSON.stringify(paths)}`,
            from: file.at,
            items: [
              ...items,
              ...after(items, [
                ...files,
                ...(note ? [{ label: note, disabled: true }] : []),
                ...(!files.length ? [{ label: 'No matching files.', disabled: true }] : []),
              ]),
            ],
          });
        },
        () => {
          if (revision !== this.#revision) return;
          this.#draw({
            key: `files:${value}:error`,
            from: file.at,
            items: [
              ...items,
              ...after(items, [{ label: 'File search unavailable. Use Attach files.', disabled: true }]),
            ],
          });
        }
      );
  }

  /** Redrawing our menu is different from dismissing it: Escape cancels pending results. */
  #draw(found) {
    const offered = found?.key ?? '';
    // The same list, where its word is now: what was typed after it may have wrapped it on to the next line.
    if (offered === this.offered) return this.#place();
    if (!found) {
      if (this.node) closeMenu();
      return;
    }
    const selected = this.node?.querySelector('.menu-item.active .menu-label')?.textContent;
    this.#redrawing = true;
    this.#from = found.from;
    this.node = openMenu(
      this.input,
      found.items.map(({ complete, picked, ...item }) => ({ ...item, action: () => this.#write(complete, picked) })),
      {
        ...this.#against(),
        className: 'completion-menu',
        onClose: () => {
          this.offered = '';
          this.node = null;
          if (!this.#redrawing) this.#revision++;
        },
      }
    );
    this.#redrawing = false;
    // Opening the list closed the one before it, which emptied `offered`.
    this.offered = offered;
    const choices = [...this.node.querySelectorAll('.menu-item:not(.disabled)')];
    for (const row of choices) row.title ||= row.querySelector('.menu-label').textContent;
    (choices.find((row) => row.querySelector('.menu-label').textContent === selected) ?? choices[0])?.classList.add(
      'active'
    );
    // A click in the list must not take the caret out of the message.
    this.node.addEventListener('mousedown', (e) => e.preventDefault());
  }

  /**
   * Where the list goes: over the line its word starts on (under it, in a box with room under it), from the
   * word's @, so it stays put while the rest is typed. Right to left, it ends there instead. A command's
   * list goes against the whole box.
   */
  #against() {
    if (this.#from === undefined) return { above: this.above };
    const rtl = getComputedStyle(this.input).direction === 'rtl';
    return { above: this.above, rect: letterAt(this.input, this.#from), align: rtl ? 'right' : 'left' };
  }

  #place() {
    if (this.node) position(this.node, this.input, this.#against());
  }

  /**
   * @param {Completion['items'][number]['complete']} complete  as it is typed now, not when the list opened
   * @param {Completion['items'][number]['picked']} [picked]
   */
  #write(complete, picked) {
    const { text, caret } = complete(this.input.value, this.input.selectionStart);
    this.input.value = text;
    this.input.setSelectionRange(caret, caret);
    this.input.focus();
    picked?.();
    this.changed();
  }
}
