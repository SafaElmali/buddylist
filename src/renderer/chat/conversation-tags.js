// "@Claude (cart)" in a project's manager's conversation: a tag of a conversation it oversees (see team-tab.js).
// A tag points the manager at that conversation, and sends that conversation nothing: only the manager's own tool
// messages it, and asks you first. A click on a tag in a message shows that conversation, as a row of the Team tab
// does. A mention is something else: in a group, it says who answers (see shared/mentions.js).
import { mentionRanges, sameName } from '../../shared/mentions.js';
import { crewOf, teamOf } from './team-tab.js';

/** What a tag is drawn with, and found by when it is clicked. */
export const TAG_CLASS = 'conversation-tag';

/**
 * The conversations that can be tagged in a contact's conversation: the ones it oversees as its project's manager,
 * the ones its Team tab lists. None for any other contact, or for a manager turned off. One that is in the
 * conversation, as a guest, is a participant to mention, and so is one that goes by a participant's name: a
 * mention could not tell the two apart.
 * @template {{ id: string, name: string, project?: string, archived?: boolean, manages?: string, status: string }} C
 * @param {(C & { oversees?: boolean }) | null} contact  the contact the window shows, as the contact list has it
 * @param {C[]} contacts  every contact, as the contact list has them
 * @param {{ id: string, name: string }[]} participants  everyone in the conversation, the host first
 * @returns {C[]}
 */
export const taggable = (contact, contacts, participants) =>
  contact?.oversees
    ? (contact.leads ? leadsTags(contact, contacts) : teamOf(contact, contacts)).filter(
        (one) => !participants.some((p) => p.id === one.id || sameName(p.name, one.name))
      )
    : [];

/**
 * What a project manager's conversation tags: its managers, then the project's conversations, whose jobs it hands on.
 * @param {any} lead
 * @param {any[]} contacts
 */
const leadsTags = (lead, contacts) => [
  ...crewOf(lead, contacts),
  ...contacts.filter(
    (one) =>
      !one.manages && !one.archived && !one.guestOf && !one.tabOf && one.project === lead.project && one.id !== lead.id
  ),
];

/**
 * Where a text tags a conversation: each tag from its @ to the end of the name, in order. Names match in any letter
 * case, as mentions do.
 * @param {string} text
 * @param {{ id: string, name: string }[]} tags  the conversations that can be tagged
 * @returns {{ start: number, end: number, tag: string }[]}  `tag`: the conversation's id
 */
export const tagRanges = (text, tags) =>
  tags.length ? mentionRanges(text, tags).map(({ start, end, id }) => ({ start, end, tag: id })) : [];

/**
 * What a tag is drawn as: its words, as they were written, to click.
 * @param {string} said  the tag as the message has it, such as "@claude (cart)"
 * @param {{ id: string, name: string }} conversation
 * @returns {HTMLElement}
 */
export function tagNode(said, { id, name }) {
  const node = document.createElement('span');
  node.className = TAG_CLASS;
  node.dataset.tag = id;
  node.title = `Show ${name}’s conversation`;
  node.setAttribute('role', 'link');
  node.tabIndex = 0;
  node.textContent = said;
  return node;
}

/**
 * Draws the tags in a reply as tags, once it is rendered: in its words, and not in its code, its links or the files
 * it names.
 * @param {HTMLElement} root  the reply's text, rendered (see lib/markdown.js)
 * @param {{ id: string, name: string }[]} tags  the conversations that can be tagged
 */
export function markTags(root, tags) {
  if (!tags.length) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(`code, pre, a, .file-mention, .${TAG_CLASS}`)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue;
    const found = tagRanges(text, tags);
    if (!found.length) continue;
    const parts = [];
    let last = 0;
    for (const { start, end, tag } of found) {
      const conversation = tags.find((one) => one.id === tag);
      parts.push(text.slice(last, start), tagNode(text.slice(start, end), conversation));
      last = end;
    }
    parts.push(text.slice(last));
    node.replaceWith(...parts.filter((part) => part !== ''));
  }
}
