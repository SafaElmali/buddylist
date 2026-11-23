# Repository maintenance

Source, issues, pull requests and releases belong in the public
`SafaElmali/buddylist` repository. Its existing release assets and tags must stay
where installed applications expect them. Do not create a repository named
`buddylist-releases`: that would break the redirect used by older installations.

## Private history

The public source starts with a reviewed snapshot on top of the existing public
history. The two private repositories that held the earlier history,
`SafaElmali/buddylist-app` and `SafaElmali/buddylist-private`, were deleted on
2026-11-23. Their history and old `pr-media/*` media now exist only in a
maintainer's local clone, never on GitHub. Their five still-open ideas were
carried over as public issues #72, #73, #74, #75 and #77.

Never push that history or its tags to the public repository: do not merge its
branches into public development, push its tags, or mirror its refs. It contains
historical account screenshots and workstation details. To resume an old change,
review its diff and apply only the intended files on a new public branch.

A local pre-push hook in a checkout holding both histories must check **all root
commits** reachable from each outgoing commit, including annotated tags. Merely
checking that the public root is an ancestor does not reject a merge that also
contains private history. Public pushes must have only the existing public root.

## Branches and proof

Keep automatically deleting merged head branches enabled. Preserve branches with
open pull requests. Before deleting any other branch, verify its work was merged
or superseded. Historical `pr-media/*` tags from the private history stay in
that local clone; never push them here.

Public PR screenshots, recordings, CI artifacts and logs are public. Use the
synthetic-account harnesses; inspect proof for real emails, project names and
local paths before uploading it. Prefer attaching proof to its pull request.

## Main branch protection

Configure an enforced rule on public `main` requiring pull requests, resolved
review conversations and the GitHub Actions `test` check on an up-to-date branch.
The app workflow reports `test` on every pull request, including docs-only ones.
Block force pushes and deletion with a separate rule with no bypass actors.

Version changes belong in a release prep PR. The release workflow uses
`GITHUB_TOKEN` only to create the tested commit's tag and publish its assets; it
never pushes a branch. Keep main's PR/check rule enforced with no Actions bypass.
Keep default workflow permissions read-only and grant `contents: write` only to
the release job.

## Release tag protection

For `refs/tags/v*`, use an active tag ruleset that restricts updates and deletions,
with no bypass actors. Leave creation unrestricted so the release job's normal
`GITHUB_TOKEN` can create a new version tag. A same-commit retry sends no push;
a different-commit tag collision fails without changing the tag. A rule that also
restricts creation would block releases. Apply or change these rules only after
maintainer review; the release-flow PR proposes the exact configuration.

To remove a mistaken release tag, a repository admin must temporarily disable this ruleset and re-enable it immediately afterwards.

Require approval for workflow runs from outside contributors and enable private
vulnerability reporting. Fork pull requests use `pull_request`, never
`pull_request_target`, and must receive no repository secrets or write token.
