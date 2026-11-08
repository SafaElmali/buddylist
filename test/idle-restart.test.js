import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AWAY_AFTER_SECONDS } from '../src/main/auto-away.js';
import { IdleRestart } from '../src/main/idle-restart.js';

const settle = () => new Promise((done) => setImmediate(done));

/**
 * An IdleRestart on a fake computer: set `idle`, `update`, `views` and what `answer` the restart
 * gives (true, false or an Error), then call check().
 */
function setup({ whenIdle = true, idle = AWAY_AFTER_SECONDS, views = [] } = {}) {
  const world = { update: { version: '0.2.6', ready: true, whenIdle }, idle, views, answer: true, restarts: 0 };
  const idleRestart = new IdleRestart({
    update: () => world.update,
    idleSeconds: () => world.idle,
    views: () => world.views,
    restart: async () => {
      world.restarts += 1;
      if (world.answer instanceof Error) throw world.answer;
      return world.answer;
    },
  });
  return { world, idleRestart };
}

test('once picked, it restarts when you are away and no contact is at work', async () => {
  const { world, idleRestart } = setup({ views: [{ name: 'Claude', status: 'online' }] });
  idleRestart.check();
  await settle();
  assert.equal(world.restarts, 1);
});

test('not while you are at the computer', async () => {
  const { world, idleRestart } = setup({ idle: AWAY_AFTER_SECONDS - 1 });
  idleRestart.check();
  await settle();
  assert.equal(world.restarts, 0);
  world.idle = AWAY_AFTER_SECONDS;
  idleRestart.check();
  await settle();
  assert.equal(world.restarts, 1);
});

test('not unless Restart when idle was picked, or with no update at all', async () => {
  const { world, idleRestart } = setup({ whenIdle: false });
  idleRestart.check();
  world.update = null;
  idleRestart.check();
  await settle();
  assert.equal(world.restarts, 0);
});

test('not while a contact is working or waiting for you', async () => {
  for (const status of ['busy', 'away']) {
    const { world, idleRestart } = setup({ views: [{ name: 'Claude', status }] });
    idleRestart.check();
    await settle();
    assert.equal(world.restarts, 0, status);
    world.views = [{ name: 'Claude', status: 'online' }];
    idleRestart.check();
    await settle();
    assert.equal(world.restarts, 1, status);
  }
});

test('once begun, the looks that come while the app quits do not begin it again', async () => {
  const { world, idleRestart } = setup();
  idleRestart.check();
  idleRestart.check();
  await settle();
  idleRestart.check();
  await settle();
  assert.equal(world.restarts, 1);
});

test('a restart that did not go ahead, or failed, is tried again at a later look', async () => {
  const { world, idleRestart } = setup();
  world.answer = false;
  idleRestart.check();
  await settle();
  world.answer = new Error('Squirrel is gone');
  idleRestart.check();
  await settle();
  world.answer = true;
  idleRestart.check();
  await settle();
  idleRestart.check();
  await settle();
  assert.equal(world.restarts, 3);
});
