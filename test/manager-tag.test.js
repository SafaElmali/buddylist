// A worker's manager, tagged in the worker's conversation: who the window says it is, and how its answer is drawn
// there (see renderer/chat/manager-tag.js and Conversation#addAssistant).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import DOMPurify from '../node_modules/dompurify/dist/purify.es.mjs';
import { Conversation } from '../src/renderer/chat/conversation.js';
import { managerRow, tagManagerOf } from '../src/renderer/chat/manager-tag.js';
import { page } from './fixtures/dom.js';

// Markdown is drawn as the window draws it; what the sanitizer keeps has its own tests (markdown.test.js).
const sanitize = DOMPurify.sanitize;
DOMPurify.sanitize = (markup) => markup;
globalThis.NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
after(() => {
  DOMPurify.sanitize = sanitize;
  delete globalThis.NodeFilter;
});

const KEY = 'git:/w/shop/.git';
const manager = { id: 'boss', name: 'shop manager', manages: KEY, oversees: true, status: 'online', avatar: 'claude' };
const cart = { id: 'cart', name: 'Claude (cart)', status: 'online', managedBy: 'boss', overseenBy: 'boss' };

test('the manager a worker can tag is the one it is under, or its chat tab’s conversation is', () => {
  assert.deepEqual(tagManagerOf(cart, [manager, cart]), { manager, why: null });
  const tab = { id: 'tab', name: 'Claude (cart) 2', tabOf: 'cart', overseenBy: 'boss' };
  assert.deepEqual(tagManagerOf(tab, [manager, cart, tab]), { manager, why: null });
  const offTab = { ...tab, overseenBy: null };
  const off = { ...manager, oversees: false };
  assert.deepEqual(tagManagerOf(offTab, [off, { ...cart, overseenBy: null }, offTab]), { manager: off, why: 'off' });
});

test('nobody to tag for a manager, a guest, a conversation put away or under none, or under a project manager', () => {
  assert.equal(tagManagerOf(manager, [manager]), null);
  assert.equal(tagManagerOf({ ...cart, guestOf: 'x' }, [manager]), null);
  assert.equal(tagManagerOf({ ...cart, archived: true }, [manager]), null);
  assert.equal(tagManagerOf({ ...cart, managedBy: null, overseenBy: null }, [manager]), null);
  const lead = { ...manager, id: 'pm', leads: true };
  assert.equal(tagManagerOf({ ...cart, managedBy: 'pm', overseenBy: null }, [lead]), null);
  assert.equal(tagManagerOf(null, [manager]), null, 'the message history shows no contact');
});

test('why a manager can’t be asked: turned off, put away, or its folder gone', () => {
  const why = (more) => tagManagerOf({ ...cart, overseenBy: null }, [{ ...manager, ...more }]).why;
  assert.equal(why({ oversees: false }), 'off');
  assert.equal(why({ archived: true, oversees: false }), 'put-away');
  assert.equal(why({ status: 'offline' }), 'gone');
  assert.deepEqual(managerRow({ manager, why: 'gone' }), {
    hint: 'Folder gone',
    disabled: true,
    ariaLabel:
      'shop manager, the manager over this conversation, can’t start: its project’s folder is gone: it can’t be asked here',
    title: 'shop manager can’t start: its project’s folder is gone, so it can’t be asked here.',
  });
});

/** A worker's conversation window, drawn into a page. */
function window(t, opened = []) {
  const document = page(t);
  document.createTreeWalker = () => ({ nextNode: () => false });
  const root = document.createElement('div');
  document.body.append(root);
  const conversation = new Conversation(
    root,
    {
      contact: cart,
      contacts: [manager, cart],
      participants: [{ id: 'cart', name: 'Claude (cart)' }],
      profile: { name: 'Alex' },
    },
    { openTag: (id) => opened.push(id) }
  );
  return { root, conversation };
}

test('the manager’s answer is drawn under its name and picture, with where it came from and a link to it', (t) => {
  const opened = [];
  const { root, conversation } = window(t, opened);
  conversation.addAssistant({
    id: 'r1',
    text: 'On the subtotal.',
    speaker: 'boss',
    speakerName: 'shop manager',
    managerAnswer: true,
  });
  const [reply] = root.querySelectorAll('.msg.them');
  assert.equal(reply.querySelector('.msg-name').textContent, 'shop manager');
  assert.ok(!reply.querySelector('.msg-initial'), 'its picture, not an initial');
  const from = reply.querySelector('.answered-from');
  assert.equal(from.textContent.replace(/\s+/g, ' ').trim(), 'Answered from its own conversation. Open it');
  from.querySelector('button').fire('click');
  assert.deepEqual(opened, ['boss'], 'Open it shows the manager’s conversation here');
  conversation.addAssistant({ id: 'r2', text: 'A reply of its own.' });
  assert.equal(root.querySelectorAll('.answered-from').length, 1, 'only the manager’s answer says so');
});

test('your message that tags the manager marks it, as a mention', (t) => {
  const { root, conversation } = window(t);
  conversation.addUser({ text: '@shop manager subtotal?' });
  const mark = root.querySelector('.msg.me .mention');
  assert.equal(mark?.textContent, '@shop manager');
});
