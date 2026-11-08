import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanContactDefaults, defaultsOf, newContactStart } from '../src/shared/contact-defaults.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';

const PROVIDERS = [claude, codex];
const clean = (contactDefaults, settings = {}) => cleanContactDefaults({ contactDefaults }, settings, PROVIDERS);

// ---- what Settings > New contacts keeps ----------------------------------------------------------

test('a service is kept as the window sent it, and a part it leaves out stays like the contact it is added from', () => {
  assert.deepEqual(clean({ claude: { model: ' sonnet ', effort: 'high', permissionMode: 'bypassPermissions' } }), {
    contactDefaults: { claude: { model: 'sonnet', effort: 'high', permissionMode: 'bypassPermissions' } },
  });
  // '' is a choice too: the service's default model, the model's own level.
  assert.deepEqual(clean({ claude: { model: '', effort: '' } }), {
    contactDefaults: { claude: { model: '', effort: '' } },
  });
  assert.deepEqual(clean({ claude: {} }), { contactDefaults: { claude: {} } });
});

test('another service keeps what it had, and null forgets one', () => {
  const settings = { contactDefaults: { codex: { model: 'gpt-5.5' }, claude: { model: 'opus' } } };
  assert.deepEqual(clean({ claude: { permissionMode: 'plan' } }, settings), {
    contactDefaults: { codex: { model: 'gpt-5.5' }, claude: { permissionMode: 'plan' } },
  });
  assert.deepEqual(clean({ claude: null }, settings), { contactDefaults: { codex: { model: 'gpt-5.5' } } });
});

test('what can’t be kept is left out: a mode of another service, a service there is none of, and what is no text', () => {
  assert.deepEqual(
    clean({
      claude: { model: 5, effort: 'x'.repeat(41), permissionMode: 'full-access' },
      nobody: { model: 'opus' },
    }),
    { contactDefaults: { claude: {} } }
  );
  assert.deepEqual(clean({ claude: { model: 'x'.repeat(201) } }), { contactDefaults: { claude: {} } });
  // A patch without it changes nothing.
  assert.deepEqual(cleanContactDefaults({ sounds: true }, {}, PROVIDERS), {});
  assert.deepEqual(cleanContactDefaults({ contactDefaults: 'opus' }, {}, PROVIDERS), {});
});

test('a mode the service no longer has is left alone, as if it was never picked', () => {
  assert.deepEqual(defaultsOf({ claude: { model: 'opus', permissionMode: 'gone' } }, claude), { model: 'opus' });
  assert.deepEqual(defaultsOf(undefined, claude), {});
});

// ---- what Add a Contact starts out with ---------------------------------------------------------

const FROM = { provider: 'claude', model: 'opus', effort: 'high', permissionMode: 'bypassPermissions', place: 'git' };

test('without Settings, a new contact is like the one it is added from, or else the service as it is', () => {
  assert.deepEqual(newContactStart({ provider: claude, from: FROM }), {
    model: 'opus',
    effort: 'high',
    permissionMode: 'bypassPermissions',
  });
  assert.deepEqual(newContactStart({ provider: claude }), {
    model: '',
    effort: '',
    permissionMode: claude.defaultPermissionMode,
  });
});

test('what Settings picks wins over the contact it is added from, and the rest is still copied', () => {
  const defaults = { claude: { permissionMode: 'default' } };
  assert.deepEqual(newContactStart({ provider: claude, defaults, from: FROM }), {
    model: 'opus',
    effort: 'high',
    permissionMode: 'default',
  });
  const all = { claude: { model: '', effort: '', permissionMode: 'plan' } };
  assert.deepEqual(newContactStart({ provider: claude, defaults: all, from: FROM }), {
    model: '',
    effort: '',
    permissionMode: 'plan',
  });
});

test('a level copied goes with the model copied: another model picked in Settings starts at its own', () => {
  assert.equal(newContactStart({ provider: claude, defaults: { claude: { model: 'haiku' } }, from: FROM }).effort, '');
  assert.equal(
    newContactStart({ provider: claude, defaults: { claude: { effort: 'low' } }, from: FROM }).effort,
    'low'
  );
});

test('a contact of another service passes nothing on, and Settings of another service say nothing', () => {
  const fromCodex = { provider: 'codex', model: 'gpt-5.5', effort: 'high', permissionMode: 'full-access' };
  assert.deepEqual(newContactStart({ provider: claude, from: fromCodex, defaults: { codex: { model: 'x' } } }), {
    model: '',
    effort: '',
    permissionMode: claude.defaultPermissionMode,
  });
});

test('on This computer the mode is the service’s own, unless the contact it is added from is there, or Settings says', () => {
  assert.equal(newContactStart({ provider: claude, from: FROM, computer: true }).permissionMode, 'default');
  const there = { ...FROM, place: 'computer' };
  assert.equal(newContactStart({ provider: claude, from: there, computer: true }).permissionMode, 'bypassPermissions');
  const defaults = { claude: { permissionMode: 'acceptEdits' } };
  assert.equal(
    newContactStart({ provider: claude, from: FROM, defaults, computer: true }).permissionMode,
    'acceptEdits'
  );
});

test('a mode copied that the service doesn’t have is the service’s own', () => {
  const odd = { ...FROM, permissionMode: 'gone' };
  assert.equal(newContactStart({ provider: claude, from: odd }).permissionMode, claude.defaultPermissionMode);
});
