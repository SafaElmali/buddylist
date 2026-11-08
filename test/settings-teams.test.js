import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANSWERS, DEFAULT_ROLES } from '../src/shared/teams.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import { descriptor as gemini } from '../src/providers/gemini/descriptor.js';

// The page reads the app's bridge when it is loaded, for the models its role editor lists: nothing here asks it.
globalThis.window ??= { messenger: {} };
const { riskOfChange, roleSummary, teamSummary } = await import('../src/renderer/settings/teams.js');

const PROVIDERS = [claude, codex, gemini];
const reviewer = DEFAULT_ROLES[0];
const role = (more = {}) => ({ ...reviewer, id: 'r1', name: 'Tester', ...more });

test("a role's line says its service, when it answers and that it is read only", () => {
  assert.equal(roleSummary(reviewer, PROVIDERS), 'Claude · Answers after changes · Read only');
});

test("a role's line says its model and effort once they are not the service's own", () => {
  assert.equal(
    roleSummary(role({ provider: 'codex', model: 'gpt-5.5', effort: 'high' }), PROVIDERS),
    'Codex · gpt-5.5 · High effort · Answers after changes · Read only'
  );
  assert.equal(
    roleSummary(role({ effort: 'xhigh', readOnly: false }), PROVIDERS),
    'Claude · Extra high effort · Answers after changes'
  );
});

test("a role's line says each way it can answer", () => {
  const said = ANSWERS.map(({ id }) => roleSummary(role({ answers: id, readOnly: false }), PROVIDERS));
  assert.deepEqual(said, [
    'Claude · Answers after changes',
    'Claude · Answers every message',
    'Claude · Answers when mentioned',
  ]);
});

test('a role of a service that is gone says the service its settings show, the first one', () => {
  assert.equal(
    roleSummary(role({ provider: 'nobody', readOnly: false, answers: 'always' }), PROVIDERS),
    'Claude · Answers every message'
  );
});

test("a role's line ends with the mode picked for it, and says nothing of the default", () => {
  assert.equal(
    roleSummary(role({ answers: 'mentioned', permissionMode: 'bypassPermissions' }), PROVIDERS),
    'Claude · Answers when mentioned · Read only · Never asks'
  );
  assert.equal(
    roleSummary(role({ provider: 'codex', readOnly: false, permissionMode: 'auto' }), PROVIDERS),
    'Codex · Answers after changes · Works in this folder'
  );
  assert.equal(roleSummary(role({ permissionMode: '' }), PROVIDERS), 'Claude · Answers after changes · Read only');
  // Read only keeps Gemini in Plan whatever is picked, and the line says what it does.
  assert.equal(
    roleSummary(role({ provider: 'gemini', permissionMode: 'yolo' }), PROVIDERS),
    'Gemini · Answers after changes · Read only'
  );
});

test('a change that lets a role run commands unasked asks first, as the mode badge does', () => {
  const looking = role({ name: 'Full-Stack Reviewer', permissionMode: '' });
  const never = role({ name: 'Full-Stack Reviewer', permissionMode: 'bypassPermissions' });
  // Picking Never ask: with Read only on, its sandbox still keeps it from changing files.
  assert.deepEqual(riskOfChange(looking, { permissionMode: 'bypassPermissions' }, claude), {
    message:
      "Full-Stack Reviewer will run commands without asking.\nRead only keeps them in a sandbox that can't change files.",
    ok: 'Turn off prompts',
  });
  // Turning Read only off under it: now it changes files too, which is what the mode badge warns of.
  assert.deepEqual(riskOfChange(never, { readOnly: false }, claude), {
    message:
      "Full-Stack Reviewer will run commands and change files without asking.\nOnly do this in a folder you don't mind breaking.",
    ok: 'Turn off Read only',
  });
  assert.deepEqual(riskOfChange(role({ readOnly: false }), { permissionMode: 'bypassPermissions' }, claude), {
    message:
      "Tester will run commands and change files without asking.\nOnly do this in a folder you don't mind breaking.",
    ok: 'Turn off prompts',
  });
  // Gemini stays in Plan while Read only is on: picking yolo asks once Read only goes off, when it holds.
  const gemini = PROVIDERS.find((one) => one.id === 'gemini');
  assert.equal(riskOfChange(role({ provider: 'gemini' }), { permissionMode: 'yolo' }, gemini), null);
  assert.equal(
    riskOfChange(role({ provider: 'gemini', permissionMode: 'yolo' }), { readOnly: false }, gemini).ok,
    'Turn off Read only'
  );
  // Nothing to ask: a mode that asks, Read only going off under one, Read only coming on, the mode picked again.
  assert.equal(riskOfChange(looking, { permissionMode: 'acceptEdits' }, claude), null);
  assert.equal(riskOfChange(role({ permissionMode: 'acceptEdits' }), { readOnly: false }, claude), null);
  assert.equal(
    riskOfChange(role({ readOnly: false, permissionMode: 'bypassPermissions' }), { readOnly: true }, claude),
    null
  );
  assert.equal(riskOfChange(never, { permissionMode: 'bypassPermissions' }, claude), null);
  assert.equal(
    riskOfChange(role({ name: '' }), { permissionMode: 'bypassPermissions' }, claude).message.split(' ')[0],
    'This'
  );
});

test("a team's line names its roles in the order they join, and says when it has none", () => {
  const roles = [
    role({ id: 'a', name: 'Reviewer' }),
    role({ id: 'b', name: 'Test writer' }),
    role({ id: 'c', name: 'PM' }),
  ];
  assert.equal(teamSummary({ id: 't', name: 'Ship it', roles: ['c', 'a'] }, roles), 'PM, Reviewer');
  // A role taken out is left out of the line before the team is kept without it.
  assert.equal(teamSummary({ id: 't', name: 'Ship it', roles: ['gone', 'b'] }, roles), 'Test writer');
  assert.equal(teamSummary({ id: 't', name: 'Empty', roles: [] }, roles), 'No roles yet');
});
