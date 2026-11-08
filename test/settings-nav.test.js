import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navRows } from '../src/renderer/settings/nav.js';

const projects = [
  { key: 'git:/work/one/.git', name: 'one' },
  { key: 'git:/work/two/.git', name: 'two' },
  { key: 'dir:/work/notes', name: 'notes' },
];
const rowsFor = (section, project = '', folded = false) => navRows({ projects, page: { section, project }, folded });
const projectRows = (rows) => rows.filter((row) => row.kind === 'project');
const selected = (rows) => rows.flatMap((row) => [row, ...(row.pages || [])]).filter((row) => row.selected);

test('only the current project lists children, with its selected page marked once', () => {
  const rows = rowsFor('scripts', projects[1].key);
  const [one, two, notes] = projectRows(rows);
  assert.equal(one.open, false);
  assert.deepEqual(one.pages, []);
  assert.equal(two.open, true);
  assert.equal(two.expanded, true);
  assert.equal(two.selected, false, 'the parent is accented, not highlighted with its child');
  assert.deepEqual(
    two.pages.map((page) => page.section),
    ['overview', 'scripts', 'instructions', 'project-git', 'project-environment', 'project-fallbacks', 'manager']
  );
  assert.deepEqual(
    selected(rows).map((row) => row.section),
    ['scripts']
  );
  assert.deepEqual(notes.pages, []);
});

test('switching projects folds the previous project and opens the new Overview', () => {
  const rows = projectRows(rowsFor('overview', projects[0].key));
  assert.deepEqual(
    rows.filter((row) => row.expanded).map((row) => row.project),
    [projects[0].key]
  );
  assert.deepEqual(rows[1].pages, []);
  assert.equal(rows[0].pages[0].selected, true);
});

test('folding hides children and marks the parent; unfolding restores the selected child', () => {
  const folded = rowsFor('instructions', projects[1].key, true);
  assert.ok(projectRows(folded).every((row) => !row.expanded && row.pages.length === 0));
  assert.deepEqual(
    selected(folded).map((row) => row.project),
    [projects[1].key]
  );
  assert.equal(selected(folded)[0].open, true);
  assert.deepEqual(
    selected(rowsFor('instructions', projects[1].key)).map((row) => row.section),
    ['instructions']
  );
});

test('folders outside git nest only the pages they support', () => {
  const notes = projectRows(rowsFor('overview', projects[2].key))[2];
  assert.deepEqual(
    notes.pages.map((page) => page.section),
    ['overview', 'scripts', 'instructions', 'project-environment', 'project-fallbacks']
  );
});

test('app pages retain their scope, with no project expanded on their pages', () => {
  for (const section of ['general', 'accounts', 'environment']) {
    const rows = rowsFor(section, projects[0].key);
    assert.deepEqual(
      rows.filter((row) => row.kind === 'heading').map((row) => row.label),
      ['App', 'Agents', 'Every project', 'Projects']
    );
    assert.ok(projectRows(rows).every((row) => !row.open && !row.expanded && !row.pages.length));
    assert.deepEqual(
      selected(rows).map((row) => row.section),
      [section]
    );
  }
});

test('presets are found under Instructions, including when opened by their existing deep link', () => {
  for (const section of ['every-project-instructions', 'instruction-presets']) {
    const rows = rowsFor(section);
    assert.equal(
      rows.some((row) => row.section === 'instruction-presets'),
      false
    );
    const instructions = rows.find((row) => row.section === 'every-project-instructions');
    assert.deepEqual(
      instructions.pages.map((page) => page.section),
      ['instruction-presets']
    );
    assert.deepEqual(
      selected(rows).map((row) => row.section),
      [section]
    );
  }
  assert.deepEqual(rowsFor('general').find((row) => row.section === 'every-project-instructions').pages, []);
  assert.deepEqual(
    rowsFor('instructions', projects[0].key).find((row) => row.section === 'every-project-instructions').pages,
    []
  );
});

test('no projects shows an empty hint; a missing project leaves no orphaned pages', () => {
  const rows = navRows({ projects: [], page: { section: 'general', project: '' } });
  assert.deepEqual(rows.slice(-2), [{ kind: 'heading', label: 'Projects' }, { kind: 'empty' }]);
  assert.ok(projectRows(rowsFor('scripts', 'git:/gone/.git')).every((row) => !row.open && !row.pages.length));
});
