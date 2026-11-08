import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optionsSummary } from '../src/renderer/contacts/contact-options.js';

test('a new contact in a repository says its branch, where it starts, its model and its mode', () => {
  assert.equal(
    optionsSummary({ branch: { name: '', base: 'origin/main' }, model: '', mode: 'Asks first' }),
    'New branch from origin/main · Default model · Asks first'
  );
});

test('a branch with a name, from an issue or typed in, is named', () => {
  assert.equal(
    optionsSummary({ branch: { name: '123-fix-login', base: 'main' }, model: 'Opus 5.5', mode: 'Plan mode' }),
    '123-fix-login from main · Opus 5.5 · Plan mode'
  );
});

test("a pull request's own branch is said as that, with nothing to start from", () => {
  assert.equal(
    optionsSummary({ branch: { pull: true }, model: '', mode: 'Asks first' }),
    "The pull request's branch · Default model · Asks first"
  );
});

test('outside a repository there is no branch to say, and a group is said last', () => {
  assert.equal(
    optionsSummary({ branch: null, model: '', mode: 'Never asks', group: 'Work' }),
    'Default model · Never asks · Work'
  );
});

test('a service with no modes to choose from leaves the mode out', () => {
  assert.equal(optionsSummary({ branch: null, model: 'gpt-6' }), 'gpt-6');
});

test("an effort level picked is said after the model, and the model's own goes unsaid", () => {
  assert.equal(
    optionsSummary({ branch: null, model: 'GPT-6.1-Sol', effort: 'Extra high', mode: 'Asks first' }),
    'GPT-6.1-Sol · Extra high effort · Asks first'
  );
  assert.equal(
    optionsSummary({ branch: null, model: '', effort: '', mode: 'Asks first' }),
    'Default model · Asks first'
  );
});
