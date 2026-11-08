import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adoptOldData, OLD_NAME } from '../src/main/renamed.js';

/** A folder like ~/Library/Application Support, with a data folder in it for each name given. */
function appData(t, ...names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-renamed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const name of names) {
    fs.mkdirSync(path.join(dir, name, 'history'), { recursive: true });
    fs.writeFileSync(path.join(dir, name, 'messenger.json'), `kept by ${name}`);
    fs.writeFileSync(path.join(dir, name, 'history', 'one.json'), `a conversation in ${name}`);
  }
  return dir;
}

test('the app was called Agent Messenger', () => {
  assert.equal(OLD_NAME, 'Agent Messenger');
});

test('what the app kept under its old name is moved to its new one, with everything in it', (t) => {
  const dir = appData(t, OLD_NAME);
  assert.equal(adoptOldData(dir, 'buddylist'), true);

  assert.deepEqual(fs.readdirSync(dir), ['buddylist']);
  assert.equal(fs.readFileSync(path.join(dir, 'buddylist', 'messenger.json'), 'utf8'), 'kept by Agent Messenger');
  assert.equal(
    fs.readFileSync(path.join(dir, 'buddylist', 'history', 'one.json'), 'utf8'),
    'a conversation in Agent Messenger'
  );
});

test('an app that has data of its own keeps it, and the old folder is left alone', (t) => {
  const dir = appData(t, OLD_NAME, 'buddylist');
  assert.equal(adoptOldData(dir, 'buddylist'), false);

  assert.deepEqual(fs.readdirSync(dir).sort(), ['Agent Messenger', 'buddylist']);
  assert.equal(fs.readFileSync(path.join(dir, 'buddylist', 'messenger.json'), 'utf8'), 'kept by buddylist');
  assert.equal(fs.readFileSync(path.join(dir, OLD_NAME, 'messenger.json'), 'utf8'), 'kept by Agent Messenger');
});

test('a new install has nothing to take along, and no folder is made for it', (t) => {
  const dir = appData(t);
  assert.equal(adoptOldData(dir, 'buddylist'), false);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('a folder that cannot be moved does not stop the app: it starts out empty', (t) => {
  const dir = appData(t, OLD_NAME);
  t.mock.method(fs, 'renameSync', () => {
    throw new Error('EPERM: operation not permitted');
  });
  assert.equal(adoptOldData(dir, 'buddylist'), false);
  assert.deepEqual(fs.readdirSync(dir), ['Agent Messenger']);
});
