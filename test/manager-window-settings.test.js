import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { cleanManager, managerSettingsOf } from '../src/shared/managers.js';

const source = readFileSync(new URL('../src/renderer/chat/main.js', import.meta.url), 'utf8');
// What a manager's window does when its project changes, as the window has it, without booting the rest of it.
const onProject = source.match(/^ {2}api\.on\.project\(\(\{ key, settings \}\) => \{[\s\S]*?\n {2}\}\);$/m)[0];

const KEY = 'git:/Users/example/code/shop/.git';
const FIRST = cleanManager({ id: 'm-shop', on: true, model: 'sonnet', brief: 'Ship the CSV export.' });
const RELEASE = cleanManager({ id: 'm-release', on: true, model: 'opus', brief: 'Release notes for v2.' });
const LEAD = cleanManager({ id: 'm-lead', on: true, model: 'sonnet', brief: 'Hand work between the managers.' });

/** A manager's window, as loadManaged leaves it: its project, with the settings of the manager it is. */
function windowOf(contactId, own) {
  let changed = null;
  const shown = [];
  const context = vm.createContext({
    ctx: { contactId },
    managed: { key: KEY, name: 'shop', settings: own },
    brief: { set: (project) => shown.push(project.settings.brief) },
    api: { on: { project: (handler) => (changed = handler) } },
    managerSettingsOf,
  });
  vm.runInContext(onProject, context);
  return {
    /** The project changed, as the app broadcasts it: every manager's settings, the first's and the others'. */
    change: (settings, key = KEY) => changed({ key, settings }),
    managed: () => context.managed,
    shown,
  };
}

const project = ({ release = RELEASE, lead = LEAD } = {}) => ({ manager: FIRST, managers: [release, lead] });

test('a second manager’s window keeps its own settings and brief when its project changes', () => {
  const win = windowOf(RELEASE.id, RELEASE);
  const saved = { ...RELEASE, brief: 'Release notes for v2, with the migration guide.' };
  win.change(project({ release: saved }));
  assert.equal(win.managed().settings.id, RELEASE.id, 'Team > Turn off manager turns off this one, not the first');
  assert.equal(win.managed().settings.model, 'opus');
  assert.deepEqual(win.shown, [saved.brief], 'the Brief tab shows its own brief');
});

test('a project manager’s window keeps its own settings and brief when its project changes', () => {
  const win = windowOf(LEAD.id, LEAD);
  win.change(project());
  assert.equal(win.managed().settings.id, LEAD.id);
  assert.deepEqual(win.shown, [LEAD.brief]);
});

test('the first manager’s window goes on with the first manager’s settings', () => {
  const win = windowOf(FIRST.id, FIRST);
  const saved = { ...FIRST, on: false };
  win.change({ manager: saved, managers: [RELEASE, LEAD] });
  assert.equal(win.managed().settings.id, FIRST.id);
  assert.equal(win.managed().settings.on, false, 'Turn off manager is greyed out once it is off');
  assert.deepEqual(win.shown, [FIRST.brief]);
});

test('another project’s change leaves a manager’s window as it was', () => {
  const win = windowOf(RELEASE.id, RELEASE);
  win.change({ manager: cleanManager({}), managers: [] }, 'git:/Users/example/code/blog/.git');
  assert.equal(win.managed().settings, RELEASE);
  assert.deepEqual(win.shown, []);
});
