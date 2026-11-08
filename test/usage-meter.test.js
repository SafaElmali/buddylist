import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Element, page } from './fixtures/dom.js';
import { closeMenu } from '../src/renderer/lib/menu.js';

// The bridge the meter asks through: what each question for the usage was answered with, by the test, in turn.
const asked = [];
const settingsOpened = [];
const messenger = {
  settings: { open: async (page) => settingsOpened.push(page) },
  chat: {
    usage: () =>
      new Promise((resolve, reject) => {
        asked.push({ resolve, reject });
      }),
  },
  app: { used: async () => {} },
};
globalThis.window = {
  messenger,
  innerWidth: 800,
  innerHeight: 600,
  addEventListener() {},
  removeEventListener() {},
};
globalThis.Element = Element;
const { ContextMeter } = await import('../src/renderer/chat/usage.js');

const used = (session, weekly) => [
  { kind: 'session', percent: session, resetsAt: Date.now() + 3_600_000 },
  { kind: 'weekly', percent: weekly, resetsAt: Date.now() + 86_400_000 },
];
const TEAM = {
  context: { used: 0, size: 0, parts: [] },
  plan: 'team',
  limits: used(0, 0),
  account: 'you@example.com (Acme · Team)',
};
const MAX = {
  context: { used: 0, size: 0, parts: [] },
  plan: 'max',
  limits: used(9, 95),
  account: 'you@example.com (Personal · Max)',
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The meter of a conversation with one Claude, in the team login, on a page of its own. */
function meter(t) {
  asked.length = 0;
  settingsOpened.length = 0;
  // Put away while the page is still there.
  t.after(closeMenu);
  const document = page(t);
  const button = document.createElement('button');
  button.getBoundingClientRect = () => ({ left: 600, right: 700, top: 560, bottom: 580 });
  document.body.append(button);
  const claude = {
    id: 'c1',
    name: 'Claude',
    provider: { id: 'claude', usage: true, accounts: true },
    state: 'idle',
    context: null,
    limits: used(0, 0),
    account: 'team',
  };
  const ctx = { contactId: 'c1', provider: claude.provider, participants: [claude] };
  const meter = new ContextMeter(button, ctx);
  meter.paint();
  const gauges = () =>
    button
      .querySelectorAll('.meter-gauge')
      .map(
        (gauge) =>
          `${gauge.querySelector('.meter-name').textContent} ${gauge.querySelector('.meter-figure').textContent}`
      );
  const popup = () => document.body.querySelectorAll('.usage-popup');
  const text = (selector) => popup()[0]?.querySelector(selector)?.textContent.trim() ?? null;
  return { meter, button, claude, gauges, popup, text };
}

test('the popover names the plan and the account its limits are of', async (t) => {
  const m = meter(t);
  void m.meter.show();
  asked[0].resolve(TEAM);
  await tick();
  assert.equal(m.text('.usage-limits .usage-title'), 'Plan usage limits · Team');
  assert.equal(m.text('.usage-account'), 'you@example.com (Acme · Team)');
  assert.equal(m.text('.usage-pinned'), null, 'a participant in the account in use says nothing of it');
});

test('account settings opens directly while usage is loading, closes the popover and ignores its late answer', async (t) => {
  const m = meter(t);
  void m.meter.show();
  m.popup()[0].querySelector('.usage-account-settings').click();
  assert.deepEqual(settingsOpened, [{ section: 'accounts' }]);
  assert.equal(m.popup().length, 0);
  asked[0].resolve(TEAM);
  await tick();
  assert.equal(m.popup().length, 0);
});

test('services without managed accounts do not imply that Account settings manages their login', (t) => {
  const m = meter(t);
  m.claude.provider.accounts = false;
  void m.meter.show();
  assert.equal(m.popup()[0].querySelector('.usage-account-settings'), null);
});

test('one a fallback keeps in another account than the one in use says so', async (t) => {
  const m = meter(t);
  void m.meter.show();
  asked[0].resolve({ ...MAX, pinned: true });
  await tick();
  assert.equal(m.text('.usage-account'), 'you@example.com (Personal · Max)');
  assert.equal(m.text('.usage-pinned'), 'A fallback keeps Claude in this account, not the one in use.');
});

test('another account put in use while the popover is open asks again, of that one, and the bar shows it', async (t) => {
  const m = meter(t);
  void m.meter.show();
  asked[0].resolve(TEAM);
  await tick();
  // The same login saying its limits again is nothing to ask again for.
  m.meter.setLimits(used(1, 0), 'c1', 'team');
  assert.equal(asked.length, 1);
  assert.deepEqual(m.gauges(), ['Context ', 'Session 1%', 'Weekly 0%']);

  m.meter.setLimits(used(9, 95), 'c1', 'personal');
  assert.deepEqual(m.gauges(), ['Context ', 'Session 9%', 'Weekly 95%']);
  assert.equal(asked.length, 2, 'what was open is asked again');
  asked[1].resolve(MAX);
  await tick();
  assert.equal(m.popup().length, 1);
  assert.equal(m.text('.usage-account'), 'you@example.com (Personal · Max)');
});

test('an answer of the login put out of use while it was asked is not shown, and doesn’t change the bar', async (t) => {
  const m = meter(t);
  void m.meter.show();
  // Switched while the team login was still being asked.
  m.meter.setLimits(used(9, 95), 'c1', 'personal');
  assert.equal(asked.length, 2);
  asked[0].resolve(TEAM);
  await tick();
  assert.deepEqual(m.gauges(), ['Context ', 'Session 9%', 'Weekly 95%'], 'the bar is the login in use’s');
  assert.equal(m.text('.usage-account'), null, 'the stale answer is not drawn');
  asked[1].resolve(MAX);
  await tick();
  assert.equal(m.text('.usage-account'), 'you@example.com (Personal · Max)');
  assert.deepEqual(m.gauges(), ['Context ', 'Session 9%', 'Weekly 95%']);
});

test('a closed popover is not opened again by a switch, and the bar follows it', (t) => {
  const m = meter(t);
  m.meter.setLimits(used(9, 95), 'c1', 'personal');
  assert.equal(asked.length, 0);
  assert.equal(m.popup().length, 0);
  assert.deepEqual(m.gauges(), ['Context ', 'Session 9%', 'Weekly 95%']);
});

test('limits the popover couldn’t get leave the bar as it was: unknown is not zero', async (t) => {
  const m = meter(t);
  m.meter.setLimits(used(40, 60), 'c1', 'team');
  void m.meter.show();
  asked[0].resolve({ context: { used: 0, size: 0, parts: [] }, plan: null, limits: [] });
  await tick();
  assert.match(m.text('.usage-limits .usage-note'), /Plan usage is unavailable/);
  assert.deepEqual(m.gauges(), ['Context ', 'Session 40%', 'Weekly 60%']);
});

test('102% remains visible as over limit, with bounded decorative bars and an accessible reading', async (t) => {
  const m = meter(t);
  const limits = used(102, 37);
  m.meter.setLimits(limits);
  assert.deepEqual(m.gauges(), ['Context ', 'Session 102% · over limit', 'Weekly 37%']);
  const session = m.button.querySelectorAll('.meter-gauge')[1];
  assert.match(session.getAttribute('title'), /102% used · over limit/);
  assert.match(m.button.getAttribute('aria-label'), /Session limit: 102% used · over limit/);
  assert.match(m.button.getAttribute('aria-label'), /Weekly · all models: 37% used/);
  assert.equal(session.querySelector('.meter-bar span').getAttribute('style'), 'width: 100.00%');
  assert.equal(session.querySelector('.meter-bar').getAttribute('aria-hidden'), 'true');
  void m.meter.show();
  asked[0].resolve({ ...TEAM, limits });
  await tick();
  assert.equal(m.text('.usage-percent'), '102%');
  assert.equal(m.text('.usage-limit .usage-note'), 'Over limit · reported by the provider');
  assert.equal(m.popup()[0].querySelector('.usage-bar span').getAttribute('style'), 'width: 100.00%');
  assert.equal(limits[0].percent, 102, 'drawing never changes the raw usage');
});

test('normal, boundary and invalid readings stay distinct in the meter and popover', async (t) => {
  const m = meter(t);
  for (const [percent, text, barWidth] of [
    [0, '0%', '0.00'],
    [37, '37%', '37.00'],
    [99.9, '<100%', '99.90'],
    [100, '100%', '100.00'],
    [100.1, '>100%', '100.00'],
    [null, 'Unknown', '0.00'],
    [NaN, 'Unknown', '0.00'],
    [Infinity, 'Unknown', '0.00'],
    [-1, 'Unknown', '0.00'],
  ]) {
    const limits = used(percent, 37);
    m.meter.setLimits(limits);
    const session = m.button.querySelectorAll('.meter-gauge')[1];
    assert.equal(
      session.querySelector('.meter-figure').textContent,
      `${text}${percent > 100 && Number.isFinite(percent) ? ' · over limit' : ''}`
    );
    assert.equal(session.querySelector('.meter-bar span').getAttribute('style'), `width: ${barWidth}%`);
    void m.meter.show();
    asked.at(-1).resolve({ ...TEAM, limits });
    await tick();
    assert.equal(m.text('.usage-percent'), text);
    assert.equal(
      m.popup()[0].querySelector('.usage-limit').querySelectorAll('.usage-bar').length,
      text === 'Unknown' ? 0 : 1
    );
    closeMenu();
  }
  m.meter.setLimits([{ kind: 'session', percent: 102, resetsAt: Date.now() - 1 }]);
  assert.deepEqual(m.gauges(), ['Context '], 'a reset allowance is not shown as still over limit');
});
