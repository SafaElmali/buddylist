import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answeringBadge,
  badgeItems,
  effortByEntry,
  effortByItems,
  effortByLabel,
  effortByNotice,
  effortItems,
  effortName,
  effortTitle,
  fastModeBadge,
  fastModeItems,
  modelName,
  modelsFor,
  serviceItems,
} from '../src/renderer/chat/models.js';
import {
  EFFORT_BY_FIRST,
  EFFORT_LEVELS,
  currentModel,
  effortAfterSwitch,
  effortLabel,
  effortsOf,
  modelCatalog,
  nearestEffort,
  shownModelIds,
  withDefaultNamed,
} from '../src/shared/models.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as codex } from '../src/providers/codex/descriptor.js';
import { descriptor as gemini } from '../src/providers/gemini/descriptor.js';

// What Claude Code says it has, as its provider passes it on: the model an account
// gets by itself, one with fewer effort levels, and one that takes none.
const OPUS = { id: 'opus', label: 'Opus 5.5', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], default: true };
const SONNET = { id: 'sonnet', label: 'Sonnet 5.5', efforts: ['low', 'medium', 'high'] };
const HAIKU = { id: 'haiku', label: 'Haiku 4.5' };
const REPORTED = [OPUS, SONNET, HAIKU];

/** Every model known for Claude: once it has said, and before. */
const SAID = modelCatalog(claude, REPORTED);
const BUILT_IN = modelCatalog(claude, null);

// What the conversation window knows of someone: the provider, and the contact's own choices.
const who = (extra = {}) => ({ provider: claude, model: '', defaultModel: null, models: [], effort: null, ...extra });
const labels = (items) => items.map((item) => item.label);
const checked = (items) => items.filter((item) => item.checked).map((item) => item.label);

// ---- which models there are --------------------------------------------------------------------

test('a contact’s models are its provider’s, as “Add a Contact” has them', () => {
  const known = { catalog: SAID, shown: shownModelIds(claude, {}) };
  assert.equal(modelsFor(who(), known), known);
});

test('a session that says which models it has is believed, and they are all offered', () => {
  const said = [
    { id: 'auto', label: 'Auto' },
    { id: 'gemini-3-pro', label: 'Gemini 3 Pro' },
  ];
  const known = { catalog: modelCatalog(gemini, null), shown: shownModelIds(gemini, {}) };
  const { catalog, shown } = modelsFor(who({ provider: gemini, models: said }), known);
  assert.deepEqual(
    catalog.map((model) => model.id),
    ['', 'auto', 'gemini-3-pro'],
    'after the provider’s default'
  );
  assert.deepEqual(shown, ['auto', 'gemini-3-pro']);
});

// ---- which model it is -------------------------------------------------------------------------

test('the model a contact was given is the one it answers with', () => {
  assert.equal(currentModel(who({ model: 'sonnet' }), SAID), SONNET);
  assert.equal(currentModel(who({ model: 'sonnet', defaultModel: 'haiku' }), SAID), SONNET);
});

test('given none, it answers with the one its session started with, or else its provider’s own pick', () => {
  assert.equal(currentModel(who({ defaultModel: 'haiku' }), SAID), HAIKU);
  assert.equal(currentModel(who(), SAID), OPUS);
  assert.equal(currentModel(who(), BUILT_IN), undefined, 'no telling from a list that doesn’t say');
  assert.equal(currentModel(who({ defaultModel: 'opus' }), BUILT_IN).label, 'Opus');
});

test('a model the list doesn’t have is not described, and “Default” is never taken for one', () => {
  assert.equal(currentModel(who({ model: 'claude-opus-4-8' }), SAID), undefined);
  assert.equal(currentModel(who({ defaultModel: 'claude-opus-4-8' }), [SONNET]), undefined);
  assert.equal(currentModel(who(), modelCatalog(claude, [SONNET])), undefined);
});

test('the badge names the model where the list has it, and says what the contact was given where not', () => {
  assert.equal(modelName(who(), BUILT_IN), 'Default model');
  assert.equal(modelName(who({ model: 'opus' }), BUILT_IN), 'Opus');
  assert.equal(modelName(who(), SAID), 'Opus 5.5');
  assert.equal(modelName(who({ defaultModel: 'haiku' }), SAID), 'Haiku 4.5');
  assert.equal(modelName(who({ model: 'sonnet', defaultModel: 'haiku' }), SAID), 'Sonnet 5.5');
  assert.equal(modelName(who({ model: 'claude-opus-4-8' }), SAID), 'claude-opus-4-8', 'one typed in by hand');
});

test('the list says next to “Default” which model that comes to, once that is known', () => {
  const label = (state, catalog) => withDefaultNamed(state, catalog)[0].label;
  assert.equal(label(who(), BUILT_IN), 'Default');
  assert.equal(label(who(), SAID), 'Default (Opus 5.5)');
  assert.equal(label(who({ defaultModel: 'sonnet' }), SAID), 'Default (Sonnet 5.5)');
  // What the default comes to stays known while the contact is on a model of its own.
  assert.equal(label(who({ model: 'haiku', defaultModel: 'sonnet' }), SAID), 'Default (Sonnet 5.5)');
  const named = withDefaultNamed(who(), SAID);
  assert.equal(named[0].hint, 'From your Claude settings');
  assert.deepEqual(named.slice(1), SAID.slice(1), 'the models themselves are as they were');
  assert.equal(SAID[0].hint, 'From your Claude settings', 'and so is the list it was made from');
});

// ---- effort levels -----------------------------------------------------------------------------

test('the effort levels to choose from are those of the model it answers with', () => {
  assert.deepEqual(effortsOf(who(), claude, SAID), OPUS.efforts);
  assert.deepEqual(effortsOf(who({ model: 'sonnet' }), claude, SAID), SONNET.efforts);
  assert.deepEqual(effortsOf(who({ defaultModel: 'sonnet' }), claude, SAID), SONNET.efforts);
  assert.deepEqual(effortsOf(who({ model: 'haiku' }), claude, SAID), [], 'a model that takes none');
  assert.deepEqual(effortsOf(who({ model: 'claude-opus-4-8' }), claude, SAID), [], 'a model the list doesn’t have');
});

test('from a list that doesn’t say which levels a model takes, they are the provider’s usual ones', () => {
  assert.deepEqual(effortsOf(who(), claude, BUILT_IN), ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(effortsOf(who({ model: 'haiku' }), claude, BUILT_IN), claude.efforts);
  assert.deepEqual(effortsOf(who({ provider: codex }), codex, modelCatalog(codex, null)), ['low', 'medium', 'high']);
  // A provider without effort levels: before its session names its models, and after.
  assert.deepEqual(effortsOf(who({ provider: gemini }), gemini, modelCatalog(gemini, null)), []);
  assert.deepEqual(
    effortsOf(who({ provider: gemini }), gemini, modelCatalog(gemini, [{ id: 'auto', label: 'Auto' }])),
    []
  );
});

test('a level is called by its name, and “xhigh” in words', () => {
  assert.deepEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].map(effortLabel), [
    'Low',
    'Medium',
    'High',
    'Extra high',
    'Max',
    'Ultra',
  ]);
});

test('the badge says the effort level, or that it is left to the model', () => {
  assert.equal(effortName(who({ effort: 'xhigh' }), SAID), 'Extra high');
  assert.equal(effortName(who(), SAID), 'Default effort');
  assert.equal(effortName(who({ effort: 'low' }), BUILT_IN), 'Low', 'before the provider has said, too');
});

test('there is no effort badge or menu where there is none to choose', () => {
  const geminis = modelCatalog(gemini, null);
  for (const [nothing, catalog] of [
    [who({ model: 'haiku' }), SAID],
    // Not even for a level left on the contact from another model.
    [who({ model: 'haiku', effort: 'high' }), SAID],
    [who({ provider: gemini }), geminis],
    [who({ provider: gemini, effort: 'high' }), geminis],
  ]) {
    assert.equal(effortName(nothing, catalog), null);
    assert.deepEqual(
      effortItems(nothing, catalog, () => {}),
      []
    );
  }
});

test('the effort menu has the model’s levels after its default, with the current one checked', () => {
  const items = effortItems(who({ model: 'sonnet', effort: 'medium' }), SAID, () => {});
  assert.deepEqual(labels(items), ['Default', 'Low', 'Medium', 'High']);
  assert.deepEqual(checked(items), ['Medium']);
  assert.deepEqual(checked(effortItems(who(), SAID, () => {})), ['Default'], 'while it is left to the model');
});

test('next to Default is the level it comes to, where the list says', () => {
  const [usual] = effortItems(who({ model: 'sonnet' }), [{ ...SONNET, defaultEffort: 'xhigh' }], () => {});
  assert.equal(usual.label, 'Default (Extra high)');
  assert.equal(usual.hint, undefined);
  assert.equal(effortItems(who(), SAID, () => {})[0].hint, 'The model’s own level', 'when the service cannot say');
});

test('the effort badge and its title name a resolved default without saving an explicit level', () => {
  const catalog = modelCatalog(claude, [{ ...OPUS, defaultEffort: 'high' }, SONNET]);
  assert.equal(effortName(who(), catalog), 'Default (High)');
  assert.equal(effortTitle(who(), effortName(who(), catalog)), 'Effort: Default (High)');
  assert.equal(effortName(who({ effort: 'low' }), catalog), 'Low');
});

test('a level the usual ones leave out is listed while the contact has it', () => {
  const items = effortItems(who({ provider: codex, effort: 'xhigh' }), modelCatalog(codex, null), () => {});
  assert.deepEqual(labels(items), ['Default', 'Low', 'Medium', 'High', 'Extra high']);
  assert.deepEqual(checked(items), ['Extra high']);
  assert.deepEqual(codex.efforts, ['low', 'medium', 'high'], 'and the provider’s list is left alone');
});

test('choosing an effort level passes on its id, not its label, and Default none', () => {
  const chosen = [];
  for (const item of effortItems(who(), SAID, (id) => chosen.push(id))) item.action();
  assert.deepEqual(chosen, [null, 'low', 'medium', 'high', 'xhigh', 'max']);
});

// ---- switching model ---------------------------------------------------------------------------

test('after a switch, an effort level the new model takes is kept', () => {
  assert.equal(effortAfterSwitch('high', SONNET), 'high');
  assert.equal(effortAfterSwitch(null, SONNET), null, 'none was chosen, and none is');
});

test('one it doesn’t take makes way for the model’s own, or is left to the model', () => {
  assert.equal(effortAfterSwitch('max', { ...SONNET, defaultEffort: 'medium' }), 'medium');
  assert.equal(effortAfterSwitch('max', SONNET), null, 'a model that doesn’t say which is its own');
});

test('a model without levels, or one the list doesn’t have, leaves the level alone', () => {
  assert.equal(effortAfterSwitch('max', HAIKU), 'max');
  assert.equal(effortAfterSwitch('max', undefined), 'max');
});

// ---- the agents picking their effort themselves ------------------------------------------------

test('an agent given a level it takes answers with it', () => {
  for (const level of OPUS.efforts) assert.equal(nearestEffort(level, OPUS.efforts), level);
  assert.equal(nearestEffort('ultra', ['low', 'ultra']), 'ultra', 'also one nobody else has heard of');
});

test('given a level it does not take, it gets the nearest one it does', () => {
  assert.equal(nearestEffort('max', SONNET.efforts), 'high');
  assert.equal(nearestEffort('xhigh', SONNET.efforts), 'high');
  assert.equal(nearestEffort('minimal', SONNET.efforts), 'low');
  assert.equal(nearestEffort('none', OPUS.efforts), 'low');
  assert.equal(nearestEffort('high', ['minimal', 'max']), 'max');
  assert.equal(nearestEffort('medium', ['low', 'high']), 'low', 'the lower of two as near');
  assert.equal(nearestEffort('low', ['minimal', 'medium']), 'minimal');
});

test('what is no level, or an agent that takes none, gets nothing', () => {
  assert.equal(nearestEffort('level', OPUS.efforts), null, 'the word the effort check shows in its example');
  assert.equal(nearestEffort('', OPUS.efforts), null);
  assert.equal(nearestEffort('high', []), null);
  assert.equal(nearestEffort('high', ['ultra']), null, 'none it takes can be told from another');
});

test('the levels it takes are left as they were', () => {
  const takes = ['low', 'medium', 'high'];
  nearestEffort('max', takes);
  assert.deepEqual(takes, ['low', 'medium', 'high']);
  assert.deepEqual(EFFORT_LEVELS, ['low', 'medium', 'high', 'xhigh', 'max'], 'the ones agents are told about');
});

const HERE = [
  { id: 'c1', name: 'Claude' },
  { id: 'c2', name: 'Codex' },
];

test('who picks the effort levels is chosen from: nobody but you, whoever answers first, or an agent here', () => {
  const off = effortByItems(HERE, null, () => {});
  assert.deepEqual(labels(off), ['Off', 'Whoever answers first', 'Claude', 'Codex']);
  assert.deepEqual(checked(off), ['Off']);
  assert.deepEqual(checked(effortByItems(HERE, undefined, () => {})), ['Off'], 'a contact that was never asked');
  assert.deepEqual(checked(effortByItems(HERE, EFFORT_BY_FIRST, () => {})), ['Whoever answers first']);
  assert.deepEqual(checked(effortByItems(HERE, 'c2', () => {})), ['Codex']);
  assert.deepEqual(checked(effortByItems(HERE, 'gone', () => {})), ['Whoever answers first'], 'an agent that left');
});

test('choosing who picks passes on an id, "first", or null for you', () => {
  const chosen = [];
  for (const item of effortByItems(HERE, null, (by) => chosen.push(by))) item.action();
  assert.deepEqual(chosen, [null, 'first', 'c1', 'c2']);
  assert.equal(EFFORT_BY_FIRST, 'first');
});

test('the menu and the conversation say who picks the effort levels', () => {
  assert.deepEqual(
    [null, undefined, EFFORT_BY_FIRST, 'c2', 'gone'].map((by) => effortByLabel(HERE, by)),
    ['Off', 'Off', 'Whoever answers first', 'Codex', 'Whoever answers first']
  );
  assert.equal(effortByNotice(HERE, null), 'The effort levels are yours to set again.');
  assert.equal(
    effortByNotice(HERE, EFFORT_BY_FIRST),
    'The agents pick their own effort levels now: whoever answers first does, before they start on a message.'
  );
  assert.equal(
    effortByNotice(HERE, 'c2'),
    'The agents pick their own effort levels now: Codex does, before they start on a message.'
  );
});

test('a level the agents picked says so when its badge is pointed at', () => {
  assert.equal(effortTitle(who(), 'Default effort'), 'Effort: left to the model');
  assert.equal(effortTitle(who({ effort: 'high' }), 'High'), 'Effort: High');
  assert.equal(
    effortTitle(who({ effort: 'high', effortPicked: true }), 'High'),
    'Effort: High, picked for it in this conversation'
  );
});

test('with several agents here the Effort menu offers who decides, and for one alone a tick', () => {
  const several = effortByEntry(HERE, 'c2', () => {});
  assert.equal(several.label, 'Let the agents decide: Codex');
  assert.deepEqual(labels(several.submenu), ['Off', 'Whoever answers first', 'Claude', 'Codex']);
  assert.deepEqual(checked(several.submenu), ['Codex']);
  assert.equal('action' in several, false);

  const chosen = [];
  const [alone] = HERE;
  const off = effortByEntry([alone], null, (by) => chosen.push(by));
  assert.deepEqual([off.label, off.checked, 'submenu' in off], ['Let Claude decide', false, false]);
  off.action();
  const on = effortByEntry([alone], EFFORT_BY_FIRST, (by) => chosen.push(by));
  assert.equal(on.checked, true);
  on.action();
  assert.deepEqual(chosen, ['first', null], 'ticking turns it on, ticking again gives it back to you');
  assert.equal(effortByEntry([alone], 'c1', () => {}).checked, true, 'also when it was named in a group it left');
});

test('for a contact on its own the conversation says that it picks for itself', () => {
  const [alone] = HERE;
  assert.equal(
    effortByNotice([alone], EFFORT_BY_FIRST),
    'Claude picks its own effort level now, before it starts on a message.'
  );
  assert.equal(effortByNotice([alone], null), 'The effort level is yours to set again.');
});

// ---- fast mode ---------------------------------------------------------------------------------

// Claude Code's list once it says which models have fast mode: Opus does, Sonnet and Haiku don't.
const FAST = modelCatalog(claude, [{ ...OPUS, fast: true }, SONNET, HAIKU]);
const fastOn = (fastModeStatus = null) => who({ model: 'opus', fastMode: true, fastModeStatus });

const CODEX_FAST = modelCatalog(codex, [
  { id: 'codex-fast', label: 'Codex test', default: true, fast: true, fastDescription: '2x speed, increased usage' },
  { id: 'codex-standard', label: 'Standard test', fastUnavailable: 'This model does not offer Fast mode.' },
]);

test('Codex model controls expose provider speed and usage separately from effort, also for managers and guests', () => {
  for (const model of ['', 'codex-fast']) {
    const contact = who({ provider: codex, model, effort: 'high', fastMode: false });
    const selected = [];
    const [item] = fastModeItems(contact, CODEX_FAST, (on) => selected.push(on));
    assert.equal(item.label, 'Fast mode');
    assert.equal(item.checked, false);
    assert.equal(item.hint, '2x speed, increased usage');
    item.action();
    assert.deepEqual(selected, [true]);
    assert.equal(contact.effort, 'high');
    const managerMenu = badgeItems(
      serviceItems({ manages: 'demo' }, contact, [codex], () => {}),
      [item]
    );
    assert.equal(managerMenu.at(-1), item, 'same toggle in the manager’s model controls');
    const [guest] = fastModeItems({ ...contact, fastMode: true }, CODEX_FAST, (on) => selected.push(on), 'Guest');
    assert.equal(guest.label, 'Guest');
    guest.action();
    assert.deepEqual(selected, [true, false]);
    assert.match(answeringBadge(contact, CODEX_FAST, { service: true }).title, /Service: Codex[\s\S]*increased usage/);
  }
});

test('Codex defaults stay identified as inherited until the user chooses a speed', () => {
  const inherited = who({ provider: codex, model: 'codex-fast', fastModeInherited: true, fastMode: true });
  const [item] = fastModeItems(inherited, CODEX_FAST, () => {});
  assert.equal(item.checked, true, 'the live session can report an inherited priority tier');
  assert.match(item.hint, /From Codex settings/);
  assert.match(fastModeBadge(inherited, CODEX_FAST).title, /from your Codex settings/);
  assert.match(fastModeBadge({ ...inherited, fastModeInherited: undefined }, CODEX_FAST).title, /Fast mode: on/);
});

test('Codex speed descriptions still disclose increased usage when its catalog names only speed', () => {
  const contact = who({ provider: codex, model: 'speed-only' });
  const catalog = [{ id: 'speed-only', label: 'Speed only', fast: true, fastDescription: '1.5x speed' }];
  const [item] = fastModeItems(contact, catalog, () => {});
  assert.match(item.hint, /1.5x speed; increased usage/);
  assert.match(fastModeBadge(contact, catalog).title, /increased usage/);
});

test('Codex unsupported models and unknown versions explain disabled Fast mode without promising support', () => {
  for (const model of ['codex-standard', 'unknown-model']) {
    const contact = who({ provider: codex, model, fastMode: false });
    const selected = [];
    const [item, note] = fastModeItems(contact, CODEX_FAST, (on) => selected.push(on));
    assert.equal(item.disabled, true);
    assert.equal(item.hint, 'Unavailable');
    assert.equal(note.note, true);
    assert.match(note.label, /Fast mode unavailable/);
    item.action();
    assert.deepEqual(selected, []);
    const [off] = fastModeItems({ ...contact, fastMode: true }, CODEX_FAST, (on) => selected.push(on));
    assert.equal(off.disabled, undefined, 'a saved choice can still be turned off');
    off.action();
    assert.deepEqual(selected, [false]);
  }
  const [item, note] = fastModeItems(who({ provider: codex }), modelCatalog(codex), () => {});
  assert.equal(item.disabled, true, 'built-in suggestions never claim support');
  assert.match(note.label, /Refresh Models or update Codex/);
});

test('only a model with fast mode has a badge for it', () => {
  for (const nothing of [
    who({ model: 'sonnet' }),
    who({ model: 'haiku', fastMode: true }),
    who({ model: 'claude-something-else' }),
  ]) {
    assert.equal(fastModeBadge(nothing, FAST), null);
  }
  assert.equal(fastModeBadge(who({ model: 'opus' }), SAID), null, 'from a list that says nothing of fast mode');
  assert.equal(fastModeBadge(who({ provider: gemini }), modelCatalog(gemini, null)), null);
});

test('given no model, the badge goes by the one that default comes to', () => {
  assert.notEqual(fastModeBadge(who(), FAST), null, 'Opus is the one the account gets');
  assert.equal(fastModeBadge(who({ defaultModel: 'sonnet' }), FAST), null, 'once a session started on Sonnet');
});

test('before Claude Code is asked, its built-in Opus has fast mode', () => {
  assert.notEqual(fastModeBadge(who({ model: 'opus' }), BUILT_IN), null);
  assert.equal(fastModeBadge(who({ model: 'sonnet' }), BUILT_IN), null);
});

test('the badge is pressed while fast mode is on, and says what it does', () => {
  assert.deepEqual(fastModeBadge(who({ model: 'opus' }), FAST), {
    pressed: false,
    held: false,
    title: 'Fast mode: off. Faster answers, at a higher price',
  });
  const on = { pressed: true, held: false, title: 'Fast mode: on. Faster answers, at a higher price' };
  assert.deepEqual(fastModeBadge(fastOn(), FAST), on, 'before its session has said anything of it');
  assert.deepEqual(fastModeBadge(fastOn({ state: 'on' }), FAST), on);
});

test('while a rate limit pauses fast mode, the badge says so', () => {
  assert.deepEqual(fastModeBadge(fastOn({ state: 'cooldown' }), FAST), {
    pressed: true,
    held: true,
    title: 'Fast mode: paused after a rate limit. It comes back on by itself',
  });
});

test('while something keeps fast mode from coming on, the badge says what', () => {
  const held = (reason) => fastModeBadge(fastOn({ state: 'off', reason }), FAST);
  assert.deepEqual(held('extra_usage_disabled'), {
    pressed: true,
    held: true,
    title:
      'Fast mode is on, but it needs usage credits, and they are off for this account: Claude answers at its usual speed',
  });
  assert.match(held('free').title, /it needs a paid plan/);
  assert.match(held('preference').title, /your organization turned it off/);
  // Still being checked, or a reason it doesn't know: nothing is said to hold it back.
  assert.equal(held('pending').held, false);
  assert.equal(held('something-new').held, false);
  assert.equal(fastModeBadge(fastOn({ state: 'off' }), FAST).held, false);
});

test('what held fast mode back is not shown while it is off', () => {
  const off = who({ model: 'opus', fastModeStatus: { state: 'off', reason: 'sdk_opt_in_required' } });
  assert.deepEqual(fastModeBadge(off, FAST), {
    pressed: false,
    held: false,
    title: 'Fast mode: off. Faster answers, at a higher price',
  });
});

// ---- the badge under the conversation ----------------------------------------------------------

test('the badge under the conversation names the model, and the effort level once one is set', () => {
  assert.equal(answeringBadge(who({ model: 'opus', effort: 'high' }), SAID).label, 'Opus 5.5 · High');
  assert.equal(answeringBadge(who({ model: 'opus' }), SAID).label, 'Opus 5.5', 'a level left to the model goes unsaid');
  assert.equal(
    answeringBadge(who({ model: 'haiku', effort: 'high' }), SAID).label,
    'Haiku 4.5',
    'a model without levels'
  );
  assert.equal(answeringBadge(who({ model: 'my-own-model' }), SAID).label, 'my-own-model', 'a model typed in by hand');
  assert.equal(answeringBadge(who({ provider: gemini }), modelCatalog(gemini, null)).label, 'Default model');
});

test('pointed at, the badge says the model, the effort level and fast mode, each on a line', () => {
  assert.equal(
    answeringBadge(who({ model: 'opus', effort: 'high', effortPicked: true }), FAST).title,
    [
      'Model: Opus 5.5',
      'Effort: High, picked for it in this conversation',
      'Fast mode: off. Faster answers, at a higher price',
    ].join('\n')
  );
  assert.equal(answeringBadge(who({ model: 'opus' }), SAID).title, 'Model: Opus 5.5\nEffort: left to the model');
  assert.equal(answeringBadge(who({ model: 'haiku' }), FAST).title, 'Model: Haiku 4.5', 'nothing else to say');
});

test('the badge has a bolt while fast mode is on, faint while something holds it back', () => {
  const boltOf = (state) => {
    const { bolt, held } = answeringBadge(state, FAST);
    return { bolt, held };
  };
  assert.deepEqual(boltOf(who({ model: 'opus' })), { bolt: false, held: false });
  assert.deepEqual(boltOf(fastOn()), { bolt: true, held: false });
  assert.deepEqual(boltOf(fastOn({ state: 'cooldown' })), { bolt: true, held: true });
  assert.deepEqual(
    boltOf(who({ model: 'sonnet', fastMode: true })),
    { bolt: false, held: false },
    'a model without it'
  );
});

test('pointed at, a manager’s badge says its service first', () => {
  assert.equal(
    answeringBadge(who({ model: 'opus' }), SAID, { service: true }).title,
    'Service: Claude\nModel: Opus 5.5\nEffort: left to the model'
  );
  assert.equal(
    answeringBadge(who({ model: 'opus' }), SAID).title.split('\n')[0],
    'Model: Opus 5.5',
    'any other contact'
  );
});

// ---- a manager's services, under its badge ------------------------------------------------------

const PROVIDERS = [
  { id: 'claude', name: 'Claude', avatar: 'claude', appTools: true },
  { id: 'codex', name: 'Codex', avatar: 'codex', appTools: true },
  { id: 'cursor', name: 'Cursor', avatar: 'cursor' },
  { id: 'gemini', name: 'Gemini', avatar: 'gemini', appTools: true },
];
const MANAGER = { manages: 'git:/w/shop/.git' };

test('a manager’s badge lists each service with the app’s tools, its own ticked', () => {
  const items = serviceItems(
    MANAGER,
    who(),
    PROVIDERS,
    () => {},
    (avatar) => `<svg id="${avatar}"/>`
  );
  assert.deepEqual(
    items.map(({ label, checked, icon }) => [label, checked, icon]),
    [
      ['Claude', true, '<svg id="claude"/>'],
      ['Codex', false, '<svg id="codex"/>'],
      ['Gemini', false, '<svg id="gemini"/>'],
    ],
    'not one that can’t give it the manager’s tools'
  );
  assert.deepEqual(
    serviceItems(MANAGER, who({ provider: codex }), PROVIDERS, () => {}).map(({ checked }) => checked),
    [false, true, false],
    'after a switch, the one it answers with now'
  );
});

test('picking another service switches the manager, and its own does nothing', () => {
  const picked = [];
  const items = serviceItems(MANAGER, who(), PROVIDERS, (provider) => picked.push(provider.id));
  for (const item of items) item.action();
  assert.deepEqual(picked, ['codex', 'gemini']);
});

test('any other contact has no services under its badge: a chat with another is a contact of its own', () => {
  assert.deepEqual(
    serviceItems({}, who(), PROVIDERS, () => {}),
    []
  );
  assert.deepEqual(
    serviceItems({ manages: '' }, who(), PROVIDERS, () => {}),
    []
  );
});

test('the badge opens the services, then the model’s entries, or goes straight to the models', () => {
  const model = { label: 'Model...' };
  const effort = { label: 'Effort', submenu: [] };
  const services = serviceItems(MANAGER, who(), PROVIDERS, () => {});
  assert.deepEqual(labels(badgeItems(services, [model, effort])), [
    'Claude',
    'Codex',
    'Gemini',
    undefined,
    'Model...',
    'Effort',
  ]);
  assert.equal(badgeItems(services, [model]).at(3).separator, true);
  assert.deepEqual(
    labels(badgeItems(services, [model])),
    ['Claude', 'Codex', 'Gemini', undefined, 'Model...'],
    'a manager’s menu opens even with nothing but the model to pick'
  );
  assert.deepEqual(badgeItems([], [model, effort]), [model, effort], 'any other contact');
  assert.equal(badgeItems([], [model]), null, 'nothing but the model: the list of models');
});
