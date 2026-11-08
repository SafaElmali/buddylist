// Read-only, on-demand stack discovery. All requests are bounded GitHub GETs through gh.
import {
  githubStack,
  prReference,
  stackForest,
  stackMembership,
  stackParent,
  stackPullRequest,
} from '../shared/pr-stack.js';
import { ghTrouble, lastWord, runGh } from './github-lookup.js';

const LIMIT = 100;
const MAX_NODES = 24;
const MAX_REQUESTS = 60;
const EMPTY = { current: null, stack: null, roots: [], count: 0, incomplete: false, notices: [] };
// What GitHub records when a PR's base changes, by hand or when the PR below it merges. REST events
// do not say which branch it left; only GraphQL does.
const RETARGETED = new Set(['base_ref_changed', 'automatic_base_change_succeeded']);

/** `known` must come from the existing verified checkout association, never from the renderer. */
export async function pullRequestStack(cwd, { known = null, run = runGh } = {}) {
  const scope = prReference(known?.url);
  if (!scope || !cwd) return { ...EMPTY };
  let requests = 0;
  const notices = new Set();
  const queryCache = new Map();
  const ask = async (endpoint) => {
    if (requests++ >= MAX_REQUESTS) throw new Error('This stack is too large to load completely.');
    const output = await run(cwd, ['api', '--method', 'GET', '--hostname', scope.host, endpoint]);
    try {
      return JSON.parse(output);
    } catch {
      throw new Error('GitHub returned an unreadable PR stack. Refresh to try again.');
    }
  };
  const path = `repos/${scope.repo}`;
  const list = (key, value) => {
    const query = `${key}=${encodeURIComponent(value)}`;
    if (!queryCache.has(query)) {
      queryCache.set(
        query,
        ask(`${path}/pulls?state=all&per_page=${LIMIT}&${query}`)
          .then((raw) => {
            if (!Array.isArray(raw)) throw new Error('GitHub returned an unreadable PR list.');
            const prs = raw.map((item) => stackPullRequest(item, scope)).filter(Boolean);
            const complete =
              raw.length < LIMIT &&
              prs.length === raw.length &&
              prs.every(
                (pr) => pr.head.repo && pr.head.ref && pr.head.sha && pr.base.repo && pr.base.ref && pr.base.sha
              );
            if (!complete)
              notices.add(
                'Some relationships could not be checked because GitHub returned a limited or incomplete list.'
              );
            return { prs, complete };
          })
          .catch((err) => {
            notices.add(ghTrouble(err) || lastWord(err));
            return { prs: [], complete: false };
          })
      );
    }
    return queryCache.get(query);
  };
  let current;
  let membership;
  try {
    const raw = await ask(`${path}/pulls/${scope.number}`);
    current = stackPullRequest(raw, scope);
    if (!current) throw new Error('GitHub returned incomplete details for this pull request. Refresh to try again.');
    membership = stackMembership(raw);
  } catch (err) {
    throw new Error(ghTrouble(err) || lastWord(err), { cause: err });
  }
  // GitHub's own stack names its members and order, even once merges have moved every PR onto main.
  if (membership === false)
    notices.add('GitHub says this pull request is in a stack, but its stack details could not be read.');
  if (membership) {
    try {
      const answer = githubStack(current, membership, await ask(`${path}/stacks/${membership.number}`), scope, {
        limit: MAX_NODES,
      });
      if (answer) return answer;
      notices.add(
        `GitHub returned unreadable details for stack #${membership.number}, so only branch relationships are shown.`
      );
    } catch (err) {
      notices.add(`GitHub stack #${membership.number} could not be loaded, so only branch relationships are shown.`);
      notices.add(ghTrouble(err) || lastWord(err));
    }
  }
  // A PR with no parent by branch may have had one before GitHub moved its base.
  const baseHistory = async (pr) => {
    try {
      const events = await ask(`${path}/issues/${pr.number}/events?per_page=${LIMIT}`);
      if (!Array.isArray(events)) throw new Error('GitHub returned an unreadable event list.');
      if (events.some((event) => RETARGETED.has(event?.event))) return { kind: 'retargeted', candidates: [] };
      if (events.length >= LIMIT) notices.add(`The base branch history of #${pr.number} could not be fully checked.`);
    } catch (err) {
      notices.add(`The base branch history of #${pr.number} could not be checked. ${ghTrouble(err) || lastWord(err)}`);
    }
    return { kind: 'base', candidates: [] };
  };
  const defaultBranch = await ask(path).then(
    (repo) => (typeof repo?.default_branch === 'string' ? repo.default_branch : ''),
    () => ''
  );
  const nodes = new Map([[current.url, current]]);
  const relationships = new Map();
  const parentCache = new Map();
  const parentOf = (pr) => {
    if (!parentCache.has(pr.url)) {
      parentCache.set(
        pr.url,
        (async () => {
          if (pr.base.ref === defaultBranch && defaultBranch) return stackParent(pr, [], { defaultBranch });
          if (!pr.base.repo || !pr.base.ref || pr.base.repo !== scope.repo.toLowerCase())
            return { kind: 'unknown', candidates: [] };
          const answer = await list('head', `${pr.base.repo.split('/')[0]}:${pr.base.ref}`);
          return stackParent(pr, answer.prs, { complete: answer.complete, defaultBranch });
        })()
      );
    }
    return parentCache.get(pr.url);
  };
  const add = (pr) => {
    if (nodes.has(pr.url)) return;
    if (nodes.size >= MAX_NODES) {
      notices.add(`Only the first ${MAX_NODES} related pull requests are shown. Open GitHub to explore further.`);
      return;
    }
    nodes.set(pr.url, pr);
  };
  // Map iteration visits additions too. Each related PR is inspected once; unrelated PRs never become rows.
  for (const pr of nodes.values()) {
    const parent = await parentOf(pr);
    relationships.set(pr.url, parent.kind === 'base' ? await baseHistory(pr) : parent);
    if (parent.parent) {
      const { prs } = await list('head', `${pr.base.repo.split('/')[0]}:${pr.base.ref}`);
      add(prs.find((candidate) => candidate.url === parent.parent));
    }
    if (!pr.head.repo || !pr.head.ref || !pr.head.sha) {
      notices.add(
        `Dependents of #${pr.number} could not be checked because its head repository or branch metadata is missing.`
      );
      continue;
    }
    if (pr.head.repo !== scope.repo.toLowerCase()) {
      notices.add(`Dependents in the fork ${pr.head.repo} are not included.`);
      continue;
    }
    const dependents = await list('base', pr.head.ref);
    for (const child of dependents.prs) {
      if (child.url === pr.url || child.base.repo !== pr.head.repo) continue;
      const relationship = await parentOf(child);
      if (relationship.parent === pr.url) add(child);
      else if (['unknown', 'ambiguous'].includes(relationship.kind))
        notices.add(`The relationship between #${pr.number} and #${child.number} could not be confirmed.`);
    }
  }
  return stackForest(current, [...nodes.values()], relationships, [...notices]);
}
