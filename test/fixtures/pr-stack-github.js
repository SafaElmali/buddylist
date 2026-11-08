// GitHub's REST shapes for its own stacks and for base-branch events, as GitHub returned them on
// 2026-10-31 (GET pulls/:n, GET stacks/:n and GET issues/:n/events), with synthetic names and commits.
const user = { login: 'octo', id: 1, node_id: 'U_1', type: 'User', site_admin: false };
const api = (html) =>
  html.replace(/^https:\/\/([^/]+)\/([^/]+\/[^/]+)\/pull\/(\d+)$/, 'https://api.$1/repos/$2/pulls/$3');
// Members name their repository by API address and short name only, without full_name.
const repository = (full) => ({ id: 1, url: `https://api.github.com/repos/${full}`, name: full.split('/')[1] });

/** The `stack` field GET pulls/:n adds for a member of a stack. A PR in no stack has no such field. */
export const inStack = (pr, { number, position, size, base = 'main' }) => ({
  ...pr,
  stack: { base: { ref: base, sha: 'f'.repeat(40) }, id: number * 10, number, position, size },
});

/** GET stacks/:n: its members bottom to top, in the shorter shape GitHub lists them in. */
export const stackResponse = (number, prs, { base = 'main' } = {}) => ({
  id: number * 10,
  number,
  node_id: `PRS_${number}`,
  url: api(prs[0].html_url).replace(/pulls\/\d+$/, `stacks/${number}`),
  base: { ref: base },
  open: true,
  created_at: '2026-10-27T20:22:26Z',
  pull_requests: prs.map((pr) => ({
    url: api(pr.html_url),
    id: pr.number * 10,
    number: pr.number,
    head: { ref: pr.head.ref, sha: pr.head.sha, repo: repository(pr.head.repo.full_name) },
    base: { ref: pr.base.ref, sha: pr.base.sha, repo: repository(pr.base.repo.full_name) },
    node_id: `PR_${pr.number}`,
    title: pr.title,
    state: pr.state,
    merged_at: pr.merged_at ?? null,
    draft: Boolean(pr.draft),
    html_url: pr.html_url,
    user,
  })),
});

/** One entry of GET issues/:n/events. A base change names no branches here; only GraphQL says which. */
export const issueEvent = (event, id = 1) => ({
  id,
  node_id: `E_${id}`,
  url: `https://api.github.com/repos/o/r/issues/events/${id}`,
  actor: user,
  event,
  commit_id: null,
  commit_url: null,
  created_at: '2026-10-31T08:24:52Z',
  performed_via_github_app: null,
});
