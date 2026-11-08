import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chosenPlace, placesFor } from '../src/renderer/contacts/where-picker.js';

const projects = [
  { name: 'api', folder: '/Users/you/code/api' },
  { name: 'shop', folder: '/Users/you/code/shop' },
];

test('Works on lists the projects, and a folder chosen that is none of theirs after them', () => {
  assert.deepEqual(placesFor(projects, ''), projects);
  assert.deepEqual(placesFor(projects, '/Users/you/code/shop'), projects, 'one of them is not listed twice');
  assert.deepEqual(placesFor(projects, '/Users/you/Downloads/new-project/'), [
    ...projects,
    { name: 'new-project', folder: '/Users/you/Downloads/new-project/' },
  ]);
  assert.deepEqual(placesFor([], 'C:\\Users\\you\\notes'), [{ name: 'notes', folder: 'C:\\Users\\you\\notes' }]);
});

test('Works on says what is chosen: This computer, a project by its name, or another folder by its own', () => {
  const label = (chosen) => chosenPlace(projects, chosen).label;
  assert.equal(label({ computer: true, folder: '' }), 'This computer');
  assert.equal(label({ computer: true, folder: '/Users/you/code/shop' }), 'This computer', 'it has no folder');
  assert.equal(label({ computer: false, folder: '/Users/you/code/shop' }), 'shop');
  assert.equal(label({ computer: false, folder: '/Users/you/Downloads/notes' }), 'notes');
  assert.equal(label({ computer: false, folder: '' }), 'Pick a folder...');
  assert.match(chosenPlace(projects, { computer: true, folder: '' }).icon, /data-icon="sm-computer"/);
  assert.match(chosenPlace(projects, { computer: false, folder: '/x/shop' }).icon, /data-icon="sm-folder"/);
});
