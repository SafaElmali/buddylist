import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { Analytics } from '../src/main/analytics.js';
import { appTools } from '../src/main/app-tools.js';
import { Projects } from '../src/main/project-settings.js';
import { Store } from '../src/main/storage/store.js';
import { APP_TOOLS, INSTRUCTION_PARTS } from '../src/shared/app-tools.js';
import { REQUESTS } from '../src/shared/ipc-channels.js';
import {
  INSTRUCTIONS_MAX,
  allInstructions,
  cleanEveryProjectInstructions,
  cleanInstructions,
} from '../src/shared/project-settings.js';
import { tempDir } from './fixtures/temp-dir.js';

// What Settings > Every project > Instructions tells the agents of every project, before what their project's own
// Instructions say: kept with the app's settings, and only the user changes it.

const NOTHING = { general: '', pullRequest: '', review: '' };
const EVERY = {
  general: 'Use the ponytail skill.',
  pullRequest: 'Say how you checked that it works.',
  review: 'Answer each comment once it is fixed.',
};

// ---- as they are kept ---------------------------------------------------------------------------------------

test('a new install tells every project nothing', () => {
  const store = new Store(tempDir('bl-every-'), { defaultProvider: 'claude' });
  assert.deepEqual(store.settings.instructions, NOTHING);
});

test('what every project is told is kept as a project’s box keeps it, and a part left out stays as it was', () => {
  const typed = { general: '\n  \n## Scope\r\nUse pnpm.  \n\n' };
  assert.deepEqual(cleanEveryProjectInstructions({ instructions: typed }, {}), {
    instructions: { ...NOTHING, general: '## Scope\nUse pnpm.' },
  });
  assert.deepEqual(cleanEveryProjectInstructions({ instructions: typed }, {}).instructions, cleanInstructions(typed));
  assert.deepEqual(
    cleanEveryProjectInstructions({ instructions: { review: 'One commit each.' } }, { instructions: EVERY }),
    {
      instructions: { ...EVERY, review: 'One commit each.' },
    }
  );
  // Emptied, it is told nothing again.
  assert.deepEqual(cleanEveryProjectInstructions({ instructions: { general: '  ' } }, { instructions: EVERY }), {
    instructions: { ...EVERY, general: '' },
  });
  // As long as a project's may be, and no other parts.
  const long = cleanEveryProjectInstructions({ instructions: { general: 'x'.repeat(INSTRUCTIONS_MAX + 9), x: 1 } }, {});
  assert.equal(long.instructions.general.length, INSTRUCTIONS_MAX);
  assert.deepEqual(Object.keys(long.instructions), ['general', 'pullRequest', 'review']);
  // A patch that doesn't name them leaves them alone.
  for (const patch of [{ sounds: false }, { instructions: null }, { instructions: 'Use pnpm.' }, null, undefined]) {
    assert.deepEqual(cleanEveryProjectInstructions(patch, { instructions: EVERY }), {}, JSON.stringify(patch));
  }
});

test('every project’s part comes before the project’s own, each part on its own, and one neither has is empty', () => {
  const own = { general: 'Use pnpm.', pullRequest: '', review: 'Fix it in a commit of its own.' };
  assert.deepEqual(allInstructions({ ...EVERY, review: '' }, own), {
    general: 'Use the ponytail skill.\n\nUse pnpm.',
    pullRequest: 'Say how you checked that it works.',
    review: 'Fix it in a commit of its own.',
  });
  assert.deepEqual(allInstructions(NOTHING, own), own, 'with nothing for every project, the project’s own alone');
  assert.deepEqual(allInstructions(NOTHING, NOTHING), NOTHING);
});

// ---- what a project's agents are told -----------------------------------------------------------------------

function projectsIn(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bl-every-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store(path.join(root, 'data'), { defaultProvider: 'claude' });
  const computerHome = path.join(root, 'this-computer');
  // Any folder outside This computer is a project of its own, by its name: no git is asked.
  const describe = (cwd) => ({ key: `dir:${cwd}`, name: path.basename(cwd), root: cwd });
  const projects = new Projects({
    store,
    worktreesHome: path.join(root, 'worktrees'),
    computerHome,
    describe: async (cwd) => describe(cwd),
    describeNow: describe,
  });
  return { root, store, projects, computerHome };
}

test('an agent is told what every project is told, then what its project is', (t) => {
  const { root, store, projects } = projectsIn(t);
  const shop = path.join(root, 'shop');
  projects.update(`dir:${shop}`, { instructions: { general: 'Use pnpm.', review: 'One commit each.' } });
  store.updateSettings({ instructions: EVERY });
  assert.equal(projects.forAgent(shop).instructions, 'Use the ponytail skill.\n\nUse pnpm.');
  // The buttons' parts too, for the conversation window to add to what they ask.
  assert.deepEqual(projects.instructions(`dir:${shop}`), {
    general: 'Use the ponytail skill.\n\nUse pnpm.',
    pullRequest: 'Say how you checked that it works.',
    review: 'Answer each comment once it is fixed.\n\nOne commit each.',
  });
  // A project with nothing of its own is told what every project is.
  assert.equal(projects.forAgent(path.join(root, 'notes')).instructions, 'Use the ponytail skill.');
  // Kept apart: the project's own are as they were.
  assert.deepEqual(projects.settings(`dir:${shop}`).instructions, {
    general: 'Use pnpm.',
    pullRequest: '',
    review: 'One commit each.',
  });
});

test('with nothing for every project, an agent is told what its project says and nothing more', (t) => {
  const { root, projects } = projectsIn(t);
  const shop = path.join(root, 'shop');
  projects.update(`dir:${shop}`, { instructions: { general: 'Use pnpm.', pullRequest: 'Draft.' } });
  assert.equal(projects.forAgent(shop).instructions, 'Use pnpm.');
  assert.deepEqual(projects.instructions(`dir:${shop}`), projects.settings(`dir:${shop}`).instructions);
  assert.equal(projects.forAgent(path.join(root, 'notes')).instructions, '');
});

test('a project says otherwise after what every project is told, so its own is what holds', (t) => {
  const { root, store, projects } = projectsIn(t);
  const shop = path.join(root, 'shop');
  store.updateSettings({ instructions: { ...NOTHING, general: 'Open the pull request as a draft.' } });
  projects.update(`dir:${shop}`, {
    instructions: { general: 'In this project, open the pull request ready for review, not as a draft.' },
  });
  const told = projects.forAgent(shop).instructions;
  assert.ok(told.indexOf('Open the pull request as a draft.') === 0);
  assert.ok(told.endsWith('In this project, open the pull request ready for review, not as a draft.'));
});

test('a change to what every project is told reaches the next agent started, as a project’s does', (t) => {
  const { root, store, projects } = projectsIn(t);
  const shop = path.join(root, 'shop');
  assert.equal(projects.forAgent(shop).instructions, '');
  store.updateSettings(cleanEveryProjectInstructions({ instructions: { general: 'Be brief.' } }, store.settings));
  assert.equal(projects.forAgent(shop).instructions, 'Be brief.');
});

test('the contacts on This computer are told it too, before what This computer’s own Instructions say', (t) => {
  const { store, projects, computerHome } = projectsIn(t);
  const chat = path.join(computerHome, 'chat-1');
  store.updateSettings({ instructions: { ...NOTHING, general: 'Use the ponytail skill.' } });
  assert.equal(projects.forAgent(chat).instructions, 'Use the ponytail skill.');
  projects.update(projects.computer.key, { instructions: { general: 'Answer in Turkish.' } });
  assert.equal(projects.forAgent(chat).instructions, 'Use the ponytail skill.\n\nAnswer in Turkish.');
});

test('settings written by hand with something odd for every project tell it nothing odd', (t) => {
  const { root, store, projects } = projectsIn(t);
  const shop = path.join(root, 'shop');
  for (const instructions of [undefined, null, 'Use pnpm.', { general: 42 }]) {
    store.updateSettings({ instructions });
    assert.doesNotThrow(() => projects.forAgent(shop), String(instructions));
  }
  assert.equal(projects.forAgent(shop).instructions, '42');
});

// ---- through the app's own requests ---------------------------------------------------------------------------

// The real IPC handlers, and the app tool as an agent is given it. Only Electron is replaced.
const electron = `data:text/javascript,${encodeURIComponent(`
  export const handlers = new Map();
  export const ipcMain = { handle: (name, fn) => handlers.set(name, fn), on() {} };
  export const app = { getVersion: () => '0.0.0' };
  export const nativeTheme = { on() {} };
  export const BrowserWindow = { fromWebContents: () => null, getAllWindows: () => [] };
  export const dialog = {}, nativeImage = {}, screen = {}, shell = {};
`)}`;
let registerIpc;
let handlers;
if (module.registerHooks) {
  const hook = module.registerHooks({
    resolve(name, context, next) {
      return name === 'electron' ? { url: electron, shortCircuit: true } : next(name, context);
    },
  });
  try {
    ({ registerIpc } = await import('../src/main/ipc.js'));
    ({ handlers } = await import(electron));
  } finally {
    hook.deregister();
  }
}
const opts = { skip: !registerIpc };

function app(t) {
  const { root, store, projects } = projectsIn(t);
  const shop = path.join(root, 'shop');
  fs.mkdirSync(shop);
  const contact = store.addContact({ provider: 'claude', name: 'Claude (shop)', cwd: shop });
  const posts = [];
  const analytics = new Analytics({
    store,
    enabled: true,
    about: {},
    key: 'phc_test',
    host: 'https://posthog.example',
    fetch: async (_url, request) => {
      posts.push(JSON.parse(request.body));
      return new Response('{"status":1}');
    },
  });
  const systemVersion = process.getSystemVersion;
  process.getSystemVersion = () => 'test';
  let projectInstructions;
  try {
    ({ projectInstructions } = registerIpc({
      store,
      providers: { list: () => [], descriptor: () => ({ id: 'claude', name: 'Claude' }) },
      conversations: { view: () => ({ status: 'online' }) },
      projects,
      errorReports: { setEnabled() {} },
      listening: { setEnabled() {} },
      shortcuts: { apply() {} },
      analytics,
      broadcast() {},
      pathReady: Promise.resolve(),
    }));
  } finally {
    if (systemVersion) process.getSystemVersion = systemVersion;
    else delete process.getSystemVersion;
  }
  const invoke = (channel, ...args) => handlers.get(channel)({ sender: {} }, ...args);
  // The tool to read and save a project's instructions, as the contact's agent is given it, with the card that
  // asks the user answered `decision`.
  const tool = appTools({
    store,
    terminals: { wanted: () => true },
    startConversation: async () => ({}),
    instructions: projectInstructions,
  })(contact.id).find((one) => one.name === APP_TOOLS.instructions);
  const run = (input, decision = 'allow') => tool.run(input, { ask: async () => ({ decision }) });
  const counted = async () => {
    await analytics.flush();
    return posts.flatMap((post) => post.batch);
  };
  return { store, projects, contact, key: `dir:${shop}`, invoke, tool, run, counted };
}

test('Settings keeps what every project is told, and counts the change by its name alone', opts, async (t) => {
  const { store, invoke, counted } = app(t);
  const settings = await invoke(REQUESTS.settingsUpdate, {
    instructions: { ...EVERY, general: 'Use the secret skill.' },
  });
  assert.deepEqual(settings.instructions, { ...EVERY, general: 'Use the secret skill.' });
  await invoke(REQUESTS.settingsUpdate, { instructions: { review: '' } });
  assert.deepEqual(store.settings.instructions, { ...EVERY, general: 'Use the secret skill.', review: '' });
  const counts = (await counted()).filter((count) => count.event === 'setting changed');
  assert.deepEqual(
    counts.map(({ properties: { setting } }) => setting),
    ['instructions', 'instructions']
  );
  assert.ok(!JSON.stringify(counts).includes('secret'));
});

test(
  'a conversation’s Create PR and review comments ask with every project’s words, then its project’s',
  opts,
  async (t) => {
    const { store, projects, contact, key, invoke } = app(t);
    store.updateSettings({ instructions: EVERY });
    projects.update(key, { instructions: { pullRequest: 'Open it as a draft.' } });
    const project = await invoke(REQUESTS.projectOf, contact.id);
    assert.equal(project.instructions.pullRequest, 'Say how you checked that it works.\n\nOpen it as a draft.');
    assert.equal(project.instructions.review, 'Answer each comment once it is fixed.');
  }
);

test('an agent reads and saves only its project’s instructions, never what every project is told', opts, async (t) => {
  const { store, projects, key, tool, run } = app(t);
  store.updateSettings({ instructions: EVERY });
  projects.update(key, { instructions: { general: 'Use pnpm.' } });
  // What it reads is the project's alone, so what it writes back can't carry every project's into it.
  assert.equal(await run({}), 'The Every conversation instructions of shop:\n\nUse pnpm.');
  assert.equal(await run({ part: 'create_pr' }), 'shop has no Create PR instructions.');
  await run({ text: 'Use pnpm.\n\nMerge once the checks pass.' });
  await run({ part: 'review_comments', text: '' });
  assert.deepEqual(projects.settings(key).instructions, {
    general: 'Use pnpm.\n\nMerge once the checks pass.',
    pullRequest: '',
    review: '',
  });
  assert.deepEqual(store.settings.instructions, EVERY, 'every project’s are as the user left them');
  // There is no part of the tool for them: only the project's three.
  assert.deepEqual(Object.keys(INSTRUCTION_PARTS), ['every_conversation', 'create_pr', 'review_comments']);
  assert.match(tool.description, /only the user changes that/);
});

test('what an agent saved for its project is told after what every project is told', opts, async (t) => {
  const { store, projects, contact, run } = app(t);
  store.updateSettings({ instructions: { ...NOTHING, general: 'Use the ponytail skill.' } });
  await run({ text: 'Merge once the checks pass.' });
  assert.equal(projects.forAgent(contact.cwd).instructions, 'Use the ponytail skill.\n\nMerge once the checks pass.');
  assert.deepEqual(cleanInstructions(store.settings.instructions), { ...NOTHING, general: 'Use the ponytail skill.' });
});
