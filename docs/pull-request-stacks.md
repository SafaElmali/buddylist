# PR stacks

See how a conversation’s pull request relates to other PRs, beside the chat. The view reads GitHub metadata and links each PR to GitHub.

## Open the stack

Choose **View PR stack...** from the PR button’s menu or the **Code** menu. **View > PR stack** and **PR stack** in the side pane’s **+** open the same tab. It needs a conversation with a working folder and GitHub access through the GitHub CLI.

The stack reads top first, as GitHub shows a stack: each PR sits on the one below it, and a line runs down through them to the base branch at the bottom. Each PR is one row: its number and title (the whole title in its tooltip), then whether it is open, a draft, merged or closed, with an icon and colour for each, and its head branch. Branch names the PRs share at the start, such as `you/topic/`, are shortened to `…/`; the tooltip has the whole branch and the branch it goes into. The conversation’s own PR is highlighted and says **Current**, and a long stack opens with it in view.

The header names the stack and how many PRs it has, and says how many of them are merged, for example “3 of 7 merged”. For a GitHub stack, a bar under it shows the stack’s steps from the bottom (left) to the top (right), one segment per PR in its state’s colour, with your conversation’s PR ringed, and each row ends with its step, such as “5 of 7”, where 1 is the bottom of the stack. Stacks found by branch, and GitHub stacks whose order could not be confirmed, have no confirmed steps, so they show neither. Click a PR to open it on GitHub, or move to it with Tab and press Return. **Refresh** asks for current metadata; changes to the conversation’s PR and completed turns also refresh a visible stack.

## Read the relationships

When the PR is part of a stack on GitHub, the header says **Stack #** with its number, and the view lists every PR in it in GitHub’s order, down to the stack’s base branch. This works after the lower PRs merge, when GitHub has moved the rest onto the base branch. GitHub has no page for a stack of its own, so the number is not a link; each PR’s page shows its stack.

Otherwise the header says **Stacked by branch**: a PR’s dependents appear above it on the same line. When several PRs build on one, the view says **Depends on #** with its number, and each of them gets a line of its own, set in, so that siblings never look as if one builds on the other. Confirmation uses GitHub’s repository, branch and commit metadata. A matching branch name alone is not enough. When the PR at the bottom of a line has no confirmed parent, the line ends dashed, at the branch it targets, with why: several possible parents (each a link), a parent that could not be confirmed, or a base branch GitHub changed. Missing metadata, a partial response, a lookup limit or a failed connection is shown in a box above the list.

When GitHub moved a PR to another base branch, for example after the PR below it merged, the end of its line says the PR it was stacked on could not be confirmed. A merged PR with nothing found says that PRs stacked on it may have been moved when it merged. **Standalone pull request** means the PR is in no GitHub stack and has no parent, dependent or moved base. Dependents in a different fork repository are not searched. The view shows at most 24 PRs, so it can say the result is incomplete for a large stack; a GitHub stack then shows the 24 around the current PR and says how many more are above and below.

Opening or refreshing the stack does not rebase, restack, push, publish or merge anything.

## Keep the tab available

Click the pin beside the tab’s name, or choose **Pin tab** in its right-click menu. The pin belongs to this conversation and survives reopening the window or restarting buddylist. **Unpin tab** returns it to its usual behavior; **Close** removes it and its pin.

An archived conversation can still read its stack. If its checkout is missing, a pinned tab explains why it is unavailable and can still be closed or unpinned. See the [conversation guide](conversations.md#the-side-pane-files-changes-and-checks-above-what-runs-below) for the other tabs and pin controls.
