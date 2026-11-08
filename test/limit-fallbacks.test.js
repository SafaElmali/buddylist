import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanLimitFallbacks,
  fallbackPermissionModes,
  limitContinuation,
  readOnlyPermissionMode,
} from '../src/shared/limit-fallbacks.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import { descriptor as gemini } from '../src/providers/gemini/descriptor.js';
import { descriptor as opencode } from '../src/providers/opencode/descriptor.js';
import { descriptor as hermes } from '../src/providers/hermes/descriptor.js';

test('every Claude and Codex permission mode maps to the same or stricter fallback permissions', () => {
  for (const [source, targets, cases] of [
    [
      claude,
      [codex, gemini, opencode, hermes],
      {
        plan: ['read-only', 'plan', 'plan', undefined],
        default: ['ask', 'default', 'plan', undefined],
        acceptEdits: ['ask', 'autoEdit', 'plan', undefined],
        bypassPermissions: ['full-access', 'yolo', 'build', 'default'],
      },
    ],
    [
      codex,
      [claude, gemini, opencode, hermes],
      {
        'read-only': ['plan', 'plan', 'plan', undefined],
        ask: ['default', 'default', 'plan', undefined],
        auto: ['default', 'default', 'plan', undefined],
        'full-access': ['bypassPermissions', 'yolo', 'build', 'default'],
      },
    ],
  ]) {
    for (const [mode, expected] of Object.entries(cases)) {
      assert.deepEqual(
        targets.map((target) => fallbackPermissionModes(source, mode, target)[0]),
        expected,
        `${source.id}/${mode}`
      );
    }
  }
});

test('existing guests must fit the same ceiling, including workspace boundaries and command approval', () => {
  assert.deepEqual(fallbackPermissionModes(claude, 'plan', codex), ['read-only']);
  assert.deepEqual(fallbackPermissionModes(claude, 'default', codex), ['ask', 'read-only']);
  assert.deepEqual(fallbackPermissionModes(claude, 'acceptEdits', codex), ['ask', 'read-only']);
  assert.deepEqual(fallbackPermissionModes(codex, 'auto', claude), ['default', 'plan']);
  assert.deepEqual(fallbackPermissionModes(claude, 'acceptEdits', hermes), []);
  assert.deepEqual(fallbackPermissionModes(codex, 'auto', hermes), []);
});

test('unknown or unavailable permission modes fail closed instead of taking the provider default', () => {
  assert.deepEqual(fallbackPermissionModes(claude, 'new-mode', codex), []);
  assert.deepEqual(fallbackPermissionModes({ ...claude, id: 'unknown' }, 'default', codex), []);
  assert.deepEqual(
    fallbackPermissionModes(claude, 'default', { ...hermes, permissionModes: [{ id: 'ask', label: 'Asks first' }] }),
    []
  );
  assert.deepEqual(fallbackPermissionModes(claude, 'plan', { ...codex, permissionModes: [{ id: 'ask' }] }), []);
  assert.deepEqual(fallbackPermissionModes(claude, 'default', { ...opencode, permissionModes: [{ id: 'build' }] }), []);
  assert.deepEqual(fallbackPermissionModes(claude, 'default', { ...codex, id: 'unknown' }), []);
});

test('fallback rules accept known, different services and can be cleared', () => {
  const providers = ['claude', 'codex', 'gemini'];
  assert.deepEqual(
    cleanLimitFallbacks(
      { limitFallbacks: { claude: 'codex', codex: 'gemini', gemini: 'claude', unknown: 'claude' } },
      providers
    ),
    {
      limitFallbacks: { claude: 'codex', codex: 'gemini' },
    }
  );
  assert.deepEqual(cleanLimitFallbacks({ limitFallbacks: { claude: 'claude', codex: 'missing' } }, providers), {
    limitFallbacks: {},
  });
  assert.deepEqual(cleanLimitFallbacks({ limitFallbacks: {} }, providers), { limitFallbacks: {} });
  for (const limitFallbacks of [null, [], 'codex', 1]) {
    assert.deepEqual(cleanLimitFallbacks({ limitFallbacks }, providers), {});
  }
  assert.deepEqual(cleanLimitFallbacks(null, providers), {});
});

test('a limit continuation works with no checklist or a completed checklist', () => {
  for (const todos of [[], [{ text: 'Already finished', status: 'completed' }]]) {
    const message = limitContinuation({ from: 'Claude', to: 'Codex', todos });
    assert.match(message, /^@Codex Continue the user's unfinished request/);
    assert.match(message, /Inspect the existing changes first/);
    assert.doesNotMatch(message, /Already finished/);
  }
});

test('the mode a service works read-only in: its mode that changes no files, or asking first for Claude', () => {
  assert.deepEqual(
    [claude, codex, gemini, opencode, hermes].map(readOnlyPermissionMode),
    // Claude's plan mode would end each turn in a plan: its session takes away the tools that write files instead.
    ['default', 'read-only', 'plan', 'plan', null]
  );
});

test('a service the measure doesn’t know, or a read-only mode it doesn’t verify, has no read-only mode', () => {
  assert.equal(readOnlyPermissionMode({ ...codex, id: 'unknown' }), null);
  assert.equal(readOnlyPermissionMode({ ...codex, readOnlyMode: 'auto', permissionModes: [{ id: 'auto' }] }), null);
  assert.equal(readOnlyPermissionMode({ ...hermes, readOnlyMode: 'default' }), null);
});
