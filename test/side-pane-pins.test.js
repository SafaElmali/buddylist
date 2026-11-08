import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SidePane } from '../src/renderer/chat/side-pane.js';
import { Plans } from '../src/renderer/chat/plans.js';
import { el } from '../src/renderer/lib/dom.js';
import { Element, page } from './fixtures/dom.js';

// The shared DOM fixture has no layout, native button activation or observers.
// These stubs only supply the browser surfaces needed to exercise SidePane itself.
function paneFor(t) {
  const document = page(t);
  const globals = {
    window: { addEventListener() {} },
    getComputedStyle: () => ({ width: '0', minWidth: '0' }),
    ResizeObserver: class {
      observe() {}
    },
    MutationObserver: class {
      observe() {}
    },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  const previous = Object.fromEntries(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  const after = Element.prototype.after;
  Element.prototype.after = function (...nodes) {
    if (this.nextElementSibling) this.nextElementSibling.before(...nodes);
    else this.parentElement.append(...nodes);
  };
  t.after(() => {
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
    if (after) Element.prototype.after = after;
    else delete Element.prototype.after;
  });
  const main = el('<main></main>');
  const beside = el('<div class="conversation"></div>');
  const root = el('<aside hidden></aside>');
  main.append(beside, root);
  document.body.append(main);
  const opened = [];
  const reorders = [];
  const pane = new SidePane(root, {
    beside,
    room: async () => {},
    opened: (id) => opened.push(id),
    reordered: (ids) => reorders.push(ids),
  });
  return { pane, document, root, opened, reorders };
}

const tab = (id, more = {}) => ({ id, title: id, body: el('<div></div>'), icon: '', ...more });
const ids = (pane) => pane.tabs.map((tab) => tab.id);
const node = (pane, id) => pane.root.querySelector(`.pane-tab[data-id="${id}"]`);
const state = (tabs, more = {}) => ({ tabs, upper: null, lower: null, folded: false, full: false, ...more });
/** The tabs of a half, as its strip draws them. */
const strip = (pane, half = 'upper') =>
  pane.halves[half].strip.querySelectorAll('.pane-tab').map((tab) => tab.dataset.id);

test('pinning a tab moves it to the front, after the tabs pinned before it, and unpinning to just after them', (t) => {
  const { pane, reorders } = paneFor(t);
  for (const id of ['files', 'changes', 'checks', 'pr-stack', 'file:notes.md']) pane.open(tab(id));
  pane.select('changes');
  pane.pin('checks');
  assert.deepEqual(ids(pane), ['checks', 'files', 'changes', 'pr-stack', 'file:notes.md']);
  pane.pin('file:notes.md');
  assert.deepEqual(ids(pane), ['checks', 'file:notes.md', 'files', 'changes', 'pr-stack']);
  pane.pin('pr-stack');
  assert.deepEqual(ids(pane), ['checks', 'file:notes.md', 'pr-stack', 'files', 'changes']);
  pane.pin('checks');
  assert.deepEqual(ids(pane), ['file:notes.md', 'pr-stack', 'checks', 'files', 'changes']);
  assert.deepEqual(strip(pane), ids(pane), 'the strip is drawn in the new order');
  assert.equal(pane.selected, 'changes', 'pinning another tab does not choose it');
  assert.deepEqual(
    pane.state.tabs.filter((tab) => tab.pinned).map((tab) => tab.id),
    ['file:notes.md', 'pr-stack']
  );
  assert.deepEqual(reorders, [
    ['checks', 'files', 'changes', 'pr-stack', 'file:notes.md'],
    ['checks', 'file:notes.md', 'files', 'changes', 'pr-stack'],
    ['checks', 'file:notes.md', 'pr-stack', 'files', 'changes'],
    ['file:notes.md', 'pr-stack', 'checks', 'files', 'changes'],
  ]);
});

test('pinning or unpinning a tab that is already in its place reorders nothing', (t) => {
  const { pane, reorders } = paneFor(t);
  for (const id of ['first', 'second', 'third']) pane.open(tab(id));
  pane.pin('first');
  pane.pin('second');
  pane.pin('second');
  pane.pin('first');
  assert.deepEqual(ids(pane), ['first', 'second', 'third']);
  assert.deepEqual(reorders, []);
});

test('a tab that moves as it is pinned stays the selected one, keeps its focus and is scrolled into sight', (t) => {
  const { pane, document } = paneFor(t);
  const scrolled = [];
  const scrollIntoView = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function () {
    scrolled.push(this.dataset.id);
  };
  t.after(() => {
    Element.prototype.scrollIntoView = scrollIntoView;
  });
  for (const id of ['files', 'changes', 'checks']) pane.open(tab(id));
  const pin = node(pane, 'checks').querySelector('.pane-tab-pin');
  pin.focus();
  scrolled.length = 0;
  pin.click();
  assert.deepEqual(ids(pane), ['checks', 'files', 'changes']);
  assert.deepEqual(strip(pane), ['checks', 'files', 'changes']);
  assert.equal(pane.selected, 'checks');
  assert.equal(document.activeElement, node(pane, 'checks').querySelector('.pane-tab-pin'));
  assert.equal(scrolled.at(-1), 'checks');
  // One that is not the selected tab is brought into sight too, and not chosen, with the row from its start:
  // the tabs pinned before it are in sight beside it.
  scrolled.length = 0;
  pane.halves.upper.strip.scrollLeft = 240;
  pane.pin('changes');
  assert.deepEqual(ids(pane), ['checks', 'changes', 'files']);
  assert.equal(pane.selected, 'checks');
  assert.equal(scrolled.at(-1), 'changes');
  assert.equal(pane.halves.upper.strip.scrollLeft, 0);
  // And the same on the way out of the pins.
  scrolled.length = 0;
  node(pane, 'checks').querySelector('.pane-tab-pin').click();
  assert.deepEqual(ids(pane), ['changes', 'checks', 'files']);
  assert.equal(pane.selected, 'checks');
  assert.equal(scrolled.at(-1), 'checks');
});

test('in the lower half a pinned terminal goes in front of Setup and Run, and the upper half stays as it was', (t) => {
  const { pane, reorders } = paneFor(t);
  pane.keep(tab('script-setup', { lower: true }));
  pane.keep(tab('script-run', { lower: true }));
  pane.open(tab('files'));
  pane.open(tab('terminal-1', { lower: true }));
  pane.open(tab('changes'));
  pane.open(tab('terminal-2', { lower: true }));
  assert.deepEqual(strip(pane, 'lower'), ['script-setup', 'script-run', 'terminal-1', 'terminal-2']);
  pane.pin('terminal-2');
  assert.deepEqual(strip(pane, 'lower'), ['terminal-2', 'script-setup', 'script-run', 'terminal-1']);
  pane.pin('script-run');
  assert.deepEqual(strip(pane, 'lower'), ['terminal-2', 'script-run', 'script-setup', 'terminal-1']);
  pane.pin('terminal-2');
  assert.deepEqual(strip(pane, 'lower'), ['script-run', 'terminal-2', 'script-setup', 'terminal-1']);
  assert.deepEqual(strip(pane), ['files', 'changes']);
  assert.equal(pane.state.lower, 'terminal-2');
  // The terminals are told each new order, as after a drag, to keep it for the window that opens later.
  assert.deepEqual(reorders.at(-1), ids(pane));
  assert.deepEqual(
    reorders.at(-1).filter((id) => id.startsWith('terminal-')),
    ['terminal-2', 'terminal-1']
  );
});

test('tabs that open later go after the pinned ones, also the Setup and Run a new terminal brings back', (t) => {
  const { pane } = paneFor(t);
  pane.keep(tab('script-setup', { lower: true }));
  pane.keep(tab('script-run', { lower: true }));
  pane.open(tab('ended', { lower: true }));
  pane.pin('ended');
  for (const id of ['script-setup', 'script-run', 'ended']) pane.close(id, { unavailable: true });
  assert.deepEqual(ids(pane), ['ended']);
  pane.open(tab('terminal-2', { lower: true }));
  assert.deepEqual(strip(pane, 'lower'), ['ended', 'script-setup', 'script-run', 'terminal-2']);
  pane.open(tab('files'));
  pane.pin('files');
  pane.open(tab('changes'));
  assert.deepEqual(strip(pane), ['files', 'changes']);
});

test('restoring a view saved with pins among the other tabs puts them in front of each half, losing none', async (t) => {
  const { pane } = paneFor(t);
  await pane.restore(
    state(
      [
        { id: 'files' },
        { id: 'checks', pinned: true },
        { id: 'changes' },
        { id: 'file:a.md', pinned: true },
        { id: 'script-setup', lower: true },
        { id: 'terminal', lower: true, pinned: true },
      ],
      { upper: 'changes', lower: 'script-setup' }
    ),
    ({ id, lower }) => pane.open(tab(id, { lower }))
  );
  assert.deepEqual(strip(pane), ['checks', 'file:a.md', 'files', 'changes']);
  assert.deepEqual(strip(pane, 'lower'), ['terminal', 'script-setup']);
  assert.deepEqual(
    pane.state.tabs.filter((tab) => tab.pinned).map((tab) => tab.id),
    ['checks', 'file:a.md', 'terminal']
  );
  assert.equal(pane.selected, 'changes');
  assert.equal(pane.state.lower, 'script-setup');
});

test('pinning an inactive tab preserves selection and survives automatic closure', (t) => {
  const { pane } = paneFor(t);
  const selected = [];
  let closed = 0;
  pane.open(tab('files', { onSelect: () => selected.push('files'), onClose: () => closed++ }));
  pane.open(tab('changes', { onSelect: () => selected.push('changes') }));
  pane.pin('files');
  assert.equal(pane.selected, 'changes');
  assert.deepEqual(ids(pane), ['files', 'changes']);
  assert.equal(node(pane, 'files').getAttribute('aria-label'), 'files, pinned');
  assert.equal(node(pane, 'files').querySelector('.pane-tab-close'), null);
  pane.close('files');
  assert.deepEqual(ids(pane), ['files', 'changes']);
  assert.equal(pane.selected, 'changes');
  assert.equal(closed, 0);
  assert.deepEqual(selected, ['files', 'changes']);
  pane.pin('files');
  pane.close('files');
  assert.deepEqual(ids(pane), ['changes']);
  assert.equal(closed, 0, 'automatic closure does not dispose content as an explicit close does');
});

test('ordinary tab closure still selects the next tab in the same half', (t) => {
  const { pane } = paneFor(t);
  for (const id of ['first', 'middle', 'last']) pane.open(tab(id));
  pane.open(tab('terminal', { lower: true }));
  pane.select('middle');
  pane.close('middle');
  assert.equal(pane.selected, 'last');
  assert.equal(pane.state.lower, 'terminal');
  pane.close('last');
  assert.equal(pane.selected, 'first');
  pane.close('first');
  assert.equal(pane.selected, null);
  assert.equal(pane.state.lower, 'terminal');
});

test('unavailable pinned content becomes a safe placeholder and unpinning removes it', (t) => {
  const { pane } = paneFor(t);
  const body = el('<div><button>Run old action</button></div>');
  const title = '<img src=x onerror=alert(1)>';
  let selected = 0;
  let closed = 0;
  pane.open(
    tab('ended', {
      title,
      body,
      onSelect: () => selected++,
      onClose: () => closed++,
      again: () => ({ file: 'gone.js' }),
    })
  );
  pane.pin('ended');
  pane.close('ended', { unavailable: true });
  const unavailable = pane.tabs[0];
  assert.equal(unavailable.unavailable, true);
  assert.equal(pane.selected, 'ended');
  assert.equal(body.isConnected, false);
  assert.equal(unavailable.body.querySelector('button'), null);
  assert.equal(unavailable.body.querySelector('img'), null);
  assert.ok(unavailable.body.textContent.includes(title));
  assert.equal(pane.state.tabs[0].file, 'gone.js');
  pane.select('ended');
  assert.equal(selected, 1, 'a placeholder cannot invoke the old content callback');
  pane.pin('ended');
  assert.deepEqual(ids(pane), []);
  assert.equal(pane.selected, null);
  assert.equal(closed, 0, 'the removed placeholder cannot invoke the old close callback');
});

test('an explicit click closes an ordinary tab and Delete also closes a pinned tab', (t) => {
  const { pane, document } = paneFor(t);
  const closed = [];
  pane.open(tab('first', { onClose: () => closed.push('first') }));
  pane.open(tab('second', { onClose: () => closed.push('second') }));
  node(pane, 'first').querySelector('.pane-tab-close').click();
  assert.deepEqual(closed, ['first']);
  assert.deepEqual(ids(pane), ['second']);
  pane.open(tab('third'));
  pane.pin('second');
  pane.select('second');
  node(pane, 'second').focus();
  const event = node(pane, 'second').fire('keydown', { key: 'Delete' });
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(closed, ['first', 'second']);
  assert.deepEqual(ids(pane), ['third']);
  assert.equal(pane.selected, 'third');
  assert.equal(document.activeElement, node(pane, 'third'));
  assert.equal(
    pane.state.tabs.some((tab) => tab.pinned),
    false
  );
});

test('middle-click closes a pinned tab while tabs kept by their half cannot be dismissed', (t) => {
  const { pane } = paneFor(t);
  let closed = 0;
  pane.keep(tab('setup', { lower: true, onClose: () => closed++ }));
  pane.open(tab('terminal', { lower: true, onClose: () => closed++ }));
  pane.pin('terminal');
  node(pane, 'terminal').fire('auxclick', { button: 1 });
  assert.deepEqual(ids(pane), ['setup']);
  assert.equal(closed, 1);
  node(pane, 'setup').fire('keydown', { key: 'Delete' });
  assert.deepEqual(ids(pane), ['setup']);
  assert.equal(closed, 1);
});

test('putting away the lower half retains its pins and selects a surviving tab', (t) => {
  const { pane } = paneFor(t);
  pane.open(tab('files'));
  pane.open(tab('terminal-one', { lower: true }));
  pane.pin('terminal-one');
  pane.open(tab('terminal-two', { lower: true }));
  pane.closeLower();
  assert.deepEqual(ids(pane), ['files', 'terminal-one']);
  assert.equal(pane.selected, 'files');
  assert.equal(pane.state.lower, 'terminal-one');
  assert.equal(pane.halves.lower.node.hidden, false);
  assert.equal(pane.tabs.find((tab) => tab.id === 'terminal-one').body.hidden, false);
  pane.pin('terminal-one');
  pane.closeLower();
  assert.deepEqual(ids(pane), ['files']);
  assert.equal(pane.state.lower, null);
  assert.equal(pane.halves.lower.node.hidden, true);
});

test('a pinned lower tab keeps Setup and Run with its half until the final pin is removed', (t) => {
  const { pane } = paneFor(t);
  pane.keep(tab('setup', { lower: true }));
  pane.keep(tab('run', { lower: true }));
  pane.open(tab('pinned-terminal', { lower: true }));
  pane.pin('pinned-terminal');
  pane.open(tab('other-terminal', { lower: true }));
  assert.deepEqual(ids(pane), ['pinned-terminal', 'setup', 'run', 'other-terminal']);
  pane.closeLower();
  assert.deepEqual(ids(pane), ['pinned-terminal', 'setup', 'run']);
  assert.equal(pane.halves.lower.node.hidden, false);
  assert.equal(pane.tabs.find((tab) => tab.id === 'pinned-terminal').pinned, true);
  assert.equal(pane.tabs.find((tab) => tab.id === 'setup').pinned, undefined);
  assert.equal(pane.tabs.find((tab) => tab.id === 'run').pinned, undefined);
  pane.pin('pinned-terminal');
  pane.closeLower();
  assert.deepEqual(ids(pane), []);
  assert.equal(pane.state.lower, null);
  assert.equal(pane.halves.lower.node.hidden, true);
});

test('archive invalidation removes runnable content while preserving reading pins across repeated updates', (t) => {
  const { pane } = paneFor(t);
  const setupBody = el('<div><button data-do="run">Run setup</button></div>');
  const runBody = el('<div><button data-do="run">Start server</button></div>');
  const terminalBody = el('<div><input aria-label="Terminal input" /></div>');
  const readingBody = el('<div><p>Saved file contents</p></div>');
  readingBody.scrollTop = 85;
  let commands = 0;
  setupBody.querySelector('button').addEventListener('click', () => commands++);
  runBody.querySelector('button').addEventListener('click', () => commands++);
  pane.keep(tab('script-setup', { lower: true, body: setupBody }));
  pane.keep(tab('script-run', { lower: true, body: runBody }));
  pane.open(tab('terminal', { lower: true, body: terminalBody }));
  pane.pin('script-setup');
  pane.pin('script-run');
  pane.pin('terminal');
  pane.open(tab('other-terminal', { lower: true, body: el('<div><input aria-label="Other terminal" /></div>') }));
  pane.open(tab('file:plan.md', { body: readingBody, again: () => ({ file: 'plan.md' }) }));
  pane.pin('file:plan.md');

  // The same invalidation calls are made by archive state changes and terminal shutdown.
  for (let update = 0; update < 2; update++) {
    for (const id of ['script-setup', 'script-run', 'terminal', 'other-terminal'])
      pane.close(id, { unavailable: true });
    pane.open(tab('files'));
    assert.deepEqual(ids(pane), ['script-setup', 'script-run', 'terminal', 'file:plan.md', 'files']);
    for (const id of ['script-setup', 'script-run', 'terminal']) {
      const unavailable = pane.tabs.find((tab) => tab.id === id);
      assert.equal(unavailable.pinned, true);
      assert.equal(unavailable.unavailable, true);
      assert.equal(unavailable.body.querySelector('button, input'), null);
      pane.select(id);
      assert.equal(unavailable.body.hidden, false);
    }
    const reading = pane.tabs.find((tab) => tab.id === 'file:plan.md');
    assert.equal(reading.body, readingBody);
    assert.equal(reading.body.scrollTop, 85);
    assert.equal(reading.pinned, true);
    assert.equal(reading.unavailable, undefined);
    assert.equal(pane.has('other-terminal'), false, 'an unpinned runnable tab disappears');
    assert.equal(setupBody.isConnected, false, 'a reading tab cannot bring runnable kept tabs back');
    assert.equal(runBody.isConnected, false);
  }
  assert.equal(setupBody.isConnected, false);
  assert.equal(runBody.isConnected, false);
  assert.equal(terminalBody.isConnected, false);
  assert.equal(commands, 0);

  // Restoring the contact may provide fresh legitimate content under the same tab id.
  const restoredBody = el('<div><button>Run restored setup</button></div>');
  pane.open(tab('script-setup', { lower: true, body: restoredBody }));
  assert.equal(pane.tabs.find((tab) => tab.id === 'script-setup').body, restoredBody);
  assert.equal(pane.tabs.find((tab) => tab.id === 'script-setup').pinned, true);
  assert.equal(pane.tabs.find((tab) => tab.id === 'script-setup').unavailable, undefined);
  assert.equal(setupBody.isConnected, false, 'recovery never remounts the old runnable body');
});

test('archive plan clearing retains a pinned file body but invalidates a pinned approval body', (t) => {
  const { pane } = paneFor(t);
  const responses = [];
  const plans = new Plans(
    pane,
    {
      participants: [
        {
          id: 'agent',
          name: 'Fixture agent',
          provider: { planApprovals: [{ label: 'Approve plan', mode: 'default', primary: true }] },
        },
      ],
    },
    (...answer) => responses.push(answer),
    () => assert.fail('clearing existing plan bodies must not reread their files')
  );
  // Seed already-rendered content: this tests plan and pane lifecycles, not Markdown rendering.
  const file = plans.addFile('docs/plans/saved.md');
  file.body = el('<div class="plan-tab"><p>Saved plan to read</p></div>');
  file.body.scrollTop = 120;
  pane.open(tab(file.id, { title: file.title, body: file.body, again: () => ({ planFile: file.file }) }));
  pane.pin(file.id);
  const pending = plans.addHistory({ id: 'pending-approval', plan: '# Pending approval', decision: null });
  pending.body = el('<div class="plan-tab"><p>Pending plan</p><div class="plan-foot"></div></div>');
  plans.resolve(pending.id, null);
  plans.show(pending.id);
  pane.pin(pending.id);
  const originalApprovalBody = pending.body;
  assert.ok(originalApprovalBody.querySelector('[data-mode]'), 'real Plans draws the approval action');
  assert.ok(originalApprovalBody.querySelector('.plan-feedback button'), 'real Plans draws feedback action');
  const answered = plans.addHistory({ id: 'answered', plan: '# Previous plan', decision: 'approve-plan' });
  answered.body = el('<div class="plan-tab"><div class="plan-foot"></div></div>');
  plans.resolve(answered.id, 'approve-plan');
  plans.show(answered.id);

  for (let redraw = 0; redraw < 2; redraw++) {
    plans.clear({ keepFiles: true });
    assert.deepEqual([...plans.plans.keys()], [file.id]);
    assert.deepEqual(ids(pane), [file.id, pending.id]);
    assert.equal(pane.tabs[0].body, file.body);
    assert.equal(file.body.scrollTop, 120);
    assert.equal(file.body.isConnected, true);
    assert.equal(pane.tabs[0].pinned, true);
    assert.equal(pane.tabs[0].unavailable, undefined);
    const unavailable = pane.tabs[1];
    assert.equal(unavailable.pinned, true);
    assert.equal(unavailable.unavailable, true);
    assert.equal(unavailable.body.querySelector('button, textarea, a'), null);
    assert.equal(originalApprovalBody.isConnected, false);
    plans.show(pending.id);
    assert.equal(pane.tabs[1].body, unavailable.body, 'removed live plans cannot reopen old approval controls');
  }
  assert.deepEqual(responses, []);

  // A later settled history entry may legitimately replace the placeholder with read-only content.
  const settled = plans.addHistory({ id: pending.id, plan: '# Settled plan', decision: 'cancelled' });
  settled.body = el('<div class="plan-tab"><div class="plan-foot"></div></div>');
  plans.resolve(settled.id, 'cancelled');
  plans.show(settled.id);
  assert.equal(pane.tabs[1].body, settled.body);
  assert.equal(pane.tabs[1].pinned, true);
  assert.equal(pane.tabs[1].unavailable, undefined);
  assert.equal(settled.body.querySelector('button, textarea, a'), null);
  assert.ok(settled.body.textContent.includes('withdrawn'));
  assert.equal(originalApprovalBody.isConnected, false);

  plans.clear();
  assert.equal(plans.size, 0);
  assert.equal(
    pane.tabs.find((tab) => tab.id === file.id).unavailable,
    true,
    'starting over invalidates even saved file bodies'
  );
  assert.equal(file.body.isConnected, false);
  assert.deepEqual(responses, []);
});

test('pin controls preserve keyboard focus without changing the selected tab', (t) => {
  const { pane, document } = paneFor(t);
  pane.open(tab('files'));
  pane.open(tab('changes'));
  const pin = node(pane, 'files').querySelector('.pane-tab-pin');
  pin.focus();
  assert.equal(pin.fire('keydown', { key: 'Enter' }).defaultPrevented, false, 'the native button owns activation');
  pin.click();
  assert.equal(pane.selected, 'changes');
  const unpin = node(pane, 'files').querySelector('.pane-tab-pin');
  assert.equal(document.activeElement, unpin);
  assert.equal(unpin.getAttribute('aria-label'), 'Unpin files tab');
  assert.equal(unpin.getAttribute('aria-pressed'), 'true');
  assert.equal(unpin.fire('keydown', { key: ' ' }).defaultPrevented, false);
  unpin.click();
  assert.equal(document.activeElement, node(pane, 'files').querySelector('.pane-tab-pin'));
  assert.equal(document.activeElement.getAttribute('aria-pressed'), 'false');
  assert.equal(pane.selected, 'changes');
});

test('arrow, Home and End keys follow the order pinning gave the tabs and keep focus on the selected tab', (t) => {
  const { pane, document } = paneFor(t);
  for (const id of ['first', 'middle', 'last']) pane.open(tab(id));
  pane.pin('middle');
  assert.deepEqual(ids(pane), ['middle', 'first', 'last']);
  node(pane, 'last').focus();
  for (const [key, expected] of [
    ['ArrowRight', 'middle'],
    ['ArrowRight', 'first'],
    ['End', 'last'],
    ['Home', 'middle'],
    ['ArrowLeft', 'last'],
  ]) {
    assert.equal(document.activeElement.fire('keydown', { key }).defaultPrevented, true);
    assert.equal(pane.selected, expected);
    assert.equal(document.activeElement, node(pane, expected));
  }
  assert.deepEqual(ids(pane), ['middle', 'first', 'last']);
});

test('restoring waits for asynchronous content and maps pinned browser tabs to their regenerated ids', async (t) => {
  const { pane, opened } = paneFor(t);
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const restoring = pane.restore(
    state([{ id: 'page-old', title: 'Browser', url: 'http://localhost:3000/', pinned: true }, { id: 'files' }], {
      upper: 'page-old',
    }),
    async ({ id }) => {
      if (id === 'page-old') {
        await pending;
        pane.open(tab('page-new', { title: 'Browser', again: () => ({ url: 'http://localhost:3000/' }) }));
        return 'page-new';
      } else pane.open(tab(id));
    }
  );
  assert.deepEqual(ids(pane), []);
  release();
  await restoring;
  assert.deepEqual(ids(pane), ['page-new', 'files']);
  assert.equal(pane.selected, 'page-new');
  assert.equal(pane.state.tabs[0].pinned, true);
  assert.equal(pane.state.tabs[0].url, 'http://localhost:3000/');
  assert.deepEqual(opened, [], 'restored tabs do not count as user-opened');
  pane.open(tab('new-tab'));
  assert.deepEqual(opened, ['new-tab'], 'quiet restoration ends before later user actions');
});

test('restoration retains unavailable pins, skips unavailable ordinary tabs and continues after failures', async (t) => {
  const { pane, opened } = paneFor(t);
  const attempted = [];
  await pane.restore(
    state(
      [
        { id: 'gone', title: 'Missing file', file: 'removed.js', pinned: true },
        { id: 'ordinary-gone' },
        { id: 'failed', title: 'Failed page', url: 'http://localhost:9999/', pinned: true },
        { id: 'files' },
      ],
      { upper: 'gone' }
    ),
    async ({ id }) => {
      attempted.push(id);
      if (id === 'failed') throw new Error('unavailable');
      if (id === 'files') pane.open(tab('files'));
    }
  );
  assert.deepEqual(attempted, ['gone', 'ordinary-gone', 'failed', 'files']);
  assert.deepEqual(ids(pane), ['gone', 'failed', 'files']);
  assert.equal(pane.selected, 'gone');
  assert.deepEqual(
    pane.tabs.map((tab) => Boolean(tab.unavailable)),
    [true, true, false]
  );
  assert.equal(pane.state.tabs[0].file, 'removed.js');
  assert.equal(pane.state.tabs[1].url, 'http://localhost:9999/');
  assert.deepEqual(opened, []);
  pane.pin('gone');
  assert.equal(pane.selected, 'failed');
  assert.deepEqual(ids(pane), ['failed', 'files']);
});

test('an unavailable pinned tab can regain content without losing its pin or place', (t) => {
  const { pane } = paneFor(t);
  pane.open(tab('files'));
  pane.open(tab('returning', { again: () => ({ file: 'restored.js' }) }));
  pane.pin('returning');
  pane.open(tab('changes'));
  pane.close('returning', { unavailable: true });
  const placeholder = pane.tabs.find((tab) => tab.id === 'returning').body;
  const fresh = tab('returning', { body: el('<div>Content is available again</div>') });
  pane.open(fresh);
  assert.deepEqual(ids(pane), ['returning', 'files', 'changes']);
  assert.equal(pane.selected, 'returning');
  assert.equal(pane.tabs[0].pinned, true);
  assert.equal(pane.tabs[0].unavailable, undefined);
  assert.equal(pane.tabs[0].body, fresh.body);
  assert.equal(fresh.body.isConnected, true);
  assert.equal(placeholder.isConnected, false);
});

test('a tab opened during an asynchronous restore cannot inherit the missing tab’s pin', async (t) => {
  const { pane } = paneFor(t);
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const restoring = pane.restore(state([{ id: 'missing', title: 'Missing', pinned: true }]), () => pending);
  pane.open(tab('arrived-plan'));
  release();
  await restoring;
  assert.equal(pane.tabs.find((tab) => tab.id === 'arrived-plan').pinned, undefined);
  assert.equal(pane.tabs.find((tab) => tab.id === 'missing').pinned, true);
  assert.equal(pane.tabs.find((tab) => tab.id === 'missing').unavailable, true);
});

test('a delayed tab restored under its saved id needs no generated-id result', async (t) => {
  const { pane } = paneFor(t);
  await pane.restore(state([{ id: 'files', pinned: true }], { upper: 'files' }), async () => {
    await Promise.resolve();
    pane.open(tab('files'));
  });
  assert.deepEqual(ids(pane), ['files']);
  assert.equal(pane.selected, 'files');
  assert.equal(pane.tabs[0].pinned, true);
  assert.equal(pane.tabs[0].unavailable, undefined);
});

test('restoring existing tabs keeps pins and order without opening content again', async (t) => {
  const { pane } = paneFor(t);
  pane.open(tab('terminal', { lower: true }));
  pane.open(tab('files'));
  pane.open(tab('new-plan'));
  await pane.restore(
    state(
      [
        { id: 'files', pinned: true },
        { id: 'terminal', lower: true, pinned: true },
      ],
      {
        upper: 'files',
        lower: 'terminal',
        folded: true,
        full: true,
      }
    ),
    () => assert.fail('existing content should not reopen')
  );
  assert.deepEqual(ids(pane), ['files', 'terminal', 'new-plan']);
  assert.equal(pane.selected, 'files');
  assert.equal(pane.state.lower, 'terminal');
  assert.equal(pane.folded, true);
  assert.equal(pane.full, true);
  assert.equal(pane.tabs[0].pinned, true);
  assert.equal(pane.tabs[1].pinned, true);
});

test('pinning does not prevent collapsing the pane or change which tab returns', (t) => {
  const { pane } = paneFor(t);
  pane.open(tab('files'));
  pane.pin('files');
  pane.settle({ keepOpen: true });
  pane.toggleCollapsed();
  assert.equal(pane.collapsed, true);
  assert.equal(pane.selected, null);
  assert.equal(pane.state.upper, 'files');
  pane.close('files');
  assert.equal(pane.collapsed, true);
  assert.equal(pane.has('files'), true);
  pane.toggleCollapsed();
  assert.equal(pane.selected, 'files');
});
