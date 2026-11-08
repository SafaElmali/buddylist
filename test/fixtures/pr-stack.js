// Synthetic metadata for the isolated UI harness. No user repositories or GitHub requests.
import { inStack, issueEvent, stackResponse } from './pr-stack-github.js';

const oid = (number) => String(number).padStart(40, '0');
const branch = (ref, number) => ({ ref, sha: oid(number), repo: { full_name: 'example/stack-fixture' } });
const pr = (number, title, head, base, extra = {}) => ({
  number,
  html_url: `https://github.com/example/stack-fixture/pull/${number}`,
  title,
  state: 'open',
  head,
  base,
  ...extra,
});
const merged = (at) => ({ state: 'closed', merged_at: at });
export const stackFixture = [
  pr(42, 'Add repository metadata', branch('repository-metadata', 42), branch('main', 1), {
    state: 'closed',
    merged_at: '2026-10-29T12:00:00Z',
  }),
  pr(45, 'Show pull request relationships', branch('pr-stack-view', 45), branch('repository-metadata', 42)),
  pr(47, 'Keep the stack readable in narrow panes', branch('narrow-stack', 47), branch('pr-stack-view', 45), {
    draft: true,
  }),
  pr(48, 'Explore an alternative layout', branch('alternative-layout', 48), branch('pr-stack-view', 45), {
    state: 'closed',
  }),
];

// A GitHub stack after its lower three merged: GitHub has moved every member onto main.
export const githubStackFixture = [
  pr(51, 'Share file presentation', branch('file-presentation', 51), branch('main', 1), merged('2026-10-30T14:36:19Z')),
  pr(52, 'Serve pages to members', branch('member-pages', 52), branch('main', 1), merged('2026-10-30T16:26:33Z')),
  pr(53, 'Render page layouts', branch('page-layouts', 53), branch('main', 1), merged('2026-10-31T08:24:50Z')),
  pr(54, 'Preview a page as members see it', branch('page-preview', 54), branch('main', 1)),
].map((item, index, all) => inStack(item, { number: 55, position: index + 1, size: all.length }));

// A GitHub stack of seven, shaped like a reported one: numbers out of order, the lower three merged,
// one given up, the rest open or draft. Each merge moved the next PR onto main.
export const sevenStackFixture = [
  [32840, 'fix: roll back survey writers to the legacy queue', '1-survey-writers', merged('2026-10-28T10:02:00Z')],
  [32843, 'refactor: read survey answers through one reader', '2-survey-reader', merged('2026-10-29T15:40:00Z')],
  [32845, 'feat: store survey answers per publication', '3-answers-table', merged('2026-10-30T09:12:00Z')],
  [32846, 'feat: backfill survey answers in batches of a thousand rows', '4-backfill', { state: 'closed' }],
  [32848, 'feat: read survey answers from the new table', '5-read-new-table', {}],
  [32850, 'feat: show survey answers on the publication dashboard with filters', '6-dashboard', {}],
  [32841, 'chore: drop the legacy survey writer and its queue', '7-drop-legacy', { draft: true }],
].map(([number, title, ref, extra], index, all) => {
  const below = all[index - 1];
  const base = index < 4 ? branch('main', 1) : branch(`octo/survey-529/${below[2]}`, below[0]);
  return inStack(pr(number, title, branch(`octo/survey-529/${ref}`, number), base, extra), {
    number: 32854,
    position: index + 1,
    size: all.length,
  });
});

// The branch stack above once its bottom PR merged: GitHub moved #45 from repository-metadata onto main.
export const retargetedFixture = () => {
  const prs = structuredClone(stackFixture);
  prs[1].base = branch('main', 1);
  return prs;
};
export const retargetedEvents = { 45: [issueEvent('labeled', 1), issueEvent('automatic_base_change_succeeded', 2)] };

export function stackFixtureRun(prs = stackFixture, events = {}) {
  return async (_cwd, args) => {
    const url = new URL(args.at(-1), 'https://api.github.com/');
    if (url.pathname === '/repos/example/stack-fixture') return JSON.stringify({ default_branch: 'main' });
    const number = /\/pulls\/(\d+)$/.exec(url.pathname)?.[1];
    if (number) return JSON.stringify(prs.find((pr) => pr.number === Number(number)));
    const stack = Number(/\/stacks\/(\d+)$/.exec(url.pathname)?.[1]);
    if (stack) {
      const members = prs.filter((pr) => pr.stack?.number === stack);
      if (!members.length) throw Object.assign(new Error('gh failed'), { stderr: 'gh: Not Found (HTTP 404)' });
      return JSON.stringify(
        stackResponse(
          stack,
          members.toSorted((a, b) => a.stack.position - b.stack.position)
        )
      );
    }
    const issue = /\/issues\/(\d+)\/events$/.exec(url.pathname)?.[1];
    if (issue) return JSON.stringify(events[issue] ?? []);
    const head = url.searchParams.get('head');
    const base = url.searchParams.get('base');
    return JSON.stringify(prs.filter((pr) => (head ? `example:${pr.head.ref}` === head : pr.base.ref === base)));
  };
}
