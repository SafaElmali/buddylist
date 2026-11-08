import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  continueButton,
  newBranchItems,
  newBranchNotice,
  newBranchQuestion,
  nextStepButtons,
  offersNewBranch,
} from '../src/shared/new-branch.js';

const pr = (fields = {}) => ({
  number: 12,
  url: 'https://github.com/acme/shop/pull/12',
  title: 'Add a hover card',
  state: 'merged',
  ...fields,
});
const contact = (fields = {}) => ({ id: 'c1', name: 'Claude', status: 'online', pullRequest: pr(), ...fields });

// ---- who is offered one --------------------------------------------------------------------------

test('a contact whose pull request is merged or closed is offered its next branch', () => {
  for (const state of ['merged', 'closed'])
    assert.equal(offersNewBranch(contact({ pullRequest: pr({ state }) })), true);
});

test('one whose pull request is still to be merged goes on where it is', () => {
  for (const state of ['open', 'draft']) assert.equal(offersNewBranch(contact({ pullRequest: pr({ state }) })), false);
});

test('without a pull request, or before GitHub has said anything, there is nothing to move on from', () => {
  assert.equal(offersNewBranch(contact({ pullRequest: null })), false);
  assert.equal(offersNewBranch(contact({ pullRequest: undefined })), false);
  assert.equal(offersNewBranch(null), false);
  assert.equal(offersNewBranch(undefined), false);
});

test('an archived contact, and one whose folder is gone, have no branch to start', () => {
  assert.equal(offersNewBranch(contact({ archived: true })), false);
  assert.equal(offersNewBranch(contact({ status: 'offline' })), false);
});

// ---- its entry in the menus ----------------------------------------------------------------------

test('the entry starts the branch for the contact the menu was opened on', () => {
  const started = [];
  const items = newBranchItems(contact(), (who) => started.push(who.id));
  assert.deepEqual(
    items.map(({ label, disabled }) => [label, disabled]),
    [['Start new branch', false]]
  );
  items[0].action();
  assert.deepEqual(started, ['c1']);
});

test('a contact that is not offered a new branch has no entry for it', () => {
  const never = () => assert.fail('nothing to choose');
  assert.deepEqual(newBranchItems(contact({ pullRequest: pr({ state: 'open' }) }), never), []);
  assert.deepEqual(newBranchItems(contact({ pullRequest: null }), never), []);
  assert.deepEqual(newBranchItems(contact({ archived: true }), never), []);
  assert.deepEqual(newBranchItems(null, never), []);
});

test('a contact in the middle of something waits: the branch is not changed under its hands', () => {
  for (const status of ['busy', 'away']) {
    const [item] = newBranchItems(contact({ status }), () => {});
    assert.deepEqual([item.label, item.disabled], ['Start new branch', true], status);
  }
});

// ---- the Continue button -------------------------------------------------------------------------

test('a contact that is offered a new branch gets a Continue button', () => {
  const button = continueButton(contact());
  assert.deepEqual([button.label, button.disabled], ['Continue', false]);
});

test('pointing at it says what continuing means, in one line: where it goes on, and what comes along', () => {
  for (const state of ['merged', 'closed']) {
    const { tip } = continueButton(contact({ pullRequest: pr({ state }) }));
    assert.equal(tip, 'Continue on a new branch with the same conversation', state);
  }
});

test('the line is short enough to read at a glance, and is no native tooltip', () => {
  const button = continueButton(contact());
  assert.ok(button.tip.length <= 60);
  assert.doesNotMatch(button.tip, /\n/);
  assert.equal('title' in button, false, "a title would show a second tooltip of the system's own");
});

test('nobody else gets one', () => {
  for (const state of ['open', 'draft']) assert.equal(continueButton(contact({ pullRequest: pr({ state }) })), null);
  assert.equal(continueButton(contact({ pullRequest: null })), null);
  assert.equal(continueButton(contact({ archived: true })), null);
  assert.equal(continueButton(contact({ status: 'offline' })), null);
  assert.equal(continueButton(null), null);
});

test('while the contact is in the middle of something the button waits, and says why', () => {
  for (const status of ['busy', 'away']) {
    const button = continueButton(contact({ status }));
    assert.deepEqual([button.label, button.disabled], ['Continue', true], status);
    assert.equal(button.tip, 'Continue on a new branch, once it is done with what it is doing');
  }
});

// ---- the two things to do next, on the contact's row ----------------------------------------------

test('after a pull request that is over a row offers every way on: Continue, then Archive, then Delete', () => {
  const buttons = nextStepButtons(contact());
  assert.deepEqual(
    buttons.map(({ id, label, disabled }) => [id, label, disabled]),
    [
      ['continue', 'Continue', false],
      ['archive', 'Archive', false],
      ['delete', 'Delete', false],
    ]
  );
  assert.equal(buttons[0].tip, continueButton(contact()).tip, 'the same Continue as in the toolbar');
});

test('pointing at Archive says what archiving means: that it is put away, and that nothing is lost', () => {
  const [, archive] = nextStepButtons(contact());
  assert.equal(archive.tip, 'Put this contact away. Nothing is deleted, and it can be restored');
  assert.equal('title' in archive, false);
});

test('pointing at Delete says that it asks first, and that the folder is only gone if you say so', () => {
  const [, , remove] = nextStepButtons(contact());
  assert.equal(remove.tip, 'Delete this contact. It asks first, and its folder stays unless you say so');
  assert.equal('title' in remove, false);
});

test('a contact in the middle of something can still be archived or deleted: both ask first, as they always do', () => {
  for (const status of ['busy', 'away']) {
    const buttons = nextStepButtons(contact({ status }));
    assert.deepEqual(
      buttons.map(({ id, disabled }) => [id, disabled]),
      [
        ['continue', true],
        ['archive', false],
        ['delete', false],
      ],
      status
    );
  }
});

test('a contact that is not offered a new branch has none of the buttons', () => {
  assert.deepEqual(nextStepButtons(contact({ pullRequest: pr({ state: 'open' }) })), []);
  assert.deepEqual(nextStepButtons(contact({ pullRequest: null })), []);
  assert.deepEqual(nextStepButtons(contact({ archived: true })), []);
  assert.deepEqual(nextStepButtons(contact({ status: 'offline' })), []);
  assert.deepEqual(nextStepButtons(null), []);
});

// ---- what is asked first, and said afterwards ----------------------------------------------------

test('the question says why, what moves and what is kept', () => {
  const text = newBranchQuestion('Claude', pr());
  assert.match(text, /^Start a new branch for Claude\?\n\n/);
  assert.match(text, /Pull request #12 is merged\./);
  assert.match(text, /main branch as it is now/);
  assert.match(text, /The branch it is on is kept, and so is the conversation\./);
  assert.match(newBranchQuestion('Codex', pr({ number: 7, state: 'closed' })), /Pull request #7 is closed\./);
});

test('the conversation says which branch was started, from where, and which one was kept', () => {
  assert.equal(
    newBranchNotice({ branch: 'safa/shop-3', from: 'safa/fix-login', base: 'origin/main' }),
    'Started a new branch, safa/shop-3, from origin/main. The branch safa/fix-login is kept as it was.'
  );
});

test('a folder that was on no branch left none behind', () => {
  assert.equal(
    newBranchNotice({ branch: 'shop-3', from: null, base: 'origin/main' }),
    'Started a new branch, shop-3, from origin/main.'
  );
});
