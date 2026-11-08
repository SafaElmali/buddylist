// A verified PR belongs to a particular checkout and branch incarnation, not just a folder name.
// Keep that evidence with the contact so a cleanup checkout or restart does not erase its badge.
import fs from 'node:fs';
import { branchStart, ghPullRequest, parsePullRequest, pullRequestPageOf } from './contact-card.js';
import { git } from './worktrees.js';

const recent = new Map();
const FRESH_MS = 30_000;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const oid = (value) => /^[0-9a-f]{40,64}$/.test(value ?? '');

/** Canonical host/owner/repository, without credentials or a transport-specific spelling. */
function repository(url) {
  const match = /^(?:https?:\/\/(?:[^/@]+@)?|ssh:\/\/(?:[^/@]+@)?|[^/@]+@)([^/:]+)[:/]([^/]+\/[^/]+?)\/?$/.exec(url);
  return match ? `${match[1]}/${match[2].replace(/\.git$/, '')}`.toLowerCase() : null;
}

// A deleted branch takes its own reflog with it. HEAD still records when this checkout
// entered the branch; follow renames back to that arrival, without searching older tasks.
function sourceFromHead(entries, name) {
  let source = name;
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const rename = /^Branch: renamed refs\/heads\/(.+) to refs\/heads\/(.+)$/.exec(entry.message);
    if (rename?.[2] === source) source = rename[1];
    const arrived = /^checkout: moving from .+ to (.+)$/.exec(entry.message);
    if (arrived?.[1] !== source) continue;
    // Git dates have second precision. Two identical arrivals within that second cannot
    // prove which incarnation an older saved record belonged to after its reflog is gone.
    const ambiguous = entries
      .slice(i + 1)
      .some(
        (older) =>
          older.at === entry.at &&
          older.head === entry.head &&
          /^checkout: moving from .+ to (.+)$/.exec(older.message)?.[1] === source
      );
    return entry.at ? { at: entry.at, commit: entry.head, fromHead: true, ...(ambiguous && { ambiguous }) } : null;
  }
  const first = entries.at(-1);
  // The bounded history may stop partway through a task. Only a visible creation entry
  // establishes its beginning; an arbitrary oldest commit is not branch creation proof.
  return first?.at && /^(?:$|commit \(initial\):|clone:)/.test(first.message)
    ? { at: first.at, commit: first.head, fromHead: true }
    : null;
}

/** Only the most recent checkout can recover a lost association; never search chat or sibling trees. */
export async function pullRequestContext(cwd) {
  const [dir, head, branch, remotes, log, start] = await Promise.all([
    git(cwd, ['rev-parse', '--absolute-git-dir']),
    git(cwd, ['rev-parse', 'HEAD']),
    git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).then((value) => (value === 'HEAD' ? null : value)),
    git(cwd, ['remote', '-v']),
    git(cwd, ['reflog', 'show', '-40', '--date=unix', '--format=%H%x09%gD%x09%gs', 'HEAD']),
    branchStart(cwd),
  ]);
  const real = fs.realpathSync(dir);
  const stat = fs.statSync(real);
  const repositories = [
    ...new Set(
      remotes
        .split('\n')
        .map((line) => repository(line.split(/\s+/)[1]))
        .filter(Boolean)
    ),
  ].sort();
  const scope = { dir: real, born: stat.birthtimeMs, inode: stat.ino, repositories };
  let departure = null;
  let departedAt = -1;
  const entries = log.split('\n').map((line) => {
    const [head, selector, message = ''] = line.split('\t');
    const seconds = /@\{(\d+)\}$/.exec(selector)?.[1];
    return { head, at: seconds ? Number(seconds) * 1000 : null, message };
  });
  for (let i = 0; i < entries.length - 1; i += 1) {
    const { message } = entries[i];
    // New commits after leaving a branch are new work, not cleanup of the previous task.
    if (/^(commit|cherry-pick|rebase)/.test(message ?? '')) break;
    const match = /^checkout: moving from (.+) to (.+)$/.exec(message ?? '');
    if (!match) continue;
    if (oid(match[1])) continue; // checking another main revision while already detached
    departure = { branch: match[1], head: entries[i + 1].head };
    departedAt = i;
    break;
  }
  const defaultRef = await git(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).catch(
    () => null
  );
  const cleanup = !branch || branch === defaultRef?.replace(/^origin\//, '');
  if (!cleanup) departure = null;
  const sourceBranch = departure?.branch || branch;
  let tracking = null;
  let sourceStart = start;
  if (sourceBranch) {
    const [remote, merge, history] = await Promise.all([
      git(cwd, ['config', '--get', `branch.${sourceBranch}.remote`]).catch(() => null),
      git(cwd, ['config', '--get', `branch.${sourceBranch}.merge`]).catch(() => null),
      departure
        ? git(cwd, ['reflog', 'show', '--date=unix', '--format=%gd %H', `refs/heads/${sourceBranch}`, '--']).catch(
            () => ''
          )
        : '',
    ]);
    const address =
      remote &&
      (repository(remote) ||
        repository(
          remotes
            .split('\n')
            .find((line) => line.startsWith(`${remote}\t`))
            ?.split(/\s+/)[1]
        ));
    tracking = { branch: merge?.replace(/^refs\/heads\//, ''), repository: address };
    if (departure) {
      const [, seconds, commit] = /@\{(\d+)\} ([0-9a-f]+)$/.exec(history.split(/\r?\n/).pop()) ?? [];
      sourceStart = seconds
        ? { at: Number(seconds) * 1000, commit }
        : sourceFromHead(entries.slice(departedAt + 1), sourceBranch);
    }
    // The reflog's creation identity distinguishes delete/recreate even in the same second
    // and on the same commit. Appends and branch renames leave that identity alone.
    const logPath = await git(cwd, [
      'rev-parse',
      '--path-format=absolute',
      '--git-path',
      `logs/refs/heads/${sourceBranch}`,
    ]);
    try {
      const logStat = fs.statSync(logPath);
      if (sourceStart) sourceStart = { ...sourceStart, born: logStat.birthtimeMs, inode: logStat.ino };
    } catch {
      /* Reflogs can be disabled or a merged branch can have been deleted. */
    }
  }
  return { scope, branch, start: departure ? start : sourceStart, head, departure, tracking, sourceStart };
}

function sameSource(a, b) {
  if (!a || !b || a.ambiguous || b.ambiguous) return false;
  if (!a.fromHead && !b.fromHead) return same(a, b);
  return a.at === b.at && a.commit === b.commit;
}

function belongs(record, context) {
  if (!record?.pr || !same(record.scope, context.scope)) return false;
  if (context.branch === record.branch) {
    const ended = ['merged', 'closed'].includes(record.pr.state);
    return (
      sameSource(context.start, record.start) && (!ended || [record.head, record.headRefOid].includes(context.head))
    );
  }
  return (
    context.departure?.branch === record.branch &&
    [record.head, record.headRefOid].includes(context.departure.head) &&
    sameSource(context.sourceStart, record.start)
  );
}

function verified(output, context, knownUrl = null) {
  const pr = parsePullRequest(output);
  if (!pr || !pullRequestPageOf(pr.url)) return null;
  const raw = JSON.parse(output);
  if (!oid(raw.headRefOid) || !raw.headRefName) return null;
  const page = new URL(pr.url);
  const base = `${page.hostname}${page.pathname.replace(/\/pull\/\d+.*$/, '')}`.toLowerCase();
  const fork =
    raw.headRepository?.nameWithOwner ||
    (raw.headRepositoryOwner?.login &&
      raw.headRepository?.name &&
      `${raw.headRepositoryOwner.login}/${raw.headRepository.name}`);
  const headRepo = fork && `${page.hostname}/${fork}`.toLowerCase();
  if (!context.scope.repositories.includes(base) && !context.scope.repositories.includes(headRepo)) return null;
  // GitHub loses the fork metadata when its repository is deleted. A previously verified
  // URL in the same checkout still identifies that PR; this does not establish a new one.
  const deletedKnownFork = !headRepo && pr.url === knownUrl && context.scope.repositories.includes(base);
  if (
    raw.isCrossRepository &&
    !context.scope.repositories.includes(headRepo) &&
    context.tracking?.repository !== headRepo &&
    !deletedKnownFork
  )
    return null;
  return { pr, raw };
}

/** Returns both display data and durable evidence; the caller saves only an accepted, current answer. */
export async function associatedPullRequest(
  cwd,
  record = null,
  {
    run = (dir, ref) => ghPullRequest({ cwd: dir, page: ref }),
    context = pullRequestContext,
    contains = (dir, commit) =>
      git(dir, ['merge-base', '--is-ancestor', commit, 'HEAD']).then(
        () => true,
        () => false
      ),
    now = Date.now,
  } = {}
) {
  const cached = recent.get(cwd);
  if (cached && now() - cached.at < FRESH_MS) return cached.answer;
  const ask = async () => {
    let current;
    try {
      current = await context(cwd);
    } catch {
      return { pr: null, record };
    }
    const retained = belongs(record, current);
    const barrier = record?.reset
      ? record
      : record?.pr && !retained
        ? { reset: true, after: now(), excluded: record.pr.url }
        : null;
    const empty = { pr: null, record: barrier };
    let found;
    let recovered = false;
    let source = { branch: current.branch, start: current.start, head: current.head };
    try {
      if (retained && current.branch !== record.branch) {
        // A known URL is authoritative across detach, branch deletion and forks. A new branch
        // incarnation never reaches this path, even when it reuses the previous branch's name.
        found = verified(await run(cwd, record.pr.url), current, record.pr.url);
        source = { branch: record.branch, start: record.start, head: record.head };
        if (!found || found.pr.url !== record.pr.url) return empty;
      } else if (current.branch && !current.departure) {
        const output = await run(cwd);
        if (!output) return empty;
        found = verified(output, current, retained ? record.pr.url : null);
        if (!found) return empty;
        if (
          ![current.branch, current.tracking?.branch].includes(found.raw.headRefName) ||
          (found.raw.headRefOid !== current.head && !(await contains(cwd, found.raw.headRefOid)))
        )
          return empty;
        const ended = Date.parse(found.raw.closedAt);
        // Once it is over, later commits on a still-existing branch are new work. An
        // ancestor match is useful for an open PR with local edits, not for a finished one.
        if (['merged', 'closed'].includes(found.pr.state) && found.raw.headRefOid !== current.head) return empty;
        if (barrier && (found.pr.url === barrier.excluded || (ended && ended <= barrier.after))) return empty;
        if (ended && current.start && ended < current.start.at && found.raw.headRefOid !== current.start.commit)
          return empty;
      } else {
        // Migration/recovery for an already-detached worker: the last checkout's exact old
        // commit must be the merged PR's head. Main's merge commit or a branch name alone is not proof.
        if (!current.departure) return empty;
        const output = await run(cwd, current.departure.branch);
        if (!output) return empty;
        found = verified(output, current);
        if (
          !found ||
          found.pr.state !== 'merged' ||
          found.raw.headRefOid !== current.departure.head ||
          ![current.departure.branch, current.tracking?.branch].includes(found.raw.headRefName)
        )
          return empty;
        if (
          !current.sourceStart ||
          current.sourceStart.ambiguous ||
          !(Date.parse(found.raw.closedAt) > current.sourceStart.at)
        )
          return empty;
        if (barrier && (found.pr.url === barrier.excluded || !(Date.parse(found.raw.closedAt) > barrier.after)))
          return empty;
        source = { ...current.departure, start: current.sourceStart };
        recovered = true;
      }
    } catch {
      // A network/auth failure is not evidence that the PR disappeared. Validate the checkout
      // first, so even an offline restart cannot lend the badge to a different repo or branch.
      const unchanged = same(current, await context(cwd).catch(() => null));
      return retained && unchanged ? { pr: record.pr, record } : { pr: null, record: barrier || record };
    }
    if (!same(current, await context(cwd).catch(() => null))) return { pr: null, record };
    return {
      pr: found.pr,
      record: { scope: current.scope, ...source, headRefOid: found.raw.headRefOid, pr: found.pr },
      ...(recovered && { recovered: true }),
    };
  };
  const answer = ask();
  recent.set(cwd, { at: now(), answer });
  return answer;
}

export function forgetPullRequestAssociation(cwd) {
  recent.delete(cwd);
}
