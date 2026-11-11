import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { completeMention } from '../src/renderer/chat/mention-completion.js';
import { completionAt, nameable } from '../src/renderer/chat/completion-menu.js';
import { Conversation } from '../src/renderer/chat/conversation.js';
import { markTags, TAG_CLASS, taggable, tagRanges } from '../src/renderer/chat/conversation-tags.js';
import { sentMarks } from '../src/renderer/chat/participants.js';
import { teamOf } from '../src/renderer/chat/team-tab.js';
import { mentions } from '../src/shared/mentions.js';

// ---- who can be tagged: the conversations a project's manager oversees ------------------------------------------

const KEY = 'git:/w/shop/.git';
/** A project's manager, turned on, as the contact list has it. */
const manager = { id: 'm', name: 'shop manager', project: 'shop', manages: KEY, oversees: true, status: 'online' };
/** A conversation on shop that the main process says the manager oversees (see `overseenBy`). */
const worker = (id, more = {}) => ({
  id,
  name: `Claude (${id})`,
  project: 'shop',
  status: 'online',
  overseenBy: 'm',
  ...more,
});
const cart = worker('cart', { lastActive: 2 });
const tags = worker('tags', { status: 'away' });
const blog = worker('blog', { project: 'blog', overseenBy: null });
const old = worker('old', { archived: true });
const contacts = [manager, cart, tags, blog, old];

/** Someone in the conversation, as the window has them. */
const participant = (id, name, more = {}) => ({ id, name, state: 'idle', paused: false, ...more });
const host = participant('m', 'shop manager');
const codex = participant('x', 'Codex');

test('a manager can tag the conversations it oversees: the ones its Team tab lists, in that order', () => {
  assert.deepEqual(taggable(manager, contacts, [host]), teamOf(manager, contacts));
  assert.deepEqual(
    taggable(manager, contacts, [host]).map(({ id }) => id),
    ['tags', 'cart'],
    'the one waiting for you first, and none of another project, nor an archived one'
  );
});

test('any other contact tags nothing: one on its own, a worker, or a manager turned off', () => {
  const plain = { id: 'p', name: 'Claude', project: 'shop', status: 'online' };
  assert.deepEqual(taggable(plain, [plain, ...contacts], [participant('p', 'Claude')]), []);
  assert.deepEqual(taggable(cart, contacts, [participant('cart', 'Claude (cart)')]), []);
  assert.deepEqual(taggable({ ...manager, oversees: false }, contacts, [host]), [], 'it oversees nothing');
  assert.deepEqual(taggable(null, contacts, []), [], 'the message history shows no contact');
});

test('a project manager tags its managers, then the project’s conversations, whose jobs it hands on', () => {
  const lead = {
    id: 'pm',
    name: 'shop project manager',
    project: 'shop',
    manages: KEY,
    leads: true,
    oversees: true,
    status: 'online',
  };
  const led = { ...manager, ledBy: 'pm' };
  const listed = [lead, led, cart, tags, blog, old, worker('tab', { tabOf: 'cart' })];
  assert.deepEqual(
    taggable(lead, listed, [participant('pm', 'shop project manager')]).map(({ id }) => id),
    ['m', 'cart', 'tags']
  );
  assert.deepEqual(taggable({ ...lead, oversees: false }, listed, []), [], 'turned off, it tags nothing');
});

test('a worker that is in the manager’s conversation is a participant, to mention, and not a tag', () => {
  const guest = participant('cart', 'Claude (cart)');
  assert.deepEqual(
    taggable(manager, contacts, [host, guest]).map(({ id }) => id),
    ['tags']
  );
  const namesake = participant('g', 'claude (TAGS)');
  assert.deepEqual(
    taggable(manager, contacts, [host, namesake]).map(({ id }) => id),
    ['cart'],
    'nor one that goes by a participant’s name: a mention could not tell the two apart'
  );
});

test('a tag is found as a mention is, from its @ to the end of the name, in any letter case', () => {
  const team = [cart, tags];
  const found = (text) => tagRanges(text, team).map(({ start, end, tag }) => [text.slice(start, end), tag]);
  assert.deepEqual(found('how is @Claude (cart) doing?'), [['@Claude (cart)', 'cart']]);
  assert.deepEqual(found('@claude (TAGS) and @Claude (cart)'), [
    ['@claude (TAGS)', 'tags'],
    ['@Claude (cart)', 'cart'],
  ]);
  assert.deepEqual(found('@Claude (blog) is not ours, and me@Claude (cart) is an address'), []);
  assert.deepEqual(found('@Claude (cart).md is a file'), []);
  assert.deepEqual(tagRanges('@Claude (cart)', []), [], 'nobody to tag');
});

// ---- the @ list in the message box -------------------------------------------------------------------------------

/** A conversation window's context: its contact, everyone in it and every contact. */
const window = (contact, participants, everyone = contacts) => ({
  contact,
  contacts: everyone,
  participants,
  provider: { commonCommands: ['review', 'compact'] },
  commands: [],
});
/** What the list offers with the caret at the end of `typed`: each label. Null for no list. */
const offered = (typed, ctx) => completionAt(typed, typed.length, ctx)?.items.map(({ label }) => label) ?? null;

test('in a manager’s conversation, @ lists the conversations it oversees, and typing narrows them down', () => {
  const ctx = window(manager, [host]);
  assert.deepEqual(offered('@', ctx), ['Claude (tags)', 'Claude (cart)']);
  assert.deepEqual(offered('how is @cl', ctx), ['Claude (tags)', 'Claude (cart)']);
  assert.deepEqual(offered('@Claude (c', ctx), ['Claude (cart)']);
  assert.equal(offered('@Claude (cart)', ctx), null, 'typed in full: Enter sends it');
  assert.equal(offered('@zz', ctx), null);
  assert.equal(offered('/review @', ctx), null, 'a slash command is the host’s alone');
  assert.deepEqual(offered('/re', ctx), ['/review'], 'commands are completed as ever');
});

test('picking a conversation writes its tag, which the message then tags', () => {
  const ctx = window(manager, [host]);
  const [first] = completionAt('ask @c', 6, ctx).items;
  const done = first.complete('ask @c', 6);
  assert.deepEqual(done, { text: 'ask @Claude (tags) ', caret: 19 });
  assert.deepEqual(done, completeMention('ask @c', 4, 6, tags), 'as a mention is completed');
  assert.deepEqual(
    sentMarks(done.text, [host], taggable(manager, contacts, [host])).map(({ tag }) => tag),
    ['tags']
  );
});

test('a conversation in the list wears its buddy as the contact list has it', () => {
  const [waits, idle] = completionAt('@', 1, window(manager, [host])).items;
  assert.match(waits.icon, /./);
  assert.notEqual(waits.icon, idle.icon, 'the one waiting for you looks away, the other online');
});

test('in an ordinary conversation with one agent, @ opens no list', () => {
  const plain = { id: 'p', name: 'Claude', project: 'shop', status: 'online' };
  assert.equal(offered('@', window(plain, [participant('p', 'Claude')], [plain, ...contacts])), null);
  assert.equal(offered('@cl', window(plain, [participant('p', 'Claude')], [plain, ...contacts])), null);
  assert.deepEqual(nameable(window(plain, [participant('p', 'Claude')])), {
    mentionable: [],
    manager: null,
    held: null,
    tags: [],
  });
});

test('the list for a name opens at its @, which stays put as the rest of the name is typed', () => {
  const plain = { id: 'p', name: 'Claude', project: 'shop', status: 'online' };
  const ctx = window(plain, [participant('p', 'Claude'), codex], [plain, ...contacts]);
  const typed = 'the form should submit to /login, then @';
  const at = typed.length - 1;
  assert.equal(completionAt(typed, typed.length, ctx).from, at);
  assert.equal(completionAt(`${typed}C`, typed.length + 1, ctx).from, at);
  assert.equal(completionAt(`${typed}Co`, typed.length + 2, ctx).from, at);
  assert.equal(completionAt('ask @c', 6, window(manager, [host])).from, 4, 'a tag’s list too');
  assert.equal(completionAt('/re', 3, ctx).from, undefined, 'a command starts the message: its list, the box');
});

test('in a group, @ lists the agents in it as before, and only them where nobody is overseen', () => {
  const plain = { id: 'p', name: 'Claude', project: 'shop', status: 'online' };
  const group = [participant('p', 'Claude'), codex];
  const ctx = window(plain, group, [plain, ...contacts]);
  assert.deepEqual(offered('@', ctx), ['Claude', 'Codex']);
  assert.deepEqual(offered('@co', ctx), ['Codex']);
  assert.deepEqual(nameable(ctx), { mentionable: group, manager: null, held: null, tags: [] });
});

test('a manager’s conversation with guests lists the agents first, then the conversations it oversees', () => {
  const ctx = window(manager, [host, codex]);
  assert.deepEqual(offered('@', ctx), ['shop manager', 'Codex', 'Claude (tags)', 'Claude (cart)']);
  const { mentionable, tags: tagged } = nameable(ctx);
  assert.deepEqual(
    mentionable.map(({ id }) => id),
    ['m', 'x'],
    'the agents are mentioned: a mention says who answers'
  );
  assert.deepEqual(
    tagged.map(({ id }) => id),
    ['tags', 'cart'],
    'the conversations are tagged'
  );
  // Who answers is told from the agents alone, as in any group: a tag picks nobody.
  assert.deepEqual(mentions('@Codex look at @Claude (cart)', ctx.participants), ['x']);
  assert.deepEqual(mentions('@Claude (cart) how is it going?', ctx.participants), []);
});

// ---- tags marked in what you sent --------------------------------------------------------------------------------

const team = [tags, cart];
const marked = (text, participants, tagged = team) =>
  sentMarks(text, participants, tagged).map(({ start, end, link, file, tag }) => [
    text.slice(start, end),
    link ? 'link' : (file ?? (tag ? `tag:${tag}` : 'mention')),
  ]);

test('a conversation you tag in a manager’s conversation is marked as a tag, to click', () => {
  assert.deepEqual(marked('how is @Claude (cart) doing?', [host]), [['@Claude (cart)', 'tag:cart']]);
  assert.deepEqual(marked('compare @claude (cart) with @Claude (tags)', [host]), [
    ['@claude (cart)', 'tag:cart'],
    ['@Claude (tags)', 'tag:tags'],
  ]);
  assert.deepEqual(marked('/review @Claude (cart)', [host]), [], 'a slash command is the host’s, whatever it names');
  assert.deepEqual(marked('https://a.dev/@Claude (cart)', [host]), [['https://a.dev/@Claude', 'link']]);
  assert.deepEqual(marked('@Claude (cart) read @src/cart.js', [host]), [
    ['@Claude (cart)', 'tag:cart'],
    ['@src/cart.js', 'src/cart.js'],
  ]);
  assert.deepEqual(marked('how is @Claude (cart) doing?', [host], []), [], 'with nothing to tag, nothing is marked');
});

test('with guests, the agents are marked as mentions and the conversations as tags', () => {
  assert.deepEqual(marked('@Codex please look at @Claude (cart)', [host, codex]), [
    ['@Codex', 'mention'],
    ['@Claude (cart)', 'tag:cart'],
  ]);
  // A mention says who answers: where it and a tag start alike, the message mentions that agent.
  const claude = participant('c', 'Claude');
  assert.deepEqual(marked('@Claude (cart) is done', [host, claude]), [['@Claude', 'mention']]);
});

test('in a group that is no manager’s, mentions are marked as before, and nothing is a tag', () => {
  const plain = { id: 'p', name: 'Claude', project: 'shop', status: 'online' };
  const group = [participant('p', 'Claude'), codex];
  const none = taggable(plain, [plain, ...contacts], group);
  assert.deepEqual(marked('@Codex can you review what @Claude (cart) did?', group, none), [
    ['@Codex', 'mention'],
    ['@Claude', 'mention'],
  ]);
  assert.deepEqual(marked('/review @Codex', group, none), []);
});

// ---- tags marked in a reply ----------------------------------------------------------------------------------------

/** A piece of a rendered reply's text, inside an element that is or is not code, a link or a file. */
class FakeText {
  constructor(nodeValue, inside = null) {
    this.nodeValue = nodeValue;
    this.parentElement = { closest: (selector) => (selector.split(/,\s*/).includes(inside) ? {} : null) };
    this.replaced = null;
  }

  replaceWith(...parts) {
    this.replaced = parts;
  }
}

const saved = {};
const GLOBALS = ['document', 'NodeFilter'];

beforeEach(() => {
  for (const name of GLOBALS) saved[name] = globalThis[name];
  globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
  globalThis.document = {
    // Each piece of text the reply has, but those the filter turns down.
    createTreeWalker: (root, _show, { acceptNode }) => {
      const nodes = root.nodes.filter((node) => acceptNode(node) === globalThis.NodeFilter.FILTER_ACCEPT);
      let at = -1;
      return {
        nextNode() {
          this.currentNode = nodes[++at] ?? null;
          return this.currentNode;
        },
      };
    },
    createElement: (tag) => ({
      tag,
      dataset: {},
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value;
      },
    }),
  };
});

afterEach(() => {
  for (const name of GLOBALS) {
    if (saved[name] === undefined) delete globalThis[name];
    else globalThis[name] = saved[name];
  }
});

test('the conversations a manager names in its reply become tags, to click', () => {
  const said = new FakeText('@Claude (cart) follows the design. Ask @claude (tags) too.');
  markTags({ nodes: [said] }, team);
  const [first, between, second, after] = said.replaced;
  assert.deepEqual(
    [first.textContent, first.className, first.dataset.tag, first.title],
    ['@Claude (cart)', TAG_CLASS, 'cart', 'Show Claude (cart)’s conversation']
  );
  assert.equal(first.attributes.role, 'link');
  assert.equal(first.tabIndex, 0, 'Tab gets to it, and Enter opens it');
  assert.equal(between, ' follows the design. Ask ');
  assert.deepEqual([second.textContent, second.dataset.tag], ['@claude (tags)', 'tags']);
  assert.equal(after, ' too.');
});

test('a reply’s code, links and files are left as they are, and so is text that tags nothing', () => {
  const code = new FakeText('@Claude (cart)', 'code');
  const link = new FakeText('@Claude (cart)', 'a');
  const file = new FakeText('@Claude (cart)', '.file-mention');
  const plain = new FakeText('Nobody is tagged here, not even @Claude (blog).');
  markTags({ nodes: [code, link, file, plain] }, team);
  assert.deepEqual(
    [code, link, file, plain].map((node) => node.replaced),
    [null, null, null, null]
  );
  const anywhere = new FakeText('@Claude (cart)');
  markTags({ nodes: [anywhere] }, []);
  assert.equal(anywhere.replaced, null, 'with nobody to tag, the reply is not even read');
});

// ---- a click on a tag -----------------------------------------------------------------------------------------------

/** A pane that hands what it is told to listen for to the test, and a tag or anything else in it to click. */
function paneWithListeners() {
  const listeners = [];
  return {
    addEventListener: (type, listener) => listeners.push({ type, listener }),
    fire(type, target, more = {}) {
      let prevented = false;
      const e = { type, target, preventDefault: () => (prevented = true), ...more };
      for (const one of listeners) if (one.type === type) one.listener(e);
      return prevented;
    },
  };
}
const tagged = (id) => ({ closest: (selector) => (selector === `.${TAG_CLASS}` ? { dataset: { tag: id } } : null) });
const elsewhere = { closest: () => null };

test('a click on a tag shows that conversation, and so does Enter on one', () => {
  const opened = [];
  const pane = paneWithListeners();
  new Conversation(pane, { participants: [host] }, { openTag: (id) => opened.push(id) });
  assert.equal(pane.fire('click', tagged('cart')), true);
  assert.equal(pane.fire('keydown', tagged('tags'), { key: 'Enter' }), true);
  assert.equal(pane.fire('keydown', tagged('tags'), { key: 'a' }), false, 'another key does nothing');
  assert.equal(pane.fire('click', elsewhere), false, 'nor a click anywhere else');
  assert.deepEqual(opened, ['cart', 'tags']);
});

test('the message history opens no tag, clicked or with Enter: it marks none', () => {
  const pane = paneWithListeners();
  new Conversation(pane, { participants: [host] });
  assert.equal(pane.fire('click', tagged('cart')), false);
  assert.equal(pane.fire('keydown', tagged('cart'), { key: 'Enter' }), false);
});

// ---- a worker's manager, tagged from the worker's conversation (see manager-tag.js) -----------------------------

/** A worker under the shop's manager, as the contact list has it: `managedBy` is kept, `overseenBy` while it is at work. */
const underManager = (more = {}) => worker('cart', { managedBy: 'm', ...more });

test('in a worker’s conversation, @ offers its manager first, as a Manager, above the files', () => {
  const ctx = window(underManager(), [participant('cart', 'Claude (cart)')]);
  const found = completionAt('@', 1, ctx);
  const [row] = found.items;
  assert.equal(row.label, 'shop manager');
  assert.equal(row.hint, 'Manager');
  assert.equal(row.disabled, false);
  assert.equal(row.ariaLabel, 'shop manager, the manager over this conversation');
  assert.match(row.icon, /data-lead/, 'its buddy wears the star, as in the contact list');
  assert.deepEqual(row.complete('@', 1), { text: '@shop manager ', caret: 14 });
  assert.deepEqual(offered('ask @sh', ctx), ['shop manager']);
  assert.equal(offered('@shop manager', ctx), null, 'typed in full: Enter sends it');
  assert.deepEqual(nameable(ctx).manager, manager);
});

test('in a group under a manager, the manager comes first, then the agents', () => {
  const ctx = window(underManager(), [participant('cart', 'Claude (cart)'), codex]);
  assert.deepEqual(offered('@', ctx), ['shop manager', 'Claude (cart)', 'Codex']);
});

test('a manager turned off, put away or with its folder gone is greyed out in @, and says why', () => {
  const said = (who, typed = '@s') =>
    completionAt(
      typed,
      typed.length,
      window(
        underManager({ overseenBy: null }),
        [participant('cart', 'Claude (cart)')],
        [who, underManager({ overseenBy: null })]
      )
    )?.items[0];
  const off = said({ ...manager, oversees: false });
  assert.deepEqual([off.label, off.hint, off.disabled], ['shop manager', 'Turned off', true]);
  assert.equal(
    off.ariaLabel,
    'shop manager, the manager over this conversation, is turned off: it can’t be asked here'
  );
  assert.equal(off.complete, undefined, 'never written in');
  assert.equal(said({ ...manager, archived: true, oversees: false }).hint, 'Put away');
  assert.equal(said({ ...manager, status: 'offline' }).hint, 'Folder gone');
  assert.equal(said({ ...manager, oversees: false }, 'see @z'), undefined, 'only once its name is begun');
});

test('a worker under no manager, a manager itself, or a project manager’s conversation offers no manager to tag', () => {
  const loose = worker('loose', { overseenBy: null });
  assert.equal(nameable(window(loose, [participant('loose', 'Claude (loose)')])).manager, null);
  assert.equal(nameable(window(manager, [host])).manager, null);
  const lead = { id: 'pm', name: 'shop project manager', manages: KEY, leads: true, oversees: true, status: 'online' };
  const underLead = worker('x', { overseenBy: null, managedBy: 'pm' });
  assert.equal(nameable(window(underLead, [participant('x', 'Claude (x)')], [lead, underLead])).held, null);
});

test('a message you sent that tags the manager marks it, even with one agent here; a quote doesn’t', () => {
  const tagged = '@shop manager subtotal?';
  assert.deepEqual(sentMarks(tagged, [participant('cart', 'Claude (cart)')], [], [manager]), [
    { start: 0, end: 13, id: 'm' },
  ]);
  assert.deepEqual(sentMarks(tagged, [participant('cart', 'Claude (cart)')]), [], 'with no manager here, nothing');
});
