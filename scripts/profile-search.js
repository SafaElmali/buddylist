// Synthetic fixtures only. node scripts/profile-search.js [output.json]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { FileSuggestions, suggestionFiles } from '../src/main/file-suggestions.js';
import { matchingFiles } from '../src/shared/file-suggestions.js';
import { paletteSections } from '../src/shared/palette.js';
import { startedUnder } from '../src/shared/list-view.js';
import { Conversations } from '../src/main/conversations.js';
import { History } from '../src/main/storage/history.js';
import { summarize } from '../src/main/storage/archive.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-search-profile-'));
const results = { node: process.version, platform: `${process.platform}/${process.arch}`, metrics: {} };
async function measure(name, run, count = 7) {
  const samples = [];
  let value;
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    value = await run();
    samples.push(performance.now() - start);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  results.metrics[name] = { median: sorted[Math.floor(count / 2)], samples };
  return value;
}

try {
  const files = Array.from({ length: 50000 }, (_, i) => `src/package${i % 100}/file${i}.js`);
  const repo = path.join(temp, 'repo');
  fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q', repo]);
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), '');
  }
  fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
  fs.mkdirSync(path.join(repo, 'node_modules'));
  fs.writeFileSync(path.join(repo, 'node_modules/ignored.js'), '');
  const catalog = await measure('git catalog: 50k files', () => suggestionFiles(repo));
  assert.equal(catalog.paths.length, 20000);
  assert.equal(catalog.limited, true);
  assert.ok(!catalog.paths.some((file) => file.includes('node_modules')));
  const suggestions = new FileSuggestions();
  await measure('file suggestions: cold scan including delay', () => suggestions.find(repo, 'file'), 1);
  await measure('file suggestions: warm 20k catalog', () => suggestions.find(repo, 'file'));
  const matched = await measure('file matching: broad 50k paths', () => matchingFiles(files, 'file'));
  assert.equal(matched.paths.length, 30);
  assert.equal(matched.more, true);
  const findables = {
    files: catalog.paths.map((file) => ({ name: file.split('/').at(-1), also: file })),
    contacts: Array.from({ length: 2000 }, (_, i) => ({ name: `File worker ${i}`, also: 'Search project' })),
    conversations: Array.from({ length: 2000 }, (_, i) => ({ name: `Fix file lookup ${i}`, also: 'Search project' })),
    actions: [],
  };
  const sections = await measure('palette ranking: 20k files, 2k contacts, 2k conversations', () =>
    paletteSections(findables, 'file')
  );
  results.paletteCounts = sections.map(({ kind, entries }) => [kind, entries.length]);
  const contacts = Array.from({ length: 2000 }, (_, i) => ({
    id: `worker-${i}`,
    name: `Worker ${i}`,
    cwd: repo,
    provider: 'fixture',
    startedBy: i ? 'worker-0' : undefined,
  }));
  assert.equal(
    (await measure('contact hierarchy: 2k related conversations', () => startedUnder(contacts))).length,
    2000
  );

  const history = new History(path.join(temp, 'history'));
  const historyContacts = contacts.slice(0, 40);
  const entries = Array.from({ length: 600 }, (_, i) => ({
    id: String(i),
    kind: i % 2 ? 'assistant' : 'user',
    time: i + 1,
    text: `Message ${i}: ${'A realistic explanation of the application code and its behavior. '.repeat(5)}${i === 599 ? 'needle' : ''}`,
  }));
  for (const contact of historyContacts) {
    fs.writeFileSync(path.join(history.dir, `${contact.id}.json`), JSON.stringify(entries));
    const archive = path.join(history.dir, 'archive', contact.id);
    fs.mkdirSync(archive, { recursive: true });
    const summaries = [];
    for (let i = 0; i < 10; i++) {
      const conversation = { id: `archive-${i}`, cwd: repo, entries };
      fs.writeFileSync(path.join(archive, `${conversation.id}.json`), JSON.stringify(conversation));
      summaries.push(summarize(conversation));
    }
    fs.writeFileSync(path.join(archive, 'index.json'), JSON.stringify(summaries));
  }
  const conversations = new Conversations({
    store: { contacts: historyContacts, getContact: (id) => historyContacts.find((contact) => contact.id === id) },
    history,
    providers: { upgradeHistory: (_provider, entries) => entries },
    projectOf: () => 'Fixture',
    branchOf: async () => 'main',
  });
  let beats = 0;
  const heartbeat = setInterval(() => beats++, 5);
  const hits = await measure(
    'contact history: 40 contacts, 440 transcripts, 264k messages',
    () => conversations.searchHistory('needle'),
    5
  );
  clearInterval(heartbeat);
  assert.equal(hits.length, 40);
  assert.ok(hits.every((hit) => hit.conversations === 11));
  results.historyHeartbeat = beats;
  const all = await measure('palette history: 440 transcripts', () => conversations.allHistory('needle'), 5);
  assert.equal(all.length, 440);
  await measure('palette history listing: 440 summaries', () => conversations.allHistory(''), 5);
  let calls = 0;
  const source = {
    name: 'Fixture',
    list: async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 150));
      return [];
    },
  };
  const external = new Conversations({
    store: { contacts: historyContacts, deletedSessions: [], getContact: () => historyContacts[0] },
    history: { read: () => [], listArchived: () => [], async *eachArchived() {} },
    providers: { upgradeHistory: (_provider, entries) => entries, elsewhere: () => source },
  });
  await measure('single-contact session listing: paired requests, simulated 150ms SDK', () =>
    Promise.all([
      external.listHistoryEverywhere(historyContacts[0].id),
      external.listHistoryEverywhere(historyContacts[0].id, 'needle'),
    ])
  );
  results.externalCalls = calls;
  if (process.argv[2]) fs.writeFileSync(process.argv[2], `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify(results, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
