# Repository maintenance

Source, issues, pull requests and releases belong in the public
`SafaElmali/buddylist` repository. Its existing release assets and tags must stay
where installed applications expect them. Do not create a repository named
`buddylist-releases`: that would break the redirect used by older installations.

## Private history

The public source starts with a reviewed snapshot on top of the existing public
history. Keep `SafaElmali/buddylist-app` and `SafaElmali/buddylist-private` private.
Do not merge their branches into public development, push their tags, or mirror
their refs. They contain historical account screenshots and workstation details.
To resume an old change, review its diff and apply only the intended files on a
new public branch. Keep the private source repo writable until its outstanding
pull requests have been handled; archive it only after the transition is verified.

A local pre-push hook in a checkout holding both histories must check **all root
commits** reachable from each outgoing commit, including annotated tags. Merely
checking that the public root is an ancestor does not reject a merge that also
contains private history. Public pushes must have only the existing public root.

## Branches and proof

Keep automatically deleting merged head branches enabled. Preserve branches with
open pull requests. Before deleting any other branch, verify its work was merged
or superseded. Keep historical `pr-media/*` tags in the private repositories.

Public PR screenshots, recordings, CI artifacts and logs are public. Use the
synthetic-account harnesses; inspect proof for real emails, project names and
local paths before uploading it. Prefer attaching proof to its pull request.

## Main branch protection

Configure an enforced rule on public `main` requiring pull requests, resolved
review conversations and the GitHub Actions `test` check on an up-to-date branch.
The app workflow reports `test` on every pull request, including docs-only ones.
Block force pushes and deletion with a separate rule with no bypass actors.

The release workflow uses `GITHUB_TOKEN` to push a tested version commit and tag
atomically. Its GitHub Actions integration needs an exception to the PR/check
rule, but not to the force-push/deletion rule. This exception applies to the
integration, not to one job: keep default workflow permissions read-only, grant
`contents: write` only to the release job, and review workflow changes carefully.
Verify the effective rules before enabling releases; do not silently weaken the
rules if the integration exception is unavailable.

Require approval for workflow runs from outside contributors and enable private
vulnerability reporting. Fork pull requests use `pull_request`, never
`pull_request_target`, and must receive no repository secrets or write token.
