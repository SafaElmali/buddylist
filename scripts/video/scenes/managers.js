// Project managers: a manager over three agents on one project sees that a change lacks the test its ticket
// asks for, asks you, and tells the agent, which gets on with it. See docs/project-managers.md.
//
// The app is in demo mode, with a project of its own under a home folder of its own: a shop, its three
// worktrees on branches named after their tickets, and four other projects above it, which take the pull
// requests demo mode makes up for the first folders on the list. The cart's worktree has the change its agent
// made; its agent is asked to fix the cart off camera, and once that round is over its manager hears of it.
// The functions handed to evaluate run in the app's pages.
/* global window */

/** What the band at the top of the film says while the title card is up. */
export const title = 'Project managers';

/** The narration, a line at a time, as the captions file spells it. */
export const narration = {
  hook: 'Running a few coding agents on one project? Give the project a manager.',
  brief: 'It reads your tickets, specs and Slack threads, and keeps a brief of what you’re building.',
  checks: 'Whenever an agent changes files, the manager checks the work against the ticket.',
  missing:
    'This change is missing the test the ticket asks for. So the manager writes to that agent, and asks you first.',
  accept: 'Accept, and the message goes straight to the agent.',
  back: 'It picks it up and gets back to work. No copy-pasting between windows.',
  outro: 'buddylist. Your agents, on one buddy list.',
};

/** The lines a voice reads to be compared with others: about 25 seconds. */
export const sample = ['hook', 'brief', 'checks', 'missing'];

/** How the voice says what it would say wrong. */
export const spoken = { buddylist: 'buddy list' };

const WORKERS = [
  { key: 'cart', provider: 'claude', name: 'Claude (cart)', branch: 'shop-12-cart-total' },
  { key: 'checkout', provider: 'codex', name: 'Codex (checkout)', branch: 'shop-14-apple-pay' },
  { key: 'search', provider: 'claude', name: 'Claude (search)', branch: 'shop-9-search' },
];

const cart = (count) =>
  `export function total(items) {\n  return items.reduce((sum, item) => sum + item.price * ${count}, 0);\n}\n`;

/**
 * The app's data and the projects, before it starts.
 * @param {import('../film.js').Preparing} at
 */
export function prepare({ home, data, store, history, git, write }) {
  const shop = `${home}/code/shop`;
  write(`${shop}/src/cart.js`, cart('item.count'));
  write(`${shop}/test/cart.test.js`, "import { total } from '../src/cart.js';\n");
  git(shop, 'init', '-q', '-b', 'main');
  git(shop, 'add', '.');
  git(shop, 'commit', '-q', '-m', 'Start the shop');
  // Where the app keeps the worktrees it makes, so the list shows them under the shop.
  for (const { key, branch } of WORKERS)
    git(shop, 'worktree', 'add', '-q', '-b', branch, `${data}/worktrees/shop/${key}`);
  write(`${data}/worktrees/shop/cart/src/cart.js`, cart('(item.count ?? 1)'));

  for (const name of ['api', 'docs', 'mobile', 'website']) {
    write(`${home}/code/${name}/README.md`, `# ${name}\n`);
    store.addContact({ provider: 'claude', name: `Claude (${name})`, cwd: `${home}/code/${name}`, model: '' });
  }
  const workers = Object.fromEntries(
    WORKERS.map(({ key, provider, name }) => [
      key,
      store.addContact({ provider, name, cwd: `${data}/worktrees/shop/${key}`, model: '' }).id,
    ])
  );
  history.append(workers.cart, {
    kind: 'user',
    text: 'SHOP-12: an item without a count makes the total NaN',
    images: 0,
  });
  history.append(workers.cart, {
    kind: 'assistant',
    text: 'I see it: the mug has no `count`, so its price times `undefined` makes the total NaN.',
  });
  history.append(workers.cart, { kind: 'result', isError: false, durationMs: 4100, costUsd: 0 });
  return { shop, workers };
}

/**
 * Off camera: the shop gets its manager, with the three conversations under it, and the windows are laid out.
 * @param {import('../film.js').Director} d
 */
export async function setup(d, { workers }) {
  const contacts = d.contacts;
  const key = (await contacts.evaluate((id) => window.messenger.projects.of(id), workers.cart)).key;
  const manager = await contacts.evaluate(
    (k) => window.messenger.projects.addManager(k, { name: 'shop manager' }),
    key
  );
  for (const id of Object.values(workers)) {
    await contacts.evaluate(([c, m]) => window.messenger.contacts.assign(c, m), [id, manager]);
  }
  const chat = await d.open(manager);
  // It writes the brief first: on camera it has done so.
  await chat.getByText('The brief is written').waitFor();
  // The cart's conversation is open too, off camera, for it to be asked to fix the cart.
  const cartChat = await d.open(workers.cart);
  await d.show('contacts', { x: 40, y: 60, width: 330, height: 700 });
  await d.show(chat, { x: 400, y: 60, width: 1180, height: 700 });
  return { manager, chat, cartChat };
}

/**
 * On camera.
 * @param {import('../film.js').Director} d
 */
export async function play(d, { workers, manager, chat, cartChat }) {
  const contacts = d.contacts;
  const shop = contacts.locator('.group', { has: contacts.locator(`.contact[data-id="${manager}"]`) });
  const pane = chat.locator('#side-pane');
  d.front(chat);
  d.look('wide', { ms: 0 });

  // A manager for the project, with the conversations under it.
  d.caption('A **manager** for each project');
  const hook = d.say('hook');
  await d.wait(1100);
  d.look(shop, { ms: 1600, pad: 30 });
  await d.wait(500);
  await d.moveTo(shop.locator('.group-header'), { ms: 1000 });
  await hook;

  // What it knows: the brief it keeps from the tickets, docs and Slack.
  d.caption('It knows what you’re **building**');
  const brief = d.say('brief');
  d.look(pane.locator('.pane-bar').first(), { ms: 1300, pad: 160 });
  await d.wait(500);
  await d.click(pane.locator('.pane-add').first(), { ms: 900 });
  await d.click(chat.locator('.menu-item, [role="menuitem"]', { hasText: /^\s*Brief\s*$/ }).first(), { ms: 500 });
  const known = pane.getByText('Decided in #shop on Slack');
  await known.waitFor();
  d.look(await d.rect(pane.locator('.pane-bar').first(), known), { ms: 800, pad: 20 });
  await brief;

  // A change comes in, and it looks at it.
  d.caption('It checks **every change**');
  await cartChat.locator('#input').fill('Fix the total for an item without a count');
  await cartChat.keyboard.press('Enter');
  await cartChat.locator('a[data-d="allow"]').last().click();
  const conversation = chat.locator('#conversation');
  const heard = conversation.locator('.event', { hasText: 'changed 1 file' }).last();
  await heard.waitFor();
  // The cart's round is over: its window goes, for the manager's to show it later.
  await cartChat.close();
  d.look(heard, { ms: 1100, pad: 60 });
  const checks = d.say('checks');
  await d.moveTo(heard, { ms: 900 });
  await checks;

  // Something is missing: it asks first.
  const asking = conversation.locator('.invite', { hasText: 'would like to send' }).last();
  await asking.waitFor();
  d.mark('loop-from');
  d.caption('…and asks you **first**');
  d.look(asking, { ms: 1000, pad: 16 });
  await d.say('missing');

  const accepted = d.say('accept');
  await d.click(asking.locator('a[data-d="allow"]'), { ms: 900, zoom: 1000 });
  const asked = conversation.locator('.msg', { hasText: 'I asked for it' }).last();
  await asked.waitFor();
  d.look(await d.rect(asking, asked), { ms: 900, pad: 16 });
  await accepted;

  // The agent hears it, and gets on with it.
  d.caption('Your agents hear it **directly**');
  await d.click(pane.locator('.pane-tab', { hasText: 'Team' }), { ms: 800 });
  await d.click(chat.locator(`.team-row[data-id="${workers.cart}"]`), { ms: 700 });
  await chat.locator('#to-line', { hasText: 'Claude (cart)' }).waitFor();
  const told = chat.locator('#conversation .event.notice', { hasText: 'shop manager says' }).last();
  const answer = chat.locator('#conversation').getByText('On it: I am adding the test').last();
  await answer.waitFor();
  d.look(await d.rect(told, answer), { ms: 1000, pad: 24 });
  await d.say('back');
  d.mark('loop-to');

  d.look('wide', { ms: 1300 });
  await d.wait(900);
  await d.end(d.say('outro'));
}
