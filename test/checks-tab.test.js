import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Checks, checkMessage, checksMessage } from '../src/renderer/chat/checks.js';
import { page } from './fixtures/dom.js';

const OWN = { url: 'https://github.com/acme/shop/pull/34353', number: 34353, title: 'Show totals on the receipt' };
const STACKED = { url: 'https://github.com/acme/shop/pull/34352', number: 34352, title: 'Round totals per currency' };
const FAILED = {
  name: 'test',
  workflow: 'CI',
  standing: 'fail',
  url: 'https://github.com/acme/shop/actions/runs/7/job/70',
  reason: ['Run tests: src/cart/round.js:42: expected 10.05, got 10.04'],
};
const PASSED = { name: 'lint', workflow: 'CI', standing: 'pass', url: '', run: '' };

/** A pane that only notes what is opened in it. */
const pane = () => ({
  opened: [],
  open(tab) {
    this.opened.push(tab.id);
  },
  shows: () => true,
  selected: 'checks',
});

/** The tab, with a gh that lists `checks` for whichever pull request it is asked about, noting each ask. */
function tab(t, { checks = [FAILED, PASSED], list } = {}) {
  page(t);
  const asked = [];
  const reruns = [];
  const sent = [];
  const view = new Checks(
    pane(),
    { contactId: 'c', contact: { pullRequest: OWN } },
    {
      list:
        list ??
        (async (contactId, url) => {
          asked.push([contactId, url]);
          return { pullRequest: true, checks: checks.map((check) => ({ ...check })), url: url ?? OWN.url };
        }),
      rerun: async (contactId, url) => reruns.push([contactId, url]),
      open() {},
      send: async (text) => (sent.push(text), true),
    }
  );
  return { view, asked, reruns, sent };
}
const text = (node) => node?.textContent.replace(/\s+/g, ' ').trim() ?? null;

test('the tab names the pull request its checks are of, with its title, as the contact list shows it', async (t) => {
  const { view, asked } = tab(t);
  view.show();
  await view.refresh();
  assert.deepEqual(asked.at(-1), ['c', undefined], 'the conversation’s own, as main knows it');
  assert.equal(text(view.body.querySelector('.checks-pr-number')), '#34353');
  assert.equal(view.body.querySelector('.checks-pr-number').getAttribute('href'), OWN.url);
  assert.equal(text(view.body.querySelector('.checks-pr-title')), 'Show totals on the receipt');
  assert.equal(view.body.querySelector('.checks-own'), null, 'its own has no way back to itself');
  assert.equal(text(view.body.querySelector('.checks-summary > span')), '1 failed, 1 passed');
});

test('checks asked about by the branch, which names no pull request, are listed without a name', async (t) => {
  const { view } = tab(t, { list: async () => ({ pullRequest: true, checks: [PASSED] }) });
  await view.refresh();
  assert.equal(view.body.querySelector('.checks-pr'), null);
  assert.equal(text(view.body.querySelector('.checks-summary > span')), '1 passed');
});

test('a failing PR clicked in the stack shows its checks, named, with a way back to the conversation’s own', async (t) => {
  const { view, asked, reruns, sent } = tab(t);
  view.show(STACKED);
  await view.refresh();
  assert.deepEqual(asked.at(-1), ['c', STACKED.url]);
  assert.equal(text(view.body.querySelector('.checks-pr-number')), '#34352');
  assert.equal(text(view.body.querySelector('.checks-pr-title')), 'Round totals per currency');
  assert.equal(text(view.body.querySelector('.checks-own')), 'Back to #34353');

  // Handed to the conversation, the message says which pull request of the stack it failed on.
  await view.send([FAILED]);
  assert.match(sent[0], /^A check failed on pull request #34352 of this branch's stack: CI \/ test\n/);

  // Re-run failed starts over that one's runs.
  await view.rerun();
  assert.deepEqual(reruns, [['c', STACKED.url]]);

  view.body.querySelector('.checks-own').click();
  await view.refresh();
  assert.deepEqual(asked.at(-1), ['c', undefined]);
  assert.equal(text(view.body.querySelector('.checks-pr-number')), '#34353');
  assert.equal(view.body.querySelector('.checks-own'), null);
});

test('an answer about a pull request asked for before another is not shown over the newer one', async (t) => {
  const waiting = [];
  const { view } = tab(t, {
    list: (_contactId, url) =>
      new Promise((resolve) =>
        waiting.push(() => resolve({ pullRequest: true, checks: [url ? FAILED : PASSED], url: url ?? OWN.url }))
      ),
  });
  view.show(STACKED);
  view.show();
  assert.equal(waiting.length, 2);
  // The conversation's own answers first, the stacked one asked for before it after.
  waiting[1]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  waiting[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(text(view.body.querySelector('.checks-pr-number')), '#34353');
  assert.equal(text(view.body.querySelector('.checks-summary > span')), '1 passed');
  assert.equal(view.body.classList.contains('asking'), false);
});

test('a failed check of another pull request of the stack is handed over by its number', () => {
  assert.equal(
    checkMessage({ ...FAILED, reason: [], url: '' }, { stacked: 34352 }),
    "A check failed on pull request #34352 of this branch's stack: CI / test\n\nFind out why it failed, and fix it."
  );
  assert.match(
    checksMessage([FAILED, { ...FAILED, name: 'e2e' }], { stacked: 34352, to: 'Claude' }),
    /^@Claude 2 checks failed on pull request #34352 of this branch's stack:\n/
  );
  assert.match(checkMessage(FAILED), /^A check failed on this branch's pull request: /, 'its own, as before');
});
