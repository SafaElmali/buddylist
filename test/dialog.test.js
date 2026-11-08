import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmDialog, formDialog, openDialog } from '../src/renderer/lib/dialog.js';

/** The parts a dialog puts in the page; keyboard events use the real EventTarget. */
class Element extends EventTarget {
  parts = new Map();
  removed = false;
  children = [];

  querySelector(selector) {
    if (!this.parts.has(selector)) this.parts.set(selector, new Element());
    return this.parts.get(selector);
  }

  appendChild(child) {
    this.children.push(child);
  }
  focus() {}
  setAttribute() {}
  cloneNode() {
    return new Element();
  }
  replaceWith() {}
  remove() {
    this.removed = true;
  }
}

/**
 * A page for dialogs to open in, until the test is over.
 * @returns {EventTarget & { closeLater: (dialog: { close: (value: any) => void }) => void }}  `closeLater`: a
 *   dialog left open is closed before the page goes
 */
function page(t) {
  const previous = globalThis.document;
  const document = new EventTarget();
  const open = [];
  document.body = new Element();
  document.createElement = () => ({ content: { firstElementChild: new Element() } });
  document.closeLater = (dialog) => open.push(dialog);
  globalThis.document = document;
  t.after(() => {
    for (const dialog of open) dialog.close(null);
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  return document;
}

const escape = (isComposing = false) =>
  Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape', isComposing });

for (const [choice, confirmed] of [
  [0, true],
  [1, false],
  ['escape', false],
]) {
  test(`a destructive confirmation waits for ${choice} before returning ${confirmed}`, async (t) => {
    const document = page(t);
    let answered = false;
    const result = confirmDialog('Remove this project?', { ok: 'Remove' });
    result.then(() => (answered = true));
    await Promise.resolve();
    assert.equal(answered, false, 'opening the confirmation does not perform the action');
    const modal = document.body.children.at(-1);
    if (choice === 'escape') document.dispatchEvent(escape());
    else modal.querySelector('.buttons').children[choice].dispatchEvent(new Event('click'));
    assert.equal(await result, confirmed);
    assert.equal(modal.removed, true);
  });
}

test('Escape while an input method is composing keeps the dialog and its answer open', async (t) => {
  const document = page(t);
  const dialog = openDialog({ title: 'Create a Group', body: new Element(), buttons: [] });
  document.closeLater(dialog);
  let answered = false;
  dialog.result.then(() => (answered = true));

  const composing = escape(true);
  document.dispatchEvent(composing);
  await Promise.resolve();
  assert.equal(dialog.node.removed, false);
  assert.equal(answered, false);
  assert.equal(composing.defaultPrevented, false, 'the input method gets Escape');

  const ordinary = escape();
  document.dispatchEvent(ordinary);
  assert.equal(await dialog.result, null);
  assert.equal(dialog.node.removed, true);
  assert.equal(ordinary.defaultPrevented, true);
});

/** A form whose OK waits for `finish`; `signal` is the one its save was given. */
function slowForm(t) {
  const document = page(t);
  const form = new Element();
  const saving = {};
  const result = formDialog({
    title: 'Add a Contact',
    form,
    save: (signal) =>
      new Promise((resolve) => {
        saving.signal = signal;
        saving.finish = resolve;
      }),
  });
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  return { document, result, saving };
}

test('a form closed while its OK is at work calls off what the save started', async (t) => {
  const { document, result, saving } = slowForm(t);
  assert.equal(saving.signal.aborted, false);
  document.dispatchEvent(escape());
  assert.equal(await result, null);
  assert.equal(saving.signal.aborted, true);
  saving.finish({ id: 'late' });
});

test('a save that is done is not called off when it closes the form', async (t) => {
  const { result, saving } = slowForm(t);
  saving.finish({ id: 'added' });
  assert.deepEqual(await result, { id: 'added' });
  await Promise.resolve();
  assert.equal(saving.signal.aborted, false);
});

test('an owning flow can cancel a form and abort its pending save', async (t) => {
  const document = page(t);
  const form = new Element();
  const lifetime = new AbortController();
  let saving;
  let calls = 0;
  const result = formDialog({
    title: 'Add manager',
    form,
    signal: lifetime.signal,
    save: (signal) => {
      saving = signal;
      calls++;
      return new Promise(() => {});
    },
  });
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  assert.equal(calls, 1);
  lifetime.abort();
  assert.equal(await result, null);
  assert.equal(saving.aborted, true);
  assert.equal(document.body.children.at(-1).removed, true);
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  assert.equal(calls, 1);
});

test('an already cancelled flow never opens a form', async (t) => {
  const document = page(t);
  const lifetime = new AbortController();
  lifetime.abort();
  assert.equal(
    await formDialog({
      title: 'Add contact',
      form: new Element(),
      signal: lifetime.signal,
      save: () => assert.fail('A cancelled form must not save'),
    }),
    null
  );
  assert.equal(document.body.children.length, 0);
});

test('the second click after a nested dialog closes cannot dismiss the parent draft', async (t) => {
  const document = page(t);
  const parent = openDialog({ title: 'Add contact', body: new Element(), buttons: [] });
  document.closeLater(parent);
  const child = openDialog({ title: 'Add manager', body: new Element(), buttons: [] });
  child.close('manager');
  parent.node.dispatchEvent(Object.assign(new Event('mousedown'), { detail: 2 }));
  assert.equal(parent.node.removed, false, 'the remaining draft stays open');
  parent.node.dispatchEvent(Object.assign(new Event('mousedown'), { detail: 1 }));
  assert.equal(await parent.result, null, 'a separate outside click still cancels');
});
