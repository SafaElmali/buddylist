import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamInviteReason, teamMenu } from '../src/renderer/chat/team-menu.js';
import { descriptor as claude } from '../src/providers/claude/descriptor.js';
import { descriptor as hermes } from '../src/providers/hermes/descriptor.js';

const providers = [claude, hermes];
const invite = (items) => items.find((one) => one.label === 'Invite to conversation');
const add = (items) => items.find((one) => one.label === 'Add to message');
function setup() {
  const host = {
    id: 'manager',
    name: 'Shop manager',
    project: 'shop',
    manages: 'shop',
    oversees: true,
    status: 'online',
  };
  const guest = {
    id: 'worker',
    name: 'Reviewer',
    overseenBy: 'manager',
    project: 'shop',
    provider: 'claude',
    status: 'online',
  };
  const ctx = { contactId: host.id, contact: host, participants: [host], contacts: [host, guest] };
  const calls = [];
  const errors = [];
  const on = {
    providers: () => providers,
    open: (contact) => calls.push(['open', contact.id]),
    insert: (text) => calls.push(['insert', text]),
    invite: async (...ids) => calls.push(['invite', ...ids]),
    error: (message) => errors.push(message),
  };
  return { host, guest, ctx, calls, errors, on };
}

test('Team separates conversation navigation, a draft mention and an invitation', async () => {
  const { ctx, guest, on, calls } = setup();
  const items = teamMenu(ctx, on)(guest);
  assert.deepEqual(
    items.filter((one) => !one.separator).map((one) => one.label),
    ['Open conversation', 'Add to message', 'Invite to conversation']
  );
  items[0].action();
  add(items).action();
  await invite(items).action();
  assert.deepEqual(calls, [
    ['open', 'worker'],
    ['insert', '@Reviewer '],
    ['invite', 'manager', 'worker'],
  ]);
});

test('unsupported invitations have a disabled action and a visible explanation', () => {
  const cases = [
    [
      'self',
      (s) => {
        s.guest.id = s.host.id;
      },
      /current conversation/,
    ],
    ['already here', (s) => s.ctx.participants.push(s.guest), /Already in this chat/],
    ['same name', (s) => s.ctx.participants.push({ id: 'other', name: 'reviewer' }), /Already in this conversation/],
    [
      'worktree',
      (s) => {
        s.guest.worktree = '/work/shop-2';
      },
      /separate worktree/,
    ],
    [
      'manager',
      (s) => {
        s.guest.manages = 'shop';
      },
      /own conversation/,
    ],
    [
      'guest elsewhere',
      (s) => {
        s.guest.guestOf = 'other';
      },
      /own conversation/,
    ],
    [
      'archived guest',
      (s) => {
        s.guest.archived = true;
      },
      /Restore this contact/,
    ],
    [
      'archived host',
      (s) => {
        s.host.archived = true;
      },
      /Restore this conversation/,
    ],
    [
      'offline host',
      (s) => {
        s.host.status = 'offline';
      },
      /folder/,
    ],
    [
      'different project',
      (s) => {
        s.guest.project = 'elsewhere';
      },
      /this project/,
    ],
    [
      'unknown service',
      (s) => {
        s.guest.provider = 'missing';
      },
      /service is unavailable/,
    ],
    [
      'no read-only mode',
      (s) => {
        s.guest.provider = 'hermes';
      },
      /read-only/,
    ],
    [
      'removed',
      (s) => {
        s.ctx.contacts = [s.host];
      },
      /no longer available/,
    ],
  ];
  for (const [name, change, expected] of cases) {
    const state = setup();
    change(state);
    const items = teamMenu(state.ctx, state.on)(state.guest);
    assert.equal(invite(items).disabled, true, name);
    assert.equal(items.at(-1).note, true, name);
    assert.match(items.at(-1).label, expected, name);
  }
});

test('a missing guest folder does not prevent joining an available host folder, as in Invite', () => {
  const { ctx, guest } = setup();
  guest.status = 'offline';
  assert.equal(teamInviteReason(ctx, guest, providers), '');
});

test('a pending invitation cannot be sent again, even from the same open menu', async () => {
  const { ctx, guest, on, calls } = setup();
  let finish;
  on.invite = (...ids) => {
    calls.push(ids);
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const menu = teamMenu(ctx, on);
  const action = invite(menu(guest)).action;
  const first = action();
  await action();
  assert.equal(invite(menu(guest)).disabled, true);
  assert.match(menu(guest).at(-1).label, /Adding/);
  assert.deepEqual(calls, [['manager', 'worker']]);
  ctx.participants.push(guest);
  finish();
  await first;
  assert.match(menu(guest).at(-1).label, /Already/);
});

test('a stale menu rechecks the roster, deletion and worktree before sending', async () => {
  for (const change of [
    (s) => s.ctx.participants.push(s.guest),
    (s) => {
      s.ctx.contacts = [s.host];
    },
    (s) => {
      s.guest.worktree = true;
    },
  ]) {
    const state = setup();
    const action = invite(teamMenu(state.ctx, state.on)(state.guest)).action;
    change(state);
    await action();
    assert.deepEqual(state.calls, []);
    assert.equal(state.errors.length, 1);
  }
});

test('switching chat while a menu is open cannot invite into either chat', async () => {
  const { ctx, guest, on, calls } = setup();
  const action = invite(teamMenu(ctx, on)(guest)).action;
  ctx.contactId = 'another';
  await action();
  assert.deepEqual(calls, []);
});

test('invitation failures are shown and can be retried', async () => {
  const { ctx, guest, on, calls, errors } = setup();
  on.invite = async () => {
    throw new Error('The service disconnected.');
  };
  const menu = teamMenu(ctx, on);
  await invite(menu(guest)).action();
  assert.deepEqual(errors, ['The service disconnected.']);
  assert.equal(invite(menu(guest)).disabled, false);
  on.invite = async (...ids) => calls.push(ids);
  await invite(menu(guest)).action();
  assert.deepEqual(calls, [['manager', 'worker']]);
});

test('a worktree conversation can be added to the message while its invitation stays unavailable', () => {
  const { ctx, guest, on, calls } = setup();
  guest.worktree = true;
  const items = teamMenu(ctx, on)(guest);
  assert.equal(add(items).disabled, false);
  assert.equal(invite(items).disabled, true);
  add(items).action();
  assert.deepEqual(calls, [['insert', '@Reviewer ']]);
});

test('Add to message uses the selected conversation’s current name, even after a rename', () => {
  const { ctx, guest, on, calls } = setup();
  const action = add(teamMenu(ctx, on)(guest)).action;
  guest.name = '  Reviewer (cart totals)  ';
  action();
  assert.deepEqual(calls, [['insert', '@Reviewer (cart totals) ']]);
});

test('a removed conversation, archived host or ambiguous name cannot insert a misleading mention', () => {
  for (const change of [
    (s) => {
      s.ctx.contacts = [s.host];
    },
    (s) => {
      s.host.archived = true;
    },
    (s) => {
      s.guest.overseenBy = 'another-manager';
    },
    (s) => {
      s.ctx.contacts.push({ ...s.guest, id: 'namesake', name: 'reviewer' });
    },
    (s) => {
      s.ctx.participants.push({ id: 'namesake', name: 'reviewer' });
    },
  ]) {
    const state = setup();
    const menu = teamMenu(state.ctx, state.on);
    const action = add(menu(state.guest)).action;
    change(state);
    assert.equal(add(menu(state.guest)).disabled, true);
    action();
    assert.deepEqual(state.calls, []);
    assert.equal(state.errors.length, 1);
  }
});

test('a stale Add to message menu cannot change another chat’s draft', () => {
  const { ctx, guest, on, calls } = setup();
  const action = add(teamMenu(ctx, on)(guest)).action;
  ctx.contactId = 'another';
  action();
  assert.deepEqual(calls, []);
});

test('an existing guest can be mentioned without another invitation', () => {
  const { ctx, guest, on, calls } = setup();
  ctx.participants.push(guest);
  const items = teamMenu(ctx, on)(guest);
  assert.equal(add(items).disabled, false);
  assert.equal(invite(items).disabled, true);
  add(items).action();
  assert.deepEqual(calls, [['insert', '@Reviewer ']]);
});
