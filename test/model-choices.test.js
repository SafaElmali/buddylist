import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effortChoices, modelChoices, modelOption } from '../src/renderer/contacts/model-choices.js';
import { modelCatalog, shownModelIds, withDefaultNamed } from '../src/shared/models.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import { descriptor as opencode } from '../src/providers/opencode/descriptor.js';

const labels = (choices) => choices.map((choice) => choice.label);
const current = (choices) => choices.filter((choice) => choice.current).map((choice) => choice.id);
const typed = (choices) => choices.filter((choice) => choice.typed).map((choice) => choice.id);

// What Claude Code says it has, as far as these tests need.
const REPORTED = [
  { id: 'opus', label: 'Opus 5.5', hint: 'Best for everyday, complex tasks' },
  { id: 'fable', label: 'Fable 5.1', hint: 'Most capable' },
  { id: 'sonnet', label: 'Sonnet 5.5', hint: 'Efficient for routine tasks' },
  { id: 'haiku', label: 'Haiku 4.5', hint: 'Fastest for quick answers' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', hint: 'Efficient for routine tasks' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8', hint: 'Best for everyday, complex tasks' },
];

// The list before Claude Code has answered, and once it has.
const builtIn = (extra = {}) => ({
  catalog: modelCatalog(claude, null),
  shown: shownModelIds(claude, {}),
  current: '',
  ...extra,
});
const asked = (extra = {}) => ({ ...builtIn(), catalog: modelCatalog(claude, REPORTED), ...extra });

// ---- how a model is named ----------------------------------------------------------------------

test('a model goes by the name and hint its service has for it', () => {
  assert.deepEqual(modelOption(asked().catalog, 'opus'), REPORTED[0]);
  assert.equal(modelOption(builtIn().catalog, 'opus').label, 'Opus', 'before the service has said which Opus');
});

test('no model is the service’s default', () => {
  assert.deepEqual(modelOption(asked().catalog, ''), { id: '', label: 'Default', hint: 'From your Claude settings' });
});

test('searching Default keeps the empty model choice when its resolved name is shown', () => {
  const catalog = withDefaultNamed(
    { model: '', defaultModel: null },
    modelCatalog(claude, [{ id: 'opus', label: 'Opus 5.5', default: true }])
  );
  const choices = modelChoices({ catalog, shown: ['opus'], current: '', query: 'default' });
  assert.deepEqual(labels(choices), ['Default (Opus 5.5)']);
  assert.deepEqual(current(choices), ['']);
  assert.deepEqual(typed(choices), [], 'Default is not offered as a literal model id');
});

test('a model nobody has a name for goes by its own id', () => {
  assert.deepEqual(modelOption(asked().catalog, 'claude-opus-4-5'), {
    id: 'claude-opus-4-5',
    label: 'claude-opus-4-5',
  });
});

// ---- the list, before anything is typed --------------------------------------------------------

test('the list has the default and the models offered, with the default in use', () => {
  const choices = modelChoices(builtIn());
  assert.deepEqual(labels(choices), ['Default', 'Opus', 'Fable', 'Sonnet', 'Haiku']);
  assert.deepEqual(current(choices), ['']);
  assert.deepEqual(typed(choices), []);
});

test('once the service has answered, the same models go by its names for them', () => {
  assert.deepEqual(labels(modelChoices(asked())), ['Default', 'Opus 5.5', 'Fable 5.1', 'Sonnet 5.5', 'Haiku 4.5']);
});

test('only the models chosen for the service are offered, in the order they were saved', () => {
  const choices = modelChoices(asked({ shown: ['claude-opus-4-8', 'fable'] }));
  assert.deepEqual(labels(choices), ['Default', 'Opus 4.8', 'Fable 5.1']);
});

// ---- a choice above Default that is no model ---------------------------------------------------

const LIKE = { id: ':like', label: 'Like the contact it’s added from' };

test('a choice that is no model, such as New contacts’ “Like the contact”, comes first, above Default', () => {
  const choices = modelChoices(asked({ first: LIKE, current: ':like' }));
  assert.deepEqual(labels(choices).slice(0, 2), ['Like the contact it’s added from', 'Default']);
  assert.deepEqual(current(choices), [':like']);
  assert.deepEqual(typed(choices), []);
  assert.deepEqual(
    labels(modelChoices(asked({ first: LIKE, current: 'opus' }))),
    ['Like the contact it’s added from', 'Default', 'Opus 5.5', 'Fable 5.1', 'Sonnet 5.5', 'Haiku 4.5'],
    'and stays first when a model is picked'
  );
});

test('the choice above Default is found by its words, and a name typed is still taken as it is', () => {
  const found = modelChoices(asked({ first: LIKE, query: 'contact' }));
  assert.deepEqual(labels(found.filter((choice) => !choice.typed)), ['Like the contact it’s added from']);
  const choices = modelChoices(asked({ first: LIKE, query: 'claude-opus-9' }));
  assert.deepEqual(typed(choices), ['claude-opus-9']);
});

test('without one, the list is as it was', () => {
  assert.deepEqual(labels(modelChoices(asked({ first: undefined }))), labels(modelChoices(asked())));
});

test('with every model unticked, the default is still there', () => {
  assert.deepEqual(labels(modelChoices(asked({ shown: [] }))), ['Default']);
});

test('a model chosen earlier that the service has no name for yet goes by its id', () => {
  assert.deepEqual(labels(modelChoices(builtIn({ shown: ['opus', 'claude-opus-4-8'] }))), [
    'Default',
    'Opus',
    'claude-opus-4-8',
  ]);
});

test('the model in use is the one marked', () => {
  assert.deepEqual(current(modelChoices(asked({ current: 'sonnet' }))), ['sonnet']);
});

test('a model in use that is not offered is in the list too, by its name, and marked', () => {
  const choices = modelChoices(asked({ current: 'claude-opus-4-8' }));
  assert.deepEqual(labels(choices), ['Default', 'Opus 5.5', 'Fable 5.1', 'Sonnet 5.5', 'Haiku 4.5', 'Opus 4.8']);
  assert.deepEqual(current(choices), ['claude-opus-4-8']);
});

test('a model typed earlier is in the list too, and is not what is being typed', () => {
  const choices = modelChoices(asked({ current: 'claude-opus-4-5' }));
  assert.deepEqual(labels(choices).at(-1), 'claude-opus-4-5');
  assert.deepEqual(current(choices), ['claude-opus-4-5']);
  assert.deepEqual(typed(choices), []);
});

test('a model that is offered and in use is listed once', () => {
  assert.deepEqual(labels(modelChoices(asked({ shown: ['opus', 'opus', 'sonnet'], current: 'opus' }))), [
    'Default',
    'Opus 5.5',
    'Sonnet 5.5',
  ]);
});

test('what the list is given is left as it was', () => {
  const given = asked({ current: 'fable' });
  const before = structuredClone(given);
  modelChoices({ ...given, query: 'op' });
  assert.deepEqual(given, before);
});

test('a service with no models to name still has its default', () => {
  const choices = modelChoices({
    catalog: modelCatalog(opencode, null),
    shown: shownModelIds(opencode, {}),
    current: '',
  });
  assert.deepEqual(labels(choices), ['Default']);
});

// ---- searching ---------------------------------------------------------------------------------

test('typing a model’s name finds it, whatever the case', () => {
  for (const query of ['haiku 4.5', 'Haiku 4.5', 'HAIKU 4.5', '  haiku 4.5  ']) {
    const choices = modelChoices(asked({ query }));
    assert.deepEqual(labels(choices), ['Haiku 4.5'], query);
    assert.deepEqual(typed(choices), [], `${query} is Haiku 4.5, not another model`);
  }
});

test('typing looks through every model the service has, the ones offered first', () => {
  const choices = modelChoices(asked({ query: 'sonnet' }));
  assert.deepEqual(labels(choices), ['Sonnet 5.5', 'Sonnet 5']);
  assert.deepEqual(typed(choices), [], 'sonnet is the id of Sonnet 5.5');
});

test('a version finds the models of that version', () => {
  assert.deepEqual(labels(modelChoices(asked({ query: '5.5' }))), ['Opus 5.5', 'Sonnet 5.5', '5.5']);
});

test('a model is found by its id as well as its name', () => {
  assert.deepEqual(labels(modelChoices(asked({ query: 'opus-4-8' }))), ['Opus 4.8', 'opus-4-8']);
  assert.deepEqual(labels(modelChoices(asked({ query: 'claude-opus-4-8' }))), ['Opus 4.8']);
});

test('before the service has answered, only the models known so far can be found', () => {
  assert.deepEqual(labels(modelChoices(builtIn({ query: 'opus 4.8' }))), ['opus 4.8']);
});

test('a hint is not searched: “fastest” is no model’s name', () => {
  assert.deepEqual(labels(modelChoices(asked({ query: 'fastest' }))), ['fastest']);
});

test('“default” finds the default, and is not taken for a model’s name', () => {
  const choices = modelChoices(asked({ current: 'opus', query: 'default' }));
  assert.deepEqual(labels(choices), ['Default']);
  assert.equal(choices[0].id, '');
  assert.deepEqual(current(choices), []);
});

test('a name no list has is offered as it was typed, without the spaces around it', () => {
  const choices = modelChoices(asked({ query: '  claude-Opus-4-5 ' }));
  assert.deepEqual(choices, [{ id: 'claude-Opus-4-5', label: 'claude-Opus-4-5', current: false, typed: true }]);
});

test('an opencode model is typed as provider/model', () => {
  const choices = modelChoices({
    catalog: modelCatalog(opencode, null),
    shown: [],
    current: '',
    query: 'anthropic/claude-sonnet-5',
  });
  assert.deepEqual(typed(choices), ['anthropic/claude-sonnet-5']);
  assert.equal(choices.length, 1);
});

test('the model in use is not offered a second time for being typed again', () => {
  const choices = modelChoices(asked({ current: 'claude-opus-4-5', query: 'CLAUDE-OPUS-4-5' }));
  assert.deepEqual(labels(choices), ['claude-opus-4-5']);
  assert.deepEqual(current(choices), ['claude-opus-4-5']);
  assert.deepEqual(typed(choices), []);
});

test('only spaces is nothing typed: the list as it opened', () => {
  assert.deepEqual(labels(modelChoices(asked({ query: '   ' }))), [
    'Default',
    'Opus 5.5',
    'Fable 5.1',
    'Sonnet 5.5',
    'Haiku 4.5',
  ]);
});

// ---- the effort levels next to the model ---------------------------------------------------------------

/** The rows of the Effort field, as it shows them: the current one marked with a star. */
const efforts = (opts) =>
  effortChoices(opts).map(({ value, label, current }) => `${current ? '*' : ''}${value}=${label}`);

// What Codex says it has, with the levels each model takes, as far as these tests need.
const CODEX_REPORTED = [
  {
    id: 'gpt-6.1-sol',
    label: 'GPT-6.1-Sol',
    efforts: ['low', 'medium', 'high', 'xhigh'],
    defaultEffort: 'medium',
    default: true,
  },
  { id: 'gpt-6-luna', label: 'GPT-6-Luna', efforts: ['minimal', 'low', 'medium'], defaultEffort: 'low' },
  { id: 'gpt-6-image', label: 'GPT-6-Image' },
];
const codexCatalog = modelCatalog(codex, CODEX_REPORTED);

test("Claude's effort levels are its usual ones until it has said which each model takes", () => {
  assert.deepEqual(efforts({ provider: claude, catalog: modelCatalog(claude, null), model: '' }), [
    '*=Default',
    'low=Low',
    'medium=Medium',
    'high=High',
    'xhigh=Extra high',
    'max=Max',
  ]);
  // A model typed in, that no list knows of yet, takes them too.
  assert.equal(efforts({ provider: claude, catalog: modelCatalog(claude, null), model: 'claude-opus-9' }).length, 6);
});

test("once Claude has said, the levels are the model's own, and its default is the one the account gets", () => {
  const catalog = modelCatalog(claude, [
    { id: 'opus', label: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], default: true },
    { id: 'haiku', label: 'Haiku 4.5' },
  ]);
  assert.equal(efforts({ provider: claude, catalog, model: '' }).length, 6, "the default model is Opus: Opus's levels");
  assert.deepEqual(efforts({ provider: claude, catalog, model: 'opus', picked: 'max' }).at(-1), '*max=Max');
  assert.deepEqual(efforts({ provider: claude, catalog, model: 'haiku' }), [], 'a model that takes none asks none');
});

test('each Codex model has its own levels, and Default names the level that comes to', () => {
  assert.deepEqual(efforts({ provider: codex, catalog: codexCatalog, model: '' }), [
    '*=Default (Medium)',
    'low=Low',
    'medium=Medium',
    'high=High',
    'xhigh=Extra high',
  ]);
  assert.deepEqual(efforts({ provider: codex, catalog: codexCatalog, model: 'gpt-6-luna' }), [
    '*=Default (Low)',
    'minimal=Minimal',
    'low=Low',
    'medium=Medium',
  ]);
  assert.deepEqual(efforts({ provider: codex, catalog: codexCatalog, model: 'gpt-6-image' }), []);
  // Where every model says which levels it takes, one the list doesn't know of can't be said to take any.
  assert.deepEqual(efforts({ provider: codex, catalog: codexCatalog, model: 'gpt-7' }), []);
});

test("Codex's usual levels stand in until it has said which each model takes", () => {
  assert.deepEqual(efforts({ provider: codex, catalog: modelCatalog(codex, null), model: 'gpt-6-luna' }), [
    '*=Default',
    'low=Low',
    'medium=Medium',
    'high=High',
  ]);
});

test('a service without effort levels has no Effort field', () => {
  assert.deepEqual(efforts({ provider: opencode, catalog: modelCatalog(opencode, null), model: '' }), []);
});

test('the level picked stays while the model takes it, and is Default on one that does not', () => {
  const on = (model) =>
    efforts({ provider: codex, catalog: codexCatalog, model, picked: 'xhigh' }).find((row) => row[0] === '*');
  assert.equal(on('gpt-6.1-sol'), '*xhigh=Extra high');
  assert.equal(on('gpt-6-luna'), '*=Default (Low)', 'Luna takes no Extra high: it is left to the model');
  assert.equal(on(''), '*xhigh=Extra high', 'the default model is Sol, which does');
  assert.equal(
    efforts({ provider: codex, catalog: codexCatalog, model: 'gpt-6-luna', picked: 'minimal' })[1],
    '*minimal=Minimal',
    'a level only some models take is offered on those'
  );
});
