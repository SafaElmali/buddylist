// The conversation's Create PR button, in words: what it says while a branch has no pull
// request, once it has one and once that one is merged or closed, how its checks stand and whether GitHub is to merge it
// by itself and whether its contact is archived once it is merged, what its menu offers, the
// message that asks a contact for one, the one that asks
// for its conflicts to be resolved, and the page on GitHub where you open one yourself.
import {
  checksStanding,
  checksText,
  hasConflict,
  isOpen,
  pullRequestLine,
  pullRequestTags,
} from './pull-request-text.js';

/** @typedef {import('../main/contact-card.js').PullRequest} PullRequest */
/** @typedef {import('../main/contact-card.js').MergeMethod} MergeMethod */

/**
 * What the button shows.
 * @typedef {Object} Face
 * @property {string} label  the button in words, as the menus and the palette list it: "Create PR", "View PR #12",
 *   "PR #12 · Merged"
 * @property {string} name  what the button itself says before its tag, such as "PR #12"; the label without one
 * @property {{ kind: 'merged' | 'closed', text: string } | null} tag  the tag a pull request that is merged or closed
 *   wears on the button, as on its contact's row; null otherwise
 * @property {string} more  the helper line of its ▼
 * @property {string} title
 * @property {string | null} url  the pull request it opens on GitHub; null while it asks for one
 * @property {boolean} disabled
 * @property {'failing' | 'running' | 'passed' | null} checks  how its checks stand, for the mark on the
 *   button; null without a pull request to be merged, or checks on it
 * @property {string} checksText  the same in words, such as "2 checks failing"; '' when there is nothing to say
 * @property {MergeMethod | null} autoMerge  how GitHub merges it by itself; null while auto-merge is off
 * @property {boolean} draft  it is a draft, which GitHub does not merge
 * @property {boolean} conflict  it can't be merged until its conflicts with the base branch are resolved:
 *   Fix conflicts is there for that
 * @property {boolean} archiveMerged  its contact is archived once the app sees it merged: the contact's own
 *   choice, or else what Settings > Git says
 * @property {number | null} number  the pull request's; null while it asks for one
 * @property {boolean} linked  it was linked to the conversation by hand, not found by its branch: it wears a Linked tag
 * @property {{ number: number, linked?: true } | null} other  where the branch has one of its own besides the linked
 *   one, the one not shown: `linked` when that is the linked one
 */

/** How GitHub merges, in the words of its own merge button. */
const MERGED_BY = { squash: 'squash and merge', merge: 'merge', rebase: 'rebase and merge' };

/** How the checks stand, beside the menu's way to them: in full while one fails, in a word otherwise. */
const CHECKS_HINT = { running: 'running', passed: 'passed' };

/** What a pull request without one is, for the faces that ask for one. */
const NO_PULL_REQUEST = {
  tag: null,
  more: 'Other ways to create a pull request',
  checks: null,
  checksText: '',
  autoMerge: null,
  draft: false,
  conflict: false,
  archiveMerged: false,
  number: null,
  linked: false,
  other: null,
};

/** Where it came from, as the shown pull request says: linked by hand, and the other one there is, if any. */
const origin = (pr) => ({ number: pr.number, linked: pr.linked === true, other: pr.other ?? null });

/**
 * What auto-merge does, as a sentence: "GitHub will squash and merge it when its requirements are met."
 * @param {MergeMethod} method
 * @param {boolean} [appMerges]  the app merges it, where GitHub had nothing to wait for
 */
export const autoMergeText = (method, appMerges = false) =>
  appMerges
    ? `buddylist will ${MERGED_BY[method] ?? 'merge'} it once its checks pass, while it is open.`
    : `GitHub will ${MERGED_BY[method] ?? 'merge'} it when its requirements are met.`;

/**
 * What the conversation says once auto-merge was turned on or off.
 * @param {number} number  the pull request's
 * @param {MergeMethod | null} method  how it is merged now; null once it is off
 * @param {{ appMerges?: boolean, merged?: boolean }} [how]  `appMerges`: by the app, as GitHub had nothing to
 *   wait for. `merged`: by the app at once, as nothing was left to pass
 */
export const autoMergeNotice = (number, method, { appMerges = false, merged = false } = {}) => {
  if (merged) return `Merged pull request #${number}: nothing was left to pass.`;
  if (!method) return `Auto-merge is off for pull request #${number}.`;
  const why = appMerges ? ' Its base branch requires nothing GitHub could wait for.' : '';
  return `Auto-merge is on for pull request #${number}: ${autoMergeText(method, appMerges)}${why}`;
};

/**
 * The button's faces. A branch whose pull request is still to be merged has that one to show.
 * One that is merged or closed is still the branch's: the button opens it, wearing its tag, and
 * the ways to another are in its ▼, for whoever wants a second on the same branch. Continue, beside
 * it, goes on to a new branch instead. A branch without one can get one.
 * @param {{ status?: string, pullRequest?: PullRequest | null, archiveMerged?: boolean } | null} contact  as the
 *   contact list shows it
 * @param {string | null} who  the name of whoever would be asked for one; null to choose an agent
 * @param {{ archiveMerged?: boolean }} [settings]  `archiveMerged`: what Settings > Git says for a contact that
 *   has not chosen
 * @returns {Face}
 */
export function pullRequestButton(contact, who, settings = {}) {
  // A folder that is gone has no branch left to have a pull request.
  if (contact?.status === 'offline') {
    return {
      label: 'Create PR',
      name: 'Create PR',
      title: 'The working folder is gone, so there is no branch here',
      url: null,
      disabled: true,
      ...NO_PULL_REQUEST,
    };
  }
  const pr = contact?.pullRequest;
  if (isOpen(pr)) {
    const autoMerge = pr.autoMerge ?? null;
    const title = [
      pullRequestLine(pr),
      pr.title,
      autoMerge && `Auto-merge is on: ${autoMergeText(autoMerge, pr.appMerges)}`,
      pr.linked && 'Linked to this conversation, not found by its branch.',
      'Click to open it on GitHub.',
    ]
      .filter(Boolean)
      .join('\n');
    return {
      label: `View PR #${pr.number}`,
      name: `View PR #${pr.number}`,
      tag: null,
      more: 'Its checks, and auto-merge',
      title,
      url: pr.url,
      disabled: false,
      checks: checksStanding(pr),
      checksText: checksText(pr),
      autoMerge,
      draft: pr.state === 'draft',
      conflict: hasConflict(pr),
      archiveMerged: contact.archiveMerged ?? Boolean(settings.archiveMerged),
      ...origin(pr),
    };
  }
  if (pr) {
    const [tag] = pullRequestTags(pr);
    return {
      ...NO_PULL_REQUEST,
      label: `PR #${pr.number} · ${tag.text}`,
      name: `PR #${pr.number}`,
      tag,
      more: 'Create another pull request on this branch',
      title: [
        pullRequestLine(pr),
        pr.title,
        pr.linked && 'Linked to this conversation, not found by its branch.',
        'Click to open it on GitHub.',
      ]
        .filter(Boolean)
        .join('\n'),
      url: pr.url,
      disabled: false,
      ...origin(pr),
    };
  }
  return {
    label: 'Create PR',
    name: 'Create PR',
    title: who
      ? `Ask ${who} to commit, push and open a pull request`
      : 'Choose an agent to commit, push and open a pull request',
    url: null,
    disabled: false,
    ...NO_PULL_REQUEST,
  };
}

/**
 * The message that asks for a pull request, as you could have typed it. With several
 * agents in the conversation it mentions one, or each of them would open one in turn.
 * @param {{ draft?: boolean, to?: string | null }} [opts]  `to`: the name of the one to mention
 */
export function pullRequestMessage({ draft = false, to = null } = {}) {
  const kind = draft ? 'draft pull request' : 'pull request';
  const text =
    `Create a ${kind} for the work on this branch. Commit what is not committed yet, push the branch, ` +
    `and open the ${kind} with the GitHub CLI (gh pr create${draft ? ' --draft' : ''}), with a title and ` +
    "a description that say what changed and why. If this folder is on the project's main branch, or on a " +
    'branch whose pull request is already merged, start a new branch from the latest main branch for the ' +
    'work first. Then tell me the link.';
  return to ? `@${to} ${text}` : text;
}

/**
 * The helper line of Fix conflicts, the button next to View PR while its pull request has conflicts.
 * @param {string} who  the name of whoever would be asked
 */
export const fixConflictsTip = (who) => `Ask ${who} to merge the base branch in and resolve the conflicts`;

/**
 * The message that asks for a pull request's conflicts with its base branch to be resolved, as you
 * could have typed it. The base branch is merged in, not rebased onto, so the branch is pushed without
 * rewriting what GitHub has of it. With several agents here it mentions one, as the one that asks for
 * a pull request does.
 * @param {number} number  the pull request's
 * @param {{ to?: string | null }} [opts]  `to`: the name of the one to mention
 */
export function fixConflictsMessage(number, { to = null } = {}) {
  const text =
    `Pull request #${number} has merge conflicts with its base branch. Fetch the latest base branch ` +
    '(gh pr view --json baseRefName names it), merge it into this branch and resolve every conflict, keeping ' +
    'what both sides meant to do. Run the tests that cover the files you touched, then commit the merge and ' +
    'push the branch, without rewriting its history. Then tell me which files conflicted and how you resolved them.';
  return to ? `@${to} ${text}` : text;
}

/**
 * Every way to a pull request, as a conversation's Code menu lists them: what the button does, then
 * what its ▼ offers. A branch that has a pull request offers to view it, its checks, and
 * auto-merge, which is ticked while it is on. A draft is not merged by itself, so auto-merge
 * is only there to turn off for one. One with conflicts offers to have them resolved too. Last,
 * whether its contact is archived once it is merged, ticked while it is to be. One that is merged
 * or closed offers to view it, then the ways to another.
 * @param {Face} face
 * @param {object} actions
 * @param {() => void} actions.open
 * @param {(opts: { draft: boolean, participantId?: string }) => void} actions.create
 * @param {() => void} actions.manually
 * @param {() => void} [actions.checks]  shows the pull request's checks
 * @param {() => void} [actions.stack]  shows the pull request's relationships
 * @param {(on: boolean) => void} [actions.autoMerge]  turns auto-merge on or off
 * @param {() => void} [actions.fixConflicts]  asks for its conflicts to be resolved
 * @param {(on: boolean) => void} [actions.archiveMerged]  has the contact archived once it is merged, or not
 * @param {() => void} [actions.link]  links a pull request to the conversation by hand, in its own dialog
 * @param {() => void} [actions.unlink]  takes the linked one away
 * @param {(which: 'branch' | 'linked') => void} [actions.showOther]  shows the branch's own, or the linked one
 * @param {{ id: string, name: string }[]} [participants]  with several agents, choose who creates it
 * @returns {import('../renderer/lib/menu.js').MenuItem[]}
 */
export function pullRequestMenuItems(
  face,
  { open, create, manually, checks, stack, autoMerge, fixConflicts, archiveMerged, link, unlink, showOther },
  participants = []
) {
  const stackItem = face.url && stack ? [{ label: 'View PR stack...', action: stack }] : [];
  // A folder that is gone has nothing to link one to.
  const linking = link && !face.disabled ? [{ separator: true }, ...linkItems(face, { link, unlink, showOther })] : [];
  if (face.url && !face.tag) {
    const on = Boolean(face.autoMerge);
    return [
      { label: face.label, action: open },
      ...stackItem,
      {
        label: face.checks === 'failing' ? 'Show failed checks' : 'Show checks',
        hint: face.checks === 'failing' ? face.checksText : (CHECKS_HINT[face.checks] ?? ''),
        action: checks,
      },
      ...(face.conflict ? [{ label: 'Fix conflicts', action: fixConflicts }] : []),
      {
        label: 'Auto-merge',
        checked: on,
        hint: on ? MERGED_BY[face.autoMerge] : face.draft ? 'not for a draft' : '',
        disabled: face.draft && !on,
        action: () => autoMerge?.(!on),
      },
      {
        label: 'Archive once merged',
        checked: face.archiveMerged,
        action: () => archiveMerged?.(!face.archiveMerged),
      },
      ...linking,
    ];
  }
  const creation = (label, draft) => ({
    label,
    ...(participants.length > 1
      ? {
          submenu: participants.map(({ id, name }) => ({
            label: `Ask ${name}`,
            action: () => create({ draft, participantId: id }),
          })),
        }
      : { action: () => create({ draft }) }),
  });
  const ways = [
    creation('Create PR', false),
    creation('Create draft PR', true),
    { label: 'Create PR manually', action: manually },
  ].map((item) => ({ ...item, disabled: face.disabled }));
  return face.url ? [{ label: face.label, action: open }, ...stackItem, ...ways, ...linking] : [...ways, ...linking];
}

/**
 * The ▼'s ways to link a pull request by hand: one its branch doesn't lead to, as one pushed under another name. Once
 * one is linked, which it is, the branch's own where there is one too, and Unlink.
 * @param {Face} face
 * @param {{ link: () => void, unlink?: () => void, showOther?: (which: 'branch' | 'linked') => void }} actions
 * @returns {import('../renderer/lib/menu.js').MenuItem[]}
 */
function linkItems(face, { link, unlink, showOther }) {
  const { number, other } = face;
  if (!face.url) return [{ label: 'Link pull request...', action: link }];
  const another = { label: 'Link another pull request...', action: link };
  // The linked one shown, maybe with the branch's own beside it.
  if (face.linked) {
    return [
      {
        label: other
          ? `Showing #${number}, linked here. This branch has #${other.number}.`
          : 'Linked to this conversation, not found by its branch',
        note: true,
      },
      ...(other
        ? [{ label: `Show #${other.number} of this branch instead`, action: () => showOther?.('branch') }]
        : []),
      another,
      { label: `Unlink #${number}`, action: unlink },
    ];
  }
  // The branch's own shown, with one linked beside it.
  if (other?.linked) {
    return [
      { label: `Showing #${number} of this branch. #${other.number} is linked here.`, note: true },
      { label: `Show linked #${other.number} instead`, action: () => showOther?.('linked') },
      another,
      { label: `Unlink #${other.number}`, action: unlink },
    ];
  }
  return [another];
}

// ---- the page on GitHub where you open one yourself ------------------------------------------

// A host has a dot in it. A nickname from ~/.ssh/config, or a drive letter, has none.
const HOST = '([\\w-]+(?:\\.[\\w-]+)+)';
// The owner and the repository: the last .git is not part of its name.
const REPOSITORY = '([\\w.-]+)/([\\w.-]+?)(?:\\.git)?/?';
// "https://github.com/acme/shop.git" and "ssh://git@github.com:22/acme/shop.git".
const WITH_SCHEME = new RegExp(`^(?:https?|ssh|git)://(?:[^@/\\s]+@)?${HOST}(?::\\d+)?/${REPOSITORY}$`, 'i');
// "git@github.com:acme/shop.git", as ssh takes it.
const AS_SSH = new RegExp(`^(?:[\\w.-]+@)?${HOST}:${REPOSITORY}$`);

/**
 * A repository's page on GitHub, read from the address git fetches it from. Any host:
 * a company's own GitHub has the same addresses.
 * @param {unknown} remote  what `git remote get-url` prints
 * @returns {string | null}  null for a folder, a file or anything else that is not a repository on a host
 */
export function repositoryPage(remote) {
  const address = String(remote ?? '').trim();
  const [, host, owner, name] = WITH_SCHEME.exec(address) || AS_SSH.exec(address) || [];
  return host ? `https://${host}/${owner}/${name}` : null;
}

/** The slashes of a branch's name are part of an address. Whatever else it holds is not. */
const inAddress = (branch) => branch.split('/').map(encodeURIComponent).join('/');

/**
 * The page that compares a branch with the project's main line, with the form for a new
 * pull request open: where GitHub has you open one yourself.
 * @param {unknown} remote  what `git remote get-url` prints
 * @param {string} branch
 * @returns {string | null}  null when the remote has no page, or there is no branch
 */
export function comparePage(remote, branch) {
  const page = repositoryPage(remote);
  if (!page || !branch) return null;
  return `${page}/compare/${inAddress(branch)}?expand=1`;
}

/**
 * The page of a branch's files on GitHub.
 * @param {unknown} remote  what `git remote get-url` prints
 * @param {string} branch
 * @returns {string | null}  null when the remote has no page, or there is no branch
 */
export function branchPage(remote, branch) {
  const page = repositoryPage(remote);
  return page && branch ? `${page}/tree/${inAddress(branch)}` : null;
}
