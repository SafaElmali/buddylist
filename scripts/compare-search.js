// Interleaved CPU measurements against a Git revision, without switching or copying the checkout.
// node scripts/compare-search.js <baseline-ref> [output.json]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { matchingFiles } from '../src/shared/file-suggestions.js';
import { startedUnder } from '../src/shared/list-view.js';
import { hasEvery } from '../src/shared/search.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ref = process.argv[2];
assert.ok(ref, 'Pass the baseline Git revision');
async function baseline(file) {
  const url = pathToFileURL(path.join(root, file));
  const source = execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8' }).replace(
    /from (['"])(\.[^'"]+)\1/g,
    (_match, quote, relative) => `from ${quote}${new URL(relative, url).href}${quote}`
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
const [oldFiles, oldList, oldSearch] = await Promise.all([
  baseline('src/shared/file-suggestions.js'),
  baseline('src/shared/list-view.js'),
  baseline('src/shared/search.js'),
]);
const results = {};
function compare(name, before, after) {
  assert.deepEqual(after(), before(), `${name}: results must stay identical`);
  const samples = { before: [], after: [] };
  // Alternate the order as well: background activity and JIT warm-up affect both versions.
  for (let i = 0; i < 21; i++) {
    for (const [label, run] of i % 2
      ? [
          ['after', after],
          ['before', before],
        ]
      : [
          ['before', before],
          ['after', after],
        ]) {
      const start = performance.now();
      run();
      samples[label].push(performance.now() - start);
    }
  }
  results[name] = Object.fromEntries(
    Object.entries(samples).map(([label, times]) => [
      label,
      {
        median: [...times].sort((a, b) => a - b)[10],
        samples: times,
      },
    ])
  );
}
const files = Array.from({ length: 50000 }, (_, i) => `src/package${i % 100}/file${i}.js`);
compare(
  'file matching: 50k paths',
  () => oldFiles.matchingFiles(files, 'file'),
  () => matchingFiles(files, 'file')
);
const contacts = Array.from({ length: 2000 }, (_, i) => ({ id: String(i), startedBy: i ? '0' : undefined }));
compare(
  'contact hierarchy: 2k related conversations',
  () => oldList.startedUnder(contacts),
  () => startedUnder(contacts)
);
const messages = Array.from(
  { length: 264000 },
  (_, i) => `Message ${i}: ${'A realistic explanation of the application code and its behavior. '.repeat(5)}`
);
compare(
  'text matching: 264k messages, absent word',
  () => oldSearch.hasEvery(messages, ['needle']),
  () => hasEvery(messages, ['needle'])
);
if (process.argv[3]) fs.writeFileSync(process.argv[3], `${JSON.stringify({ ref, results }, null, 2)}\n`);
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(results).map(([name, values]) => [
        name,
        {
          before: values.before.median,
          after: values.after.median,
        },
      ])
    ),
    null,
    2
  )
);
