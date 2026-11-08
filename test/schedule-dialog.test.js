import { test } from 'node:test';
import assert from 'node:assert/strict';
import { page } from './fixtures/dom.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';

process.env.TZ = 'America/New_York';

// lib/api.js reads the bridge when it is first imported: what the dialog asks the main process is answered here.
const asked = [];
let answer = (_request, values) => ({ id: 's1', ...values, on: true, runs: 0, next: null });
globalThis.window = {
  addEventListener() {},
  messenger: {
    contacts: {
      places: async () => ({
        computer: { name: 'chat-1', folder: '~/chat-1' },
        projects: [{ name: 'shop', folder: '/w/shop' }],
      }),
      pickFolder: async () => null,
    },
    providers: { models: async () => null },
    schedules: {
      add: async (values) => {
        asked.push(['add', values]);
        return answer('add', values);
      },
      update: async (id, values) => {
        asked.push(['update', id, values]);
        return answer('update', values);
      },
    },
  },
};
const { cadenceLine, maxRunsHint, scheduleDialog } = await import('../src/renderer/contacts/schedule-dialog.js');

const settle = () => new Promise((resolve) => setImmediate(resolve));

/** The dialog, open on a page of its own, with its form's fields and what it says. */
function open(t, opts = {}) {
  const document = page(t);
  // The fixture's selects take plain options.
  globalThis.Option = function Option(label, value, _default, selected = false) {
    return Object.assign(document.createElement('option'), { value, textContent: label, selected });
  };
  t.after(() => delete globalThis.Option);
  asked.length = 0;
  const result = scheduleDialog({ providers: [claude, codex], ...opts });
  const form = document.body.querySelector('form.schedule-form');
  const fields = form.elements;
  const text = (selector) => form.querySelector(selector).textContent;
  const change = (field, value, type = 'change') => {
    field.value = value;
    field.fire(type);
  };
  const dialog = document.body.querySelector('.dialog');
  return { document, result, form, fields, text, change, dialog };
}

test('Max runs says what it comes to', () => {
  assert.equal(maxRunsHint(''), 'It runs until you turn it off.');
  assert.equal(maxRunsHint('1'), 'It turns itself off after its first run.');
  assert.equal(maxRunsHint('20'), 'It turns itself off after 20 runs.');
  assert.equal(maxRunsHint('0'), 'A whole number from 1 up, or empty for no end.');
});

test('the line under the cron says when it runs and when next, or what is wrong with it', () => {
  const now = new Date(2026, 9, 26, 14, 20).getTime();
  assert.deepEqual(cadenceLine('0 9 * * 1-5', now), {
    words: 'On weekdays at 9:00 AM.',
    next: 'Next run: Tomorrow 9:00 AM',
    problem: false,
  });
  assert.deepEqual(cadenceLine('0 * * * *', now), {
    words: 'Every hour.',
    next: 'Next run: Today 3:00 PM',
    problem: false,
  });
  assert.equal(cadenceLine('0 9 * *', now).problem, true);
  assert.equal(cadenceLine('0 9 * *', now).next, '');
});

test('a new schedule starts on weekdays at nine, in what Settings > New contacts picks for its service', (t) => {
  const { fields, text, dialog } = open(t, {
    defaults: { claude: { model: 'opus', effort: 'high', permissionMode: 'acceptEdits' } },
  });
  assert.equal(dialog.querySelector('.dialog-title').textContent, 'New schedule');
  assert.equal(dialog.querySelector('.btn.default').textContent, 'Create schedule');
  assert.equal(fields.preset.value, 'weekdays');
  assert.equal(fields.time.value, '09:00');
  assert.equal(fields.time.hidden, false);
  assert.equal(fields.weekday.hidden, true);
  assert.equal(fields.cron.value, '0 9 * * 1-5');
  assert.equal(text('.cadence-said'), 'On weekdays at 9:00 AM.');
  assert.match(text('.next-run'), /^Next run: /);
  assert.equal(text('.max-runs-hint'), 'It runs until you turn it off.');
  assert.equal(fields.provider.value, 'claude');
  assert.equal(fields.model.value, 'opus');
  assert.equal(fields.effort.value, 'high');
  assert.equal(fields.permissionMode.value, 'acceptEdits');
  assert.equal(fields.prompt.value, '');
});

test('a preset, its time and its day write the cron, and a cron typed by hand picks its preset', (t) => {
  const { fields, text, change } = open(t);
  change(fields.preset, 'hourly');
  assert.equal(fields.cron.value, '0 * * * *');
  assert.equal(fields.time.hidden, true);
  assert.equal(text('.cadence-said'), 'Every hour.');
  change(fields.preset, 'weekly');
  assert.equal(fields.weekday.hidden, false);
  change(fields.weekday, '3');
  change(fields.time, '18:30');
  assert.equal(fields.cron.value, '30 18 * * 3');
  assert.equal(text('.cadence-said'), 'Every Wednesday at 6:30 PM.');
  // Custom leaves the cron as it is, to be changed.
  change(fields.preset, 'custom');
  assert.equal(fields.cron.value, '30 18 * * 3');
  change(fields.cron, '*/30 9-18 * * 1-5', 'input');
  assert.equal(fields.preset.value, 'custom');
  assert.equal(fields.time.hidden, true);
  assert.equal(text('.cadence-said'), 'Every 30 minutes from 9:00 AM to 6:30 PM on weekdays.');
  change(fields.cron, '0 7 * * *', 'input');
  assert.equal(fields.preset.value, 'daily');
  assert.equal(fields.time.value, '07:00');
});

test('a cron that is no cron says what is wrong with it under the box', (t) => {
  const { fields, form, text, change } = open(t);
  change(fields.cron, '0 9 * *', 'input');
  assert.equal(
    text('.cadence-said'),
    'A cron has five fields: minute, hour, day of the month, month and day of the week.'
  );
  assert.equal(text('.next-run'), '');
  assert.ok(form.querySelector('.cadence-words').classList.contains('warning'));
  change(fields.cron, '0 9 * * *', 'input');
  assert.ok(!form.querySelector('.cadence-words').classList.contains('warning'));
});

test('another service starts from what it starts with, and Never ask says what it means', (t) => {
  const { fields, form, change } = open(t, { defaults: { codex: { permissionMode: 'full-access' } } });
  change(fields.provider, 'codex');
  assert.deepEqual(
    fields.permissionMode.querySelectorAll('option').map((option) => option.value),
    codex.permissionModes.map((mode) => mode.id)
  );
  assert.equal(fields.permissionMode.value, 'full-access');
  assert.equal(fields.model.value, '');
  assert.equal(
    form.querySelector('.mode-warning').hidden,
    !codex.permissionModes.find((m) => m.id === 'full-access').danger
  );
  change(fields.provider, 'claude');
  change(fields.permissionMode, 'bypassPermissions');
  assert.equal(form.querySelector('.mode-warning').hidden, false);
});

test('Create schedule sends what the form says, and the dialog closes with what was saved', async (t) => {
  const { fields, form, change, result } = open(t);
  change(fields.name, 'Triage');
  change(fields.prompt, 'Label the new issues.');
  // Works on, as picking shop in its list leaves it.
  fields.cwd.value = '/w/shop';
  change(fields.maxRuns, '5', 'input');
  assert.equal(form.querySelector('.max-runs-hint').textContent, 'It turns itself off after 5 runs.');
  form.fire('submit');
  const saved = await result;
  assert.deepEqual(asked, [
    [
      'add',
      {
        name: 'Triage',
        prompt: 'Label the new issues.',
        cwd: '/w/shop',
        cron: '0 9 * * 1-5',
        provider: 'claude',
        model: '',
        effort: '',
        permissionMode: 'default',
        maxRuns: '5',
      },
    ],
  ]);
  assert.equal(saved.id, 's1');
});

test('a schedule that is refused keeps the dialog open, with why', async (t) => {
  answer = () => {
    throw new Error('Pick the project its runs work on, or This computer.');
  };
  t.after(() => {
    answer = (_request, values) => ({ id: 's1', ...values });
  });
  const { fields, form, change, document } = open(t);
  change(fields.prompt, 'Label the new issues.');
  form.fire('submit');
  await settle();
  const error = form.querySelector('.error');
  assert.equal(error.hidden, false);
  assert.equal(error.textContent, 'Pick the project its runs work on, or This computer.');
  assert.ok(document.body.querySelector('.modal'), 'still open');
});

test('Edit schedule starts from the schedule, on This computer, and saves it by its id', async (t) => {
  const existing = {
    id: 's9',
    name: 'Watch CI',
    prompt: 'Check the last CI run.\nFix what failed.',
    cwd: '',
    computer: true,
    cron: '*/30 9-18 * * 1-5',
    provider: 'claude',
    model: 'sonnet',
    effort: '',
    permissionMode: 'bypassPermissions',
    maxRuns: 20,
  };
  const { fields, form, dialog, result } = open(t, { existing });
  assert.equal(dialog.querySelector('.dialog-title').textContent, 'Edit schedule');
  assert.equal(dialog.querySelector('.btn.default').textContent, 'Save');
  assert.equal(fields.name.value, 'Watch CI');
  assert.equal(fields.prompt.value, 'Check the last CI run.\nFix what failed.');
  assert.equal(fields.preset.value, 'custom');
  assert.equal(fields.maxRuns.value, '20');
  assert.equal(fields.model.value, 'sonnet');
  assert.equal(fields.permissionMode.value, 'bypassPermissions');
  assert.equal(form.querySelector('.mode-warning').hidden, false);
  assert.equal(
    form.querySelector('.where-hint').textContent,
    'Each run is a new contact, in a new, empty folder of its own.'
  );
  assert.equal(form.querySelector('.where-combo .combo-label').textContent, 'This computer');
  form.fire('submit');
  await result;
  assert.equal(asked[0][0], 'update');
  assert.equal(asked[0][1], 's9');
  assert.equal(asked[0][2].computer, true);
  assert.equal(asked[0][2].cwd, '');
  assert.equal(asked[0][2].maxRuns, '20');
});
