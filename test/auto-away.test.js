import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutoAway, AWAY_AFTER_SECONDS } from '../src/main/auto-away.js';

/** An AutoAway on a fake computer: set `idle`, `status` and `enabled`, then call check(). */
function setup({ status = 'online', enabled = true } = {}) {
  const world = { idle: 0, status, enabled, changes: [] };
  const autoAway = new AutoAway({
    idleSeconds: () => world.idle,
    enabled: () => world.enabled,
    getStatus: () => world.status,
    setStatus: (next) => {
      world.changes.push(next);
      world.status = next;
    },
  });
  /** What the Status menu does. */
  const pick = (next) => {
    world.status = next;
    autoAway.statusPicked();
  };
  return { world, autoAway, pick };
}

test('you count as away after five minutes without input', () => {
  assert.equal(AWAY_AFTER_SECONDS, 300);
});

test('an idle computer shows you as Away, once', () => {
  const { world, autoAway } = setup();
  world.idle = AWAY_AFTER_SECONDS - 1;
  autoAway.check();
  assert.deepEqual(world.changes, [], 'not yet');

  world.idle = AWAY_AFTER_SECONDS;
  autoAway.check();
  assert.deepEqual(world.changes, ['away']);

  world.idle = AWAY_AFTER_SECONDS + 600;
  autoAway.check();
  autoAway.check();
  assert.deepEqual(world.changes, ['away'], 'it is not set again while you stay away');
});

test('you are back Online as soon as you touch the computer again', () => {
  const { world, autoAway } = setup();
  world.idle = AWAY_AFTER_SECONDS;
  autoAway.check();
  world.idle = 2;
  autoAway.check();
  assert.deepEqual(world.changes, ['away', 'online']);

  autoAway.check();
  assert.deepEqual(world.changes, ['away', 'online'], 'and that is said once');
});

test('it works again the next time you leave', () => {
  const { world, autoAway } = setup();
  for (const idle of [AWAY_AFTER_SECONDS, 0, AWAY_AFTER_SECONDS + 5, 1]) {
    world.idle = idle;
    autoAway.check();
  }
  assert.deepEqual(world.changes, ['away', 'online', 'away', 'online']);
});

test('an active computer changes nothing', () => {
  const { world, autoAway } = setup();
  for (const idle of [0, 30, 299, 0]) {
    world.idle = idle;
    autoAway.check();
  }
  assert.deepEqual(world.changes, []);
});

test('a status you picked by hand is never replaced by Away', () => {
  for (const status of ['busy', 'brb', 'away', 'phone', 'lunch', 'offline']) {
    const { world, autoAway } = setup({ status });
    world.idle = AWAY_AFTER_SECONDS * 2;
    autoAway.check();
    assert.deepEqual(world.changes, [], status);
  }
});

test('an Away you picked by hand is not undone when you are active', () => {
  const { world, autoAway } = setup({ status: 'away' });
  world.idle = AWAY_AFTER_SECONDS;
  autoAway.check();
  world.idle = 0;
  autoAway.check();
  assert.deepEqual(world.changes, []);
  assert.equal(world.status, 'away');
});

test('picking a status while the idle time is still counting keeps that status', () => {
  const { world, autoAway, pick } = setup();
  world.idle = AWAY_AFTER_SECONDS - 10;
  autoAway.check();
  pick('busy');
  world.idle = AWAY_AFTER_SECONDS + 10;
  autoAway.check();
  world.idle = 0;
  autoAway.check();
  assert.deepEqual(world.changes, []);
  assert.equal(world.status, 'busy');
});

test('picking another status while shown as Away keeps it when you are active again', () => {
  for (const status of ['busy', 'brb', 'phone', 'lunch', 'offline']) {
    const { world, autoAway, pick } = setup();
    world.idle = AWAY_AFTER_SECONDS;
    autoAway.check();
    pick(status);
    world.idle = 0;
    autoAway.check();
    assert.deepEqual(world.changes, ['away'], status);
    assert.equal(world.status, status);
  }
});

test('picking Away yourself while shown as Away makes it yours', () => {
  const { world, autoAway, pick } = setup();
  world.idle = AWAY_AFTER_SECONDS;
  autoAway.check();
  pick('away');
  world.idle = 0;
  autoAway.check();
  assert.deepEqual(world.changes, ['away']);
  assert.equal(world.status, 'away');
});

test('picking Online yourself while shown as Away is not repeated', () => {
  const { world, autoAway, pick } = setup();
  world.idle = AWAY_AFTER_SECONDS;
  autoAway.check();
  pick('online');
  world.idle = 0;
  autoAway.check();
  assert.deepEqual(world.changes, ['away']);

  world.idle = AWAY_AFTER_SECONDS;
  autoAway.check();
  assert.deepEqual(world.changes, ['away', 'away'], 'and going away works again');
});

test('a status that changed without a word is still left alone', () => {
  const { world, autoAway } = setup();
  world.idle = AWAY_AFTER_SECONDS;
  autoAway.check();
  world.status = 'busy'; // not through statusPicked()
  world.idle = 0;
  autoAway.check();
  assert.deepEqual(world.changes, ['away']);

  // Even if it reads Away again later, it is no longer the Away set here.
  world.status = 'away';
  autoAway.check();
  assert.deepEqual(world.changes, ['away']);
});

test('with the setting off, nothing happens however long you are gone', () => {
  const { world, autoAway } = setup({ enabled: false });
  world.idle = AWAY_AFTER_SECONDS * 10;
  autoAway.check();
  world.idle = 0;
  autoAway.check();
  assert.deepEqual(world.changes, []);
});

test('the setting turned off before the five minutes are up cancels going away', () => {
  const { world, autoAway } = setup();
  world.idle = AWAY_AFTER_SECONDS - 60;
  autoAway.check();
  world.enabled = false;
  world.idle = AWAY_AFTER_SECONDS + 60;
  autoAway.check();
  assert.deepEqual(world.changes, []);
});

test('the setting turned off while shown as Away still brings you back', () => {
  const { world, autoAway } = setup();
  world.idle = AWAY_AFTER_SECONDS;
  autoAway.check();
  world.enabled = false;
  world.idle = AWAY_AFTER_SECONDS + 60;
  autoAway.check();
  assert.deepEqual(world.changes, ['away'], 'not while you are still gone');

  world.idle = 0;
  autoAway.check();
  assert.deepEqual(world.changes, ['away', 'online']);

  world.idle = AWAY_AFTER_SECONDS;
  autoAway.check();
  assert.deepEqual(world.changes, ['away', 'online'], 'and it stays off');
});

test('the setting turned on while you are already gone shows you as Away', () => {
  const { world, autoAway } = setup({ enabled: false });
  world.idle = AWAY_AFTER_SECONDS + 60;
  autoAway.check();
  world.enabled = true;
  autoAway.check();
  assert.deepEqual(world.changes, ['away']);
});

test('quitting takes back an Away nobody picked', () => {
  const { world, autoAway } = setup();
  world.idle = AWAY_AFTER_SECONDS;
  autoAway.check();
  autoAway.comeBack();
  assert.deepEqual(world.changes, ['away', 'online']);

  autoAway.comeBack();
  assert.deepEqual(world.changes, ['away', 'online'], 'once');
});

test('quitting leaves a status you picked as it is', () => {
  for (const status of ['online', 'busy', 'away', 'offline']) {
    const { world, autoAway } = setup({ status });
    autoAway.comeBack();
    assert.deepEqual(world.changes, [], status);
  }
  const { world, autoAway, pick } = setup();
  world.idle = AWAY_AFTER_SECONDS;
  autoAway.check();
  pick('away');
  autoAway.comeBack();
  assert.deepEqual(world.changes, ['away']);
});
