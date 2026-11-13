// GitHub's own stack names its members and their order. Without one, a stack edge needs the same
// repository, branch and commit at both ends. PR numbers, titles, local worktree order and
// branch-name conventions are never dependency evidence.
const repository = (value) => (typeof value === 'string' ? value.toLowerCase() : '');
const oid = (value) => typeof value === 'string' && /^[0-9a-f]{40,64}$/i.test(value);
// A stack's members name their repository by its API address only.
const repositoryOf = (repo) =>
  repository(repo?.full_name) || repository(/\/repos\/([\w.-]+\/[\w.-]+)$/.exec(repo?.url ?? '')?.[1]);
const count = (value) => Number.isSafeInteger(value) && value > 0;

export function prReference(value) {
  if (typeof value !== 'string') return null;
  const match = /^https:\/\/([^/:?#@]+)\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d*)\/?$/.exec(value);
  if (!match || !Number.isSafeInteger(Number(match[3]))) return null;
  return { host: match[1].toLowerCase(), repo: match[2], number: Number(match[3]) };
}

/** Normalize GitHub REST metadata; never turn a malformed response into an empty stack. */
export function stackPullRequest(value, scope) {
  const ref = prReference(value?.html_url);
  if (
    !ref ||
    ref.number !== value.number ||
    ref.host !== scope.host ||
    repository(ref.repo) !== repository(scope.repo) ||
    !['open', 'closed'].includes(value.state)
  )
    return null;
  const branch = (part) => ({
    repo: repositoryOf(part?.repo),
    ref: typeof part?.ref === 'string' ? part.ref : '',
    sha: oid(part?.sha) ? part.sha.toLowerCase() : '',
  });
  return {
    number: value.number,
    url: value.html_url,
    title: String(value.title ?? ''),
    state: value.merged_at ? 'merged' : value.state === 'closed' ? 'closed' : value.draft ? 'draft' : 'open',
    head: branch(value.head),
    base: branch(value.base),
  };
}

/** GitHub's own stack from GET pulls/:n: null for a PR in no stack, false when its `stack` is unreadable. */
export function stackMembership(value) {
  if (value?.stack == null) return null;
  const { number, position, size, base } = value.stack;
  if (!count(number) || !count(position) || !count(size) || position > size) return false;
  return { number, position, size, base: typeof base?.ref === 'string' ? base.ref : '' };
}

/**
 * GitHub's own stack from GET stacks/:n, bottom to top. Every member may target the default branch
 * once lower ones merge, so its order comes from GitHub, trusted only when the whole list agrees with
 * the position and size GitHub gave the current PR. Otherwise its members are listed by number.
 * @returns {object | null}  null when the answer is not this stack's
 */
export function githubStack(current, membership, value, scope, { limit = Infinity, notices = [] } = {}) {
  if (value?.number !== membership.number || !Array.isArray(value.pull_requests)) return null;
  const listed = value.pull_requests;
  const members = [
    ...new Map(
      listed
        .map((item) => stackPullRequest(item, scope))
        .filter(Boolean)
        .map((pr) => [pr.url, pr])
    ).values(),
  ];
  notices = [...notices];
  if (members.length < listed.length)
    notices.push(`GitHub returned incomplete details for some entries of stack #${membership.number}.`);
  const index = members.findIndex((pr) => pr.url === current.url);
  const ordered =
    members.length === listed.length && listed.length === membership.size && index === membership.position - 1;
  // The current PR's own lookup is the fresher answer.
  let rows = members.map((pr, at) => (at === index ? current : pr));
  if (index < 0) rows.push(current);
  if (!ordered) {
    notices.push(`The order of GitHub stack #${membership.number} could not be confirmed.`);
    rows.sort((a, b) => a.number - b.number);
  }
  rows = rows.map((pr, at) => ({
    ...pr,
    position: ordered ? at + 1 : null,
    relationship: { kind: ordered ? 'stacked' : 'unknown', candidates: [] },
    children: [],
  }));
  if (rows.length > limit) {
    const at = rows.findIndex((pr) => pr.url === current.url);
    const start = Math.min(Math.max(at - Math.floor(limit / 2), 0), rows.length - limit);
    notices.push(
      `Only ${limit} of the ${rows.length} pull requests in this stack are shown. Open GitHub to see the rest.`
    );
    rows = rows.slice(start, start + limit);
  }
  return {
    current: current.url,
    stack: {
      number: membership.number,
      size: membership.size,
      base: typeof value.base?.ref === 'string' ? value.base.ref : membership.base,
      ordered,
    },
    roots: rows,
    count: rows.length,
    incomplete: notices.length > 0,
    notices: [...new Set(notices)],
  };
}

/** Every row of a stack, those on other rows' rails too. */
export const stackMembers = (prs) => prs.flatMap((pr) => [pr, ...stackMembers(pr.children ?? [])]);

/** Resolve one parent only when a complete lookup has exactly one matching commit. */
export function stackParent(pr, candidates, { complete = true, defaultBranch = '' } = {}) {
  if (!pr.base.repo || !pr.base.ref || !pr.base.sha) return { kind: 'unknown', candidates: [] };
  if (pr.base.ref && pr.base.ref === defaultBranch) return { kind: 'base', candidates: [] };
  complete &&= candidates.every((other) => other.head.repo && other.head.ref && other.head.sha);
  const possible = candidates.filter(
    (other) =>
      other.url !== pr.url &&
      other.head.repo &&
      other.head.repo === pr.base.repo &&
      other.head.ref &&
      other.head.ref === pr.base.ref
  );
  const exact = possible.filter((other) => pr.base.sha && other.head.sha === pr.base.sha);
  if (complete && exact.length === 1) return { kind: 'linked', parent: exact[0].url, candidates: [] };
  if (complete && !possible.length && pr.base.repo && pr.base.ref && pr.base.sha)
    return { kind: 'base', candidates: [] };
  return { kind: exact.length > 1 ? 'ambiguous' : 'unknown', candidates: possible };
}

/** Turn confirmed relationships into a forest. Cycles are incomplete metadata, never an ordered stack. */
export function stackForest(current, nodes, relationships, notices = []) {
  const byUrl = new Map(nodes.map((pr) => [pr.url, pr]));
  const parents = new Map(relationships);
  for (const pr of nodes) {
    const seen = new Set();
    let url = pr.url;
    while (url && byUrl.has(url)) {
      if (seen.has(url)) {
        for (const member of seen) parents.set(member, { kind: 'unknown', candidates: [] });
        notices = [...notices, 'GitHub returned circular relationships. Their order could not be confirmed.'];
        break;
      }
      seen.add(url);
      url = parents.get(url)?.parent;
    }
  }
  const rows = nodes.map((pr) => ({ ...pr, relationship: parents.get(pr.url) ?? { kind: 'unknown', candidates: [] } }));
  const children = (url) => rows.filter((pr) => pr.relationship.parent === url).sort((a, b) => a.number - b.number);
  const tree = (pr) => ({ ...pr, children: children(pr.url).map(tree) });
  const roots = rows.filter((pr) => !byUrl.has(pr.relationship.parent)).map(tree);
  const incomplete =
    notices.length > 0 || rows.some((pr) => ['unknown', 'ambiguous', 'retargeted'].includes(pr.relationship.kind));
  return { current: current.url, stack: null, roots, count: rows.length, incomplete, notices: [...new Set(notices)] };
}
