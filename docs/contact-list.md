# The contact list

The contact list works like a status board:

| Status         | Meaning                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 🟢 **Online**  | Ready.                                                                                                                                           |
|                | Also while what it left [in the background](background.md) runs, with an arrow going round on its buddy: "2 commands running in the background". |
|                | Also while an agent's [draft](started-conversations.md) waits for you: "Waiting to start".                                                       |
| 🔴 **Busy**    | Working. The status line says on what, such as "Running npm test".                                                                               |
|                | Also while its [subagents](subagents.md) work on: "2 subagents at work".                                                                         |
| 🟠 **Away**    | Waiting for you to approve something.                                                                                                            |
| ⚪ **Offline** | Its folder is gone.                                                                                                                              |

A contact with something you have not seen yet is in bold, and its buddy wears the count: replies, requests and errors from a conversation you weren't looking at. Open that conversation, or click into it, and it is read.

A contact's name and its status line share its row, and neither is cut short while the row has room for it. Where both need more than there is, what the contact is doing, such as "Thinking…", gets as much of the row as the name, and where it works gets less: the name matters more. A conversation with guests says what it is doing on its second line instead, before who they are, such as _Running pnpm test · with Codex_, and its name has the first line to itself.

**Still at work in the background.** A contact whose turn is over while commands it left [in the background](background.md) still run stays Online, as you can write to it, but its row doesn't look idle: its buddy wears the [Background](background.md) tab's arrow going round, and its line says what runs, such as "2 commands running in the background", in the colour of what a busy contact is doing. Point at the arrow to read that line, which a narrow row cuts short and a row with pull request tags leaves out; a screen reader reads it too. The list beside a conversation and the manager's Team tab show it the same way. The arrow goes as soon as the last of them ends. A contact that is busy, waiting for you or stopped at its [plan limit](accounts.md#stopping-at-the-plan-limit) shows that instead.

**Waiting to start.** A conversation an agent, such as a project's [manager](project-managers.md), drafted for you and didn't start stays Online with nothing running, but its row doesn't look idle either: its buddy wears a play mark, and its line says _Waiting to start_ in the colour of what waits for you, in place of _started by…_. The list beside a conversation shows it too, and a manager's Team tab lists it under **Needs you**. Open it to start it or delete it: see [Started conversations](started-conversations.md). Its line goes once it has started. A draft you made yourself, as Add a Contact makes one from an issue, is yours to finish, and its row is like any other.

Every conversation window has the list too, on its left: see [Your contacts beside the conversation](conversations.md#your-contacts-beside-the-conversation).

**Over the list.** Four rows are a click away from what you do most:

- **New contact** adds one, as the **+** next to the search box does.
- **History** lists every contact's conversations, and the ones you had with Claude Code outside the app by folder: see [Message history](conversations.md#every-contacts-message-history).
- **Search** opens the [command palette](#command-palette), as **⌘K** does.
- **Spending** opens what your contacts cost: see [Spending](#spending). The browser preview has no Spending window, so no row for it.

**A contact's ⋯.** Point at a contact and a **⋯** comes up at the end of its name's line, right before its pull request tags, a manager's **+** and how many are under it, which all sit on that line however many lines the row has. It opens the same menu as a right-click, which also copies the contact's folder path (**Copy path**) and the name of the branch it is on (**Copy branch name**). In a narrow list, **Continue**, **Archive** and **Delete** become icons with labels when you point at them. Pull request sizes give way before tags so the next steps stay inside the row.

**A letter for each choice.** Most rows of a contact's menu end in a letter: press it while the menu is open to choose that row, as a click would. **P** pins or unpins, **U** marks as unread or read, **A** archives (or restores), **D** deletes (and still asks first), **R** renames, **O** opens the folder, and so on. A choice that flips between two, such as **Pin to top** and **Unpin**, keeps one letter for both. The letters work in the list beside a conversation and in the menu bar's **Contacts** and **Actions** menus too.

## Command palette

Press **⌘K** on Mac or **Ctrl+K** on Windows and Linux in the contact list or a conversation window, or the keys you gave it under [Settings > Shortcuts](settings.md#app). Type a contact's name, project, words from a conversation, file name, menu action or Settings page. The best matches appear under **Contacts**, **Conversations**, **Files**, **Actions** and **Settings**. Use **↑**, **↓** and **Enter** to choose, or **Esc** to close it.

With nothing typed, the palette lists contacts with the most recently active first, then the window's available menu actions. Typing also searches your conversations, with up to eight matching ones: their first messages, contacts, projects and branches at once, and from two characters on what was said in them too. A past conversation opens in message history; **Continue** there resumes it. Archived contacts' conversations can appear in these results even though their contacts are left out of the contact shortcuts.

**Words, not exact phrases.** A search matches when every word you typed is there, in any order and letter case: `stripe idempotency` finds a conversation that mentions both, together or apart. Put words in quotes to find them as written, side by side: `"stripe idempotency"`. Message history and the search box over the contact list search the same way.

**The words you'd use.** Commands are found by other words for them too: `manager`, `oversee` or `PM` finds a project's **Manager** settings, `agent` or `reviewer` finds **Invite** and **Roles & teams**, `import`, `history` or `claude code` finds message history, `terminal` or `shell` finds the terminal, `diff` finds **View changes**, `activities` finds the slash commands under **Commands**, `new conversation` or `clear` finds **Start over** and `PR` finds **Create PR**.

**Settings pages.** Every page of Settings is listed by name once you type: the app's pages, such as **Roles & teams** or **Shortcuts**, and each project's, such as `shop › Manager`. In a conversation window, only that conversation's project is listed. **Enter** opens Settings on that page.

**Conversation actions.** A conversation window lists everything its menus do. The contact list also offers what the buttons over the selected contact's conversation do: **Invite**, **Open the terminal**, **View changes** and **Create PR** (or **View PR**). Picking one opens that conversation and does it there. A [project manager's](project-managers.md) conversation offers only **Invite**: it has no terminal, changes or pull request.

**Nothing found?** The palette offers **Search all message history for "…"**, which opens every contact's message history searching for what you typed.

In a conversation window, typing also searches the files of the contact's folder that Git doesn't ignore, with up to eight matching files. A file is found by its name and by its folders, so `palette test` finds `test/palette.test.js`. **Enter** opens it in a tab beside the conversation, as clicking it in **All files** does. The contact list has no folder, so it lists no files.

## Organizing contacts

**Groups.** Sort your contacts into groups, such as "Work" and "Side projects":

- **Contacts > Create a group...** makes one.
- Right-click a contact and choose **Move to group**, or pick the group in **Edit contact...**.
- Right-click a group to rename or delete it. Deleting a group keeps its contacts.

**Group, filter and sort.** The **...** button next to the search box lays the list out another way:

- **Group by** lists your contacts under their **Project**, which is how the list starts out, or under your **Groups**, their **Status** or their **Service**. Grouped by project, point at a project and click the **+** at the end of its line for another contact on it, and the contacts on no project are under [This computer](#this-computer), after the projects. By status, the contacts that are working come after the ones waiting for you.
- **Filter by project** shows the contacts of one project only. A line above the list says which one; click **Show all** there to see everyone again.
- **Sort by** orders the contacts in each section by **Date added**, **Name**, **Status** or **Last active**.
- **New group...** makes a group, and puts the list back on your groups so you see it.

**Waiting for you** is always on top, however the list is grouped: every contact that needs you to approve something, a favorite too. Its rows say which project each one works on, where the list has more than one. Once you answer, the contact goes back to its project or group. Favorites come next, then pinned projects (see **Pinning** below), and offline and archived contacts stay at the bottom. Your choices are kept when you quit. A project is the repository a contact's worktree is a copy of, or else the folder it works in.

**Folding a section.** Click a section's line to fold its contacts away, and click it again to bring them back. A section stays as you leave it until you open it again: while its contacts work, finish and get replies, as new ones join it, in the list beside every conversation, and after a restart. Fold it in one list and every list folds it. **Archived** starts folded until you open it. From the keyboard, Tab to a section's line and press **Enter** or **Space**, or **Left** to fold it and **Right** to open it. A screen reader hears whether it is open.

**Right-click a project** in a list grouped by project for what can be done with all of it:

- **New contact in this project** is what the **+** next to its name does.
- **New contact from an issue or pull request...** opens the same dialog in its GitHub field: type a number or paste a link.
- **Project settings...** opens the project's [Settings](settings.md#overview): its scripts, variables, branches, instructions and files to copy.
- **Project instructions...** opens them at its [Instructions](settings.md#instructions): what every new conversation on it is told, and what the **Create PR** button and review comments add.
- **Add a manager...**, on a git repository, adds its [manager](project-managers.md): a contact on your choice of service that oversees the project's conversations you put under it. A small dialog asks for its service, model and a first link to learn from, then opens its conversation. Once the project has one, **Manager settings...** opens its page in Settings and **Turn off manager** turns it off instead, and **Add another manager...** adds one more, by a name of its own. With several at work, **Managers...** opens their page. **Contacts > Add a manager...** opens the same dialog for any of your repositories, also one no contact works in yet, picked with **Another repository...**, and the palette finds it as "manager".
- **Pin project** lists it before the other projects. See **Pinning** below.
- **Hide project** leaves its contacts out of the list. They keep working, and still tell you when they are done. **Hidden projects** in the list's **...** menu brings one back.
- **Archive contacts** puts away every contact listed under the project, after asking: see **Archiving a contact** below. One that is working is stopped. Its favorites, and the ones waiting for you, are listed elsewhere and stay.
- **Delete contacts...** deletes the contacts listed under the project, after asking, and keeps what the project is set up with in Settings, and its favorites and archived contacts. Untick the ones you want to keep. Tick **Also remove their worktrees** to take those along: a worktree with uncommitted changes is kept, and you are told which.
- **Remove project...** deletes every contact that works on it, after asking, and forgets what the project was set up with in Settings. The project's folder is not touched. Untick the contacts you want to keep: the project then stays, with them and its settings, and only the ones still ticked are deleted. Tick **Also remove their worktrees** to take those along: a worktree with uncommitted changes is kept, and you are told which.
- **A project with nobody on it** stays in the list once its last contact is deleted, one at a time or with **Delete contacts...**, as `shop (0)`, also after a restart. Its **+** and **New contact in this project** start a contact in its folder. Its menu has **Project settings...**, **Project instructions...**, **Add a manager...** on a git repository, **Pin project**, **Hide project** and **Remove project...**, which asks, then takes it off the list and forgets what it was set up with in Settings. Its folder is not touched. It is not listed while you search, or while the list shows one project only.
- Both lists group the contacts by how their pull requests stand, with the tag their rows have: **Merged**, **Closed**, **Open** (drafts too) and **No pull request**, the safest to delete first. A group's own box ticks or unticks all of it, and shows a dash while only some of it is ticked. Everyone starts ticked. Contacts that all fall in one group are listed without a heading.

**Add a project.** **...** > **Add project**, also in the **Contacts** menu, has three ways to a project for a new contact:

- **Open project...** picks a folder that is on your computer.
- **Open GitHub project...** clones a repository. Type its address or `owner/name`, or pick one of your own: your repositories on GitHub are listed, the one pushed to last on top, and the search box narrows them down by name and description. It is cloned into a folder of its own in **Location**.
- **Quick start...** starts a new project: a folder named after it, with a git repository and a first commit. Leave **Create a private GitHub repository** ticked to get one on GitHub too, as the project's `origin`.

Each ends in **Add a Contact** with the folder filled in, so you pick the service and press Enter. The next project is offered the folder the last one went in.

Your repositories are listed, and a new one is made, with the [GitHub CLI](https://cli.github.com): install `gh` and connect it once (see **Connecting to GitHub** below). Without it you can still clone by address, and start a project without a repository on GitHub. Listing only reads. Nothing is made on GitHub unless the box is ticked, and a project that could not be made there leaves no folder behind.

**Favorites.** Right-click a contact and choose **Add to favorites**. Your favorites are listed in a **Favorites** section at the top of the list.

- A favorite keeps its group. **Remove from favorites** puts it back there.
- A favorite whose folder is gone is listed under **Offline**, like any other contact.

**Pinning.** A pin keeps something where you look first, without moving it anywhere else:

- **A contact.** Right-click it and choose **Pin to top**. It stays in its project or group, first in it after the project's [manager](project-managers.md), with a pin before its name. Several pinned in one section keep the order the list is sorted by. **Unpin** puts it back in its place. A pinned favorite is first among the favorites, and pinned and favorite are kept apart: one says nothing about the other.
- **A project.** Grouped by project, right-click the project and choose **Pin project**. It is listed before the other projects, with a pin before its name, under **Waiting for you** and the favorites. Pinned projects are by name among themselves. **Unpin project** puts it back.
- The list beside a conversation has the same pins, and the same right-click choices: see [Your contacts beside the conversation](conversations.md#your-contacts-beside-the-conversation). The pins are kept when you quit.
- A [message](conversations.md) can be pinned too, and a window kept on top of others with the pin by its buttons.

**Conversations a contact started.** A Claude contact can [start another conversation](started-conversations.md) for a side task. It is listed right under the one that started it, joined to it by a line, and that one shows how many are under it.

**A manager's team.** While a project's [manager](project-managers.md) is on, every conversation under it in its section is listed under it the same way, whoever started them, in the section's order. The **+** at the end of its row adds a contact under it. To move a conversation to another manager, drag its row onto that manager's row, or use **Assign to manager...** in its right-click menu. To move many at once, use **Assign conversations...** in the manager's right-click menu. Drag it onto its project's line, or pick **No manager**, to take it out from under any. **Add a Contact** asks which manager a new contact on the project goes **Under**: the one whose **+** opened it, or the one whose [scope](project-managers.md#several-managers) takes its branch or ticket, or else **No manager**. Every git repository has Under, also one with no manager yet: **Add a manager...** at its end adds one, and the new contact goes under it. Its count says how many are under it, and folds them away. One that the manager or a worker started says "started by" whom, such as _started by shop manager_, when it has nothing else to say, and its card says it too. A chat tab is listed a level further in, right under the conversation it was opened from, and goes with it: it isn't dragged or assigned on its own. Turned off, the manager has only the conversations it started under it, as any contact. A [project manager](project-managers.md#project-manager) at work leads the section above its managers, which are set in a level under it with their conversations under them: its count folds them all away, and each manager folds its own.

**Chat tabs.** The chats opened with the **+** over a conversation, in [tabs of the same window](conversations.md#chat-tabs), are listed under the first of them the same way, or a level further in when that one is itself under another. They are not counted with the conversations it started. A tab shares its conversation's folder, branch and pull request, so its row leaves the pull request's tags and line counts to that one's row, and says what the tab is doing instead. A tab listed away from its conversation, such as in another section, has them as any row.

**Archiving a contact.** Done with a project for now? Right-click its contact and choose **Archive contact**. The contact is put away, not deleted:

- It stops. If it is working or waiting for you, you are asked first. Its open conversation stays in the same window, ready to read or restore, and other conversations keep going.
- It moves to the **Archived** section at the bottom of the list. That section stays folded until you click it.
- Its message history, its folder and its worktree are kept.
- It leaves the conversations it was a guest in. Its own guests stay invited.
- While it is archived, you can't message or invite it, and it is left out of the menu-bar menu and its counts.

Double-click an archived contact to read its conversation in a conversation window, with **Restore** over it: see [an archived contact's conversation](conversations.md#an-archived-contacts-conversation). Its right-click menu has **Restore contact**, **View message history**, **Open folder** and **Delete contact**.

**Restore contact** brings it back as it was, with its group, its model and its mode. Its conversation picks up where it left off. It is not invited back into the conversations it left.

**Search in all conversations.** The search box at the top of the list filters your contacts by name and folder. From two characters on, it also looks through every contact's conversations: the current one and the past ones. A conversation matches when it has every word you typed, in any order and letter case; put words in quotes to find them side by side.

- The contacts whose conversations contain your text are listed under **Conversations**, each with a line from its newest match and the text marked.
- Point at one to see how many of its conversations contain the text.
- Double-click one, or press **Enter** on it, to open its message history with the search already filled in.
- Archived contacts are searched too.
- **Contacts > View all message history...** lists every contact's conversations in one window, newest first, with its own search: see [Message history](conversations.md#every-contacts-message-history).

**What Add a Contact asks.** Only what a new contact can't do without: its service, its nickname and where it works, which all start out filled in. **Works on** is a drop-down: [This computer](#this-computer), with no project, then the projects your contacts work on, each with the folder it is in, then **Another folder...** for any other. It has its service's display picture: **Edit contact...** picks another. In a git repository it can also start from a GitHub issue or PR, **Under** picks the [manager](project-managers.md) that oversees it, or adds one, and **Team** brings agents along when you have teams. The rest starts out chosen for it and is folded under **More options**, with a line that says what it is, such as _New branch from origin/main · Default model · Asks first_: its group, its branch and where that starts, its model and effort level, and when it asks before acting. **Model** names the choice behind **Default** where the service can say, such as _Default (Opus 5.5)_; Claude uses the account and folder's settings. **Effort** lists the levels its model takes, such as Low, Medium and High, with **Default** first: that leaves it to the model, and names the level it comes to where the service says, such as _Default (Medium)_. Each Codex model has levels of its own, so the list follows the model: one that doesn't take the level you picked goes back to **Default**, and a service whose models take none has no **Effort**. A level you picked is in the line too, such as _GPT-6.1-Sol · High effort · Asks first_, and the effort badge under its conversation changes it later. A mode that asks nothing says so above the buttons, folded or not. When you had conversations with Claude Code in the folder you pick, the line under it says how many, and that they are under **History** and in a Claude contact's message history. **Add**, or Enter, adds it.

**A worktree for every contact.** A contact added in a git repository always gets its own [worktree](https://git-scm.com/docs/git-worktree) of it, on a new branch. The folder you picked is never the one its agent changes, and two contacts never change each other's files:

- **Contacts > Add a contact...**, the **+** next to the search box and **⌘N** in the contact list ask where it works. It is already the project of the contact you added last, with that contact's service, group, model, effort level and mode, unless Settings > [New contacts](settings.md#agents) picks a model, level or mode for that service, so pressing Enter adds another contact there; **Works on** picks another project. After a contact on This computer, it starts out there too, and with nobody added yet it starts there. With the list showing one project only, it is that project's last contact. The branch field, under **More options**, can be left empty, so pressing Enter is enough: the branch then starts out named after the project and a number, such as `shop-2`, and is renamed after the first thing you ask the contact to do: "Fix the login redirect" makes it `fix-the-login-redirect`. The nickname made up from the branch follows it: **Claude (shop-2)** is **Claude (fix-the-login-redirect)** from then on. A nickname you typed yourself, or one that came from an issue, is kept. The worktree's folder stays where it is, and a branch you named yourself, switched away from or already pushed keeps its name, and the contact its nickname. Type a name in the field for one of your own. The branch starts from the remote's main line, fetched while you fill in the dialog, or from where the folder is. A project can name another branch to start from in its [Settings](settings.md#worktrees). Making the worktree takes a few seconds in a big project: the dialog says what it is doing. **Cancel** meanwhile calls it off: the worktree and the branch made for it are removed, and no contact is added. A pull request's own branch is kept.
- **A team to start with.** **Team** in the dialog picks agents that join the new contact's conversation with it, such as a reviewer that looks over every change. It starts out as the team of the contact the dialog starts from. **Edit teams...** beside it opens [Settings](settings.md#agents) at **Roles & teams**. With no team yet, **More options** has **Set up a team...** instead. See [Roles and teams](group-conversations.md#roles-and-teams).
- **Tools > Branch prefix...** puts something of yours in front of every branch the app names, such as `safa/feature`: the branch is then `safa/feature/shop-2`, and `safa/feature/fix-the-login-redirect` once it is named after the work. A name you type yourself is taken as it is. Names the app makes hold plain letters, numbers and dashes only: `Mağaza Önü` is written `magaza-onu`.
- **Another contact on the same project.** Point at the project in the list and click the **+** at the end of its line, or right-click one of its contacts and choose **New contact in this project...**. The dialog opens with the same service, group, model and mode, so there is no folder to browse for.
- **A contact like the ones in a section.** When the list is grouped by groups, status or service, every section but **Waiting for you**, **Offline** and **Archived** has a **+** at the end of its line too. The dialog starts out like the contact added last in that section, on its project, and **Works on** still picks another project. A group's **+** puts the new contact in that group. An empty group's **+** starts like the contact you added last.
- A folder that is not a git repository, or has no commit yet, has nothing to make a worktree of. The contact works in the folder itself, and a contact added from it shares the folder.
- A contact added to your list from a conversation's **Invite** dialog is there to join that conversation, so it gets no worktree: it works in its host's folder. See [Group conversations](group-conversations.md).

Worktrees go in `~/.buddylist/worktrees/<project>/<branch>`, whichever service the contact uses. The ones made while the app was called Agent Messenger stay in `~/.agent-messenger/worktrees/`, since an agent finds its session by its folder, and work as before. Files git doesn't track, such as `node_modules` and `.env`, are not copied into a worktree unless the project says so: its [Settings](settings.md#projects) can name files to copy, and a setup script to run in each new worktree.

**A worktree's Claude Code settings come from the main checkout.** A worktree's branch can be anyone's, a pull request from a fork too, and Claude Code runs here without asking whether to trust a folder. So a Claude contact in a worktree reads the project's settings from the same folder in the main checkout: `.claude/settings.json` with its hooks and allow rules, `.claude/settings.local.json`, `.mcp.json`, and the commands, agents, skills and output styles in `.claude`. What the branch has in them never runs. A change you make to them on a branch holds once it is in the main checkout. **Always allow** in a worktree is kept in the main checkout's `.claude/settings.local.json`, so every contact on the project has it. A contact working in the main checkout itself, or in a folder outside a repository, reads them where it works, as before. The conversation is still kept by the worktree's folder, so it is picked up as before.

**Start from a GitHub issue or pull request.** A contact added in a git repository can start from one. Both ways of adding it show a **GitHub issue or PR** field. Click it for the project's open pull requests and issues, yours first, and type words from a title to narrow them down; words that match none of them are searched for on GitHub. Or type a number, such as `123` or `#123`, or paste a link. The app looks it up with the [GitHub CLI](https://cli.github.com) in the project's folder and fills in the rest:

- An issue names the contact after its title, and the branch after its number and title, such as `123-fix-login-redirect`. You can still change both.
- A pull request names the contact after its title too. Its worktree checks out the pull request's own branch instead of a new one, so what the contact pushes goes to the pull request. That works for a pull request from a fork as well. A branch that is already checked out in another folder is refused, and you are told where. Hooks, allow rules and MCP servers the pull request adds to the project's Claude Code settings don't run: a Claude contact reads them from the main checkout (see above).
- A pull request's worktree is not set up by itself. The project's [setup script](settings.md#scripts) would run the pull request's code on your computer: installing runs a package's own scripts. Its conversation says the script waits, and **Run setup** in the **Setup** tab runs it once you have looked the changes over.

The title, the text and the link wait in the new conversation's message box as a draft. Nothing is sent: add what you want done and press Enter. The draft is still there after you close the window or restart the app. It goes away with your first message, or when you start a new conversation.

A closed or merged issue or pull request works too, and the dialog says that it is. The link has to be for the project's own repository. Looking it up only reads from GitHub. It needs `gh` installed and connected.

Deleting a contact never touches the folder it was added from. Its worktree stays too, unless you tick **Also remove its worktree** in the question it asks. **Tools > Remove worktrees with contacts** makes that box start ticked. The branch and its commits stay, unless **Delete the branch with its worktree** is on in [Settings](settings.md#every-project); uncommitted changes go with the worktree, and you are told how many first. A project's cleanup script runs in the worktree before it goes. A worktree another contact works in is not offered. The contact leaves your list at once and its worktree is removed right after, which takes a few seconds in a big project; if it can't be removed, it stays where it is and the list tells you. Guests in the contact's conversation work in its worktree too, and are stopped before it goes.

**Models.** The **Model** list in **Add a Contact** and **Edit contact...** starts with a few models for the service, and **Default**, which leaves the choice to the service's own settings:

- Type in the list to find any model the service has, or to use one by its exact name.
- **Add models...** at the bottom opens the service's own list. Tick the models you want to choose from; the list keeps them for every contact of that service.

Claude, Codex and OpenCode are asked for their lists as you open the dialog, so new models show up by themselves. No message is sent for that. OpenCode lists its models as `provider/model`, for each provider you set up in it, and its own free ones. Gemini and Hermes can't be asked this way: Gemini offers its usual models, and a Hermes model is typed as `provider:model`. A service with no models to list says why in **Add models...**: say, that its program isn't installed, and what to do about it.

**Contact card.** Rest the mouse on a contact for half a second to see where its project stands:

- the git branch, or the short commit if no branch is checked out
- the branch's pull request, whether it has a merge conflict and how its checks stand, as a link such as "Pull request #12 · merge conflict, 2 checks failing": move the mouse onto the card and click it to open the pull request on GitHub
- how many files have uncommitted changes. The conversation's [Changes tab](conversations.md#changes) lists them, with what the branch committed
- what its conversation cost today, guests included
- when it was last active

A line the app can't fill in is left out. A folder that isn't a git repository shows no branch or changes, and Codex and Gemini contacts show no cost of their own. The pull request is the one for the branch checked out in the contact's folder, found with the [GitHub CLI](https://cli.github.com); it arrives a moment after the card. A folder left on no branch, as an agent leaves it with `git checkout origin/main` once its pull request is merged, keeps the pull request it had, and the card and the tags say how that one stands now.

**Pull request tags.** A contact whose branch has a pull request wears coloured tags at the end of its row, so you can see how every pull request stands without pointing at each contact:

| Tag                 | Meaning                                                                        |
| ------------------- | ------------------------------------------------------------------------------ |
| **Merged**          | Merged. Purple.                                                                |
| **Conflict**        | Can't be merged until its conflicts with the base branch are resolved. Orange. |
| **2 failing**       | That many checks failed, even if others still run. Red.                        |
| **Running**         | Checks are still running, and none has failed. Yellow.                         |
| **Passed**          | Every check passed. Green.                                                     |
| **Closed**          | Closed without being merged. Grey.                                             |
| **Open**, **Draft** | Nothing more to say yet: no checks, and no conflict.                           |

- A pull request with a conflict wears its checks' tag too, such as **Conflict** and **2 failing**.
- The tags count each check once, as its latest run left it, as the **Checks** tab does. A run that a newer one took the place of isn't counted, and neither is a cancelled check: it isn't failing.
- A row with tags shows only the contact's name and its tags, whether it is working, waiting for you or idle. Its buddy still shows its status, and what it is doing is in its conversation window and the menu-bar menu.
- The tags end where the other rows' text does, and the **+** of a section too. They are never cut short: in a narrow list the name gives way instead.
- Click the tags to open the pull request on GitHub. Point at them for how it stands and its title, such as "Pull request #12 · merge conflict, 2 checks failing" and "Back off when the API says to slow down".
- Two tags act in the contact's conversation instead, opening it if it isn't open. The one for its checks, such as **2 failing**, **Running** or **Passed**, shows them in its **Checks** tab. **Conflict** asks the contact to merge the base branch in and resolve the conflicts, as **Fix conflicts** does there. In the list beside a conversation, another contact's conversation comes up in that window first.
- **Merged** or **Closed** stays with its verified pull request, including after a cleanup checkout and an app restart. Recovery of an already-detached worker requires matching Git and GitHub evidence. A PR made in a different worktree is not attached from a message saying it merged. To go on with the same contact, click **Continue** next to the tag, or right-click it and choose **Start new branch**: its folder moves to a new branch, started from the project's main branch as the remote has it now, and the tags go, since the new branch has no pull request yet. The conversation is kept, and so is the branch it leaves. The new branch gets a name such as `shop-3`, and the next thing you ask the contact to do names it, as with a new contact. A nickname that was made up from the branch follows it both times. A folder with uncommitted changes is left as it is, and so is one whose contact is working or waiting for you: commit or finish first. **Continue** is greyed out meanwhile. Point at it for what it does.
- **Archive**, next to **Continue**, is for a contact you are done with: it does what **Archive contact** in its right-click menu does. See **Archiving a contact** above for what is kept. **Archive contacts once their pull request is merged** in [Settings](settings.md#every-project) does it for you, and **Archive once merged** in the **▼** of a conversation's **View PR** button does it for that one contact.
- **Delete**, after **Archive**, does what **Delete contact** in its right-click menu does: it asks first, and can take the contact's worktree along. Deleting a contact, above, says what goes and what stays.
- In a narrow contact list, **Archive** and **Delete** are a box and a bin. Point at them for what they do.

The menu-bar menu has no tags, so there an idle contact says it in words, what stands out first: "Merge conflict on pull request #12", "2 checks failing on pull request #12", "Checks running on…" or "Checks passed on…". A merged or closed one says so.

When checks start failing, and when they have all passed, you get a toast; click it to open that contact's conversation. Your own status decides about that toast as it does about any other. The app asks `gh` in the background and only reads: every minute while a pull request is still to be merged or a turn has just ended, and every fifteen without one or once it is merged or closed. Coming back to the app asks at once, so a pull request you just merged on GitHub shows as merged. GitHub can take a moment to work out whether a pull request has conflicts, so a new conflict shows on the next look. Without a verified association, missing or signed-out `gh` leaves the row without tags until you connect to GitHub. A saved, verified status stays during temporary GitHub failures once the checkout identity is validated; a different repository, worktree or new branch cannot borrow it.

**Pull requests to review.** Where MSN counted your new e-mail, the line under your picture counts the pull requests waiting for your review: "You have (3) pull requests to review". Click it to open them on GitHub.

The count comes from the [GitHub CLI](https://cli.github.com). The app asks every two minutes and only reads. With nothing to review it says (0). When GitHub can't be reached the line is hidden until it can.

**Connecting to GitHub.** Without `gh`, or when it is signed out, that line says **Connect to GitHub to see your pull requests** instead. Point at it for which of the two it is. Click it for the **Connect to GitHub** dialog, which signs `gh` in without a terminal:

1. The dialog shows a one-time code, such as `1A2B-3C4D`.
2. **Open GitHub** copies the code and opens GitHub's page for it in your browser. Paste the code there and approve.
3. The dialog closes by itself. The line turns into the count, and your contacts get their pull request tags, without waiting for the next look.

It is GitHub's own sign-in for its command-line tool, `gh auth login --web`: the app never sees your password, and `gh` keeps the sign-in, so `gh` in a terminal is signed in by it too. As `gh auth login` offers to in a terminal, git is set up to use the same sign-in for github.com (`gh auth setup-git`), so that cloning and pushing over https work.

**Cancel**, or Esc, calls the sign-in off. A sign-in that did not go through says why, and **Try again** starts over with a new code: a code is good for fifteen minutes. When `gh` is not installed the dialog says so, with a link to where to get it; **Try again** once it is there.

Signing in with `gh auth login` in a terminal works as well: the line notices within two minutes. [The welcome wizard](welcome-wizard.md) has the same sign-in on its GitHub line.

**Notifications.** When a window isn't focused, you get a toast in the corner and a dock bounce. When Claude needs you, it also sends a nudge. It asks once: more requests that come in while the conversation is still waiting for you join the first one quietly. **Always allow** on one of them also accepts the others the same rule covers. Click a toast and the conversation window you were in last shows that conversation, as when you [click a contact beside it](conversations.md#your-contacts-beside-the-conversation). A new window opens only when none is open, and a conversation that has a window of its own comes to the front there.

**Menu bar.** buddylist also sits in the menu bar, so you can check on your agents without finding its windows:

- The number next to the icon is how much is **unread**: replies, requests and errors from a conversation you weren't looking at. Open or click into that conversation and it is read.
- Click the icon to see every contact with its status and what it is doing. Click a contact to open its conversation.
- Hover over the icon for a summary, such as "buddylist: 2 unread, 1 waiting for you".
- **⌃⌥M** (Control+Option+M, or Ctrl+Alt+M on Linux) brings the contact list to the front from any app. On Windows it is **Ctrl+Alt+Shift+M**: there Ctrl+Alt is AltGr on many keyboards, and AltGr+M types a letter. If another app already uses that shortcut, **Open contact list** in the menu still works. [Settings > Shortcuts](settings.md#app) gives it other keys, and Quick send's too.

The dock badge still counts the conversations waiting for you to approve something. On Windows and Linux the icon lives in the system tray, and the unread count is in its tooltip and menu.

## This computer

Not everything is about a project. For a question, some research, a letter or a one-off task, add a contact on **This computer**: it works on no project, and there is no folder to pick.

- **Where it works.** Each gets a new, empty folder of its own, `~/.buddylist/this-computer/chat-1`, then `chat-2` and so on. What its agent writes lands there, nothing of yours is in it, and no other contact works there. **Open in** opens it, and **All files** beside the conversation lists what it made. A folder that went is made again, empty, before its next session.
- **Adding one.** Point at **This computer** in the list and click the **+** at the end of its line, or choose **Contacts > New contact on this computer...**, which the palette (**⌘K**) finds as "chat", "question" or "no folder". In **Add a Contact**, **Works on** says **This computer**, and the line under it says where its folder will be. The welcome wizard has it as **No project, just chat...** on its last page.
- **Its name.** The nickname starts out as **Claude (chat-4)**, after its folder, and follows the first thing you ask it, as a branch does: "Plan a weekend in Porto" makes it **Claude (plan-a-weekend-in-porto)**. A nickname you typed is kept, and so is the folder's name. With **Name a branch after the work** turned off in [Settings > Git](settings.md#every-project), the made-up nickname is kept too.
- **How careful it is.** It starts out asking before it acts, whatever the contact it starts from does, unless that one is on This computer too: its folder is its own, but its agent can reach anything on the computer. **More options** picks another mode, and **Never ask** still says what that means.
- **What it leaves out.** There is no repository, so there is no worktree, branch, GitHub issue or pull request in its dialog, no **Under**, no pull request tags, and no **Create PR**, **Run**, **Changes** or **Checks** in its conversation. **Invite**, the terminal, `@` for files, chat tabs and the conversations it starts are as for any contact; one it starts is on This computer too, in a folder of its own.
- **The section.** **This computer** is listed after the projects, also with nobody on it, as the way to a contact there, and above **Offline**. Its rows say nothing about where they work, except a contact in your home folder itself, which says `~`. Right-click it for **New contact on this computer**, **Instructions...**, which every conversation there is told, **Pin section**, which lists it with the pinned projects, **Hide section**, **Archive contacts** and **Delete contacts...**. It is not listed while you search, or while the list shows one project only.
- **Your home folder.** A contact working in your home folder itself, such as one going on with a conversation you had with Claude Code in a terminal there, is on This computer too. **History** lists those conversations under **This computer**.
- **Deleting one.** Its folder goes with it while there is nothing in it. When its agent made something there, **Delete contact** asks: **Also delete the files it made** starts out unticked, and the files stay where they are unless you tick it. Your home folder is never touched. **Delete contacts...** on the section asks the same for all of them.

## Quick send

**⌃⌥S** (Control+Option+S, or Ctrl+Alt+S on Linux; **Ctrl+Alt+Shift+S** on Windows) opens a floating message box for the conversation you last viewed, including its selected chat tab. That contact is remembered after restarting. The box names everyone in the conversation and shows its folder before you send. **Enter** sends, **Shift+Enter** adds a line, and **Esc**, clicking elsewhere, or pressing the shortcut again dismisses it. Unsent text stays with that contact; a failed send keeps it for retrying. **Open conversation** brings up the full chat. Messages sent here appear in the full conversation too, and a busy agent handles them as it would messages sent there.

If no conversation has been viewed, or the last contact is deleted, archived, or offline, the shortcut opens the contact list. **Quick send to last contact** in the menu-bar icon’s menu also works if another app has taken the shortcut.

## Your status and updates

**Your own status.** Click your name at the top of the contact list to change it. It decides how far the app goes to get your attention:

| Your status                                   | Toast, sound, nudge and dock bounce | Dock badge and menu-bar count | Catch-up when you're back |
| --------------------------------------------- | ----------------------------------- | ----------------------------- | ------------------------- |
| **Online**                                    | yes                                 | yes                           | –                         |
| **Away**, **Be Right Back**, **Out To Lunch** | yes                                 | yes                           | yes                       |
| **Busy**, **On The Phone**                    | no                                  | yes                           | yes                       |
| **Appear Offline**                            | no                                  | no                            | yes                       |

- **Catch-up.** When you go back to **Online**, every contact still waiting for you to approve something tells you again, with its toast and nudge. A conversation you are already looking at is skipped, and nothing else is repeated.
- **The counts.** The dock badge and the number in the menu bar are hidden together. What you missed is still counted, and the menu-bar icon's menu and hover text still say it.
- **Your contacts never know.** They aren't told your status, and nothing is accepted or declined for you. A contact that needs you keeps waiting, as it always does.

**Auto-away.** After five minutes without touching your computer, **Online** turns into **Away**. When you are back it turns into **Online** again, and you get the catch-up. A status you picked yourself is never changed. It is on by default: **Tools > Show me as Away when I'm inactive** in the contact list turns it off. The browser preview doesn't have it.

**Quitting.** Quitting ends every conversation. While a contact is working or waiting for you, buddylist asks first, as MSN did when you signed out: "Signing out will end 3 conversations.", naming the contacts, with **Quit** and **Cancel**. **Cancel** leaves every conversation, command and terminal running. With everyone idle it quits at once. ⌘Q and **Quit** in the app menu, **Quit** in the menu-bar icon's menu and **File > Exit** all ask. When macOS shuts down, restarts or logs you out, buddylist quits without asking, as the computer is waiting for it.

**Updates.** When a new version is out, buddylist downloads it in the background without a word. Once it is ready, a card at the bottom of the contact list says **New update available**: **See changes** opens what is new in it on [the changelog](https://buddylist.dev/changelog), **Restart** installs it and opens buddylist again, and **×** hides the card. While a contact is working or waiting for you, the card says who, such as "Claude is working.", and offers **When idle** first: it does that by itself once no contact is working or waiting for you and you have been away from the computer for five minutes. With nothing running there is only Restart, as it would interrupt nothing. Restart asks first while contacts are busy, as quitting does. A copy that can't update itself, such as a Debian installation or one opened from a Mac disk image, shows **Version x.y.z is available** with **What's new** and **Update...** instead: Update... says how to get a copy that can, and links to the download page. **Help > What's new** opens the changelog too.

## Music in your personal message

On Mac, click your name at the top of the contact list and turn on **Show what I'm listening to**. While Spotify or Apple Music plays, its song title and artist appear in place of your personal message. Pausing or stopping the music, or turning the option off, brings your saved message back. Clicking that line still edits your saved message, not the song.

macOS may ask to let buddylist control the player when it reads the song already playing. If you decline, later track changes can still appear. This option is off until you enable it and is available only on Mac.

## Spending

**Contacts > View spending...** opens one window with the reported cost across all contacts for **Today**, **This week** and **This month**, in US dollars. The week starts on Monday and the month on the 1st, in your computer’s time zone. Each total says when its period began.

Below the totals, each contact has a week and month amount, with the largest month total first. Archived contacts are included. Guest agents count under the conversation they took part in; copied results in a fork count once. The window refreshes as contacts finish working, when history changes, when you return to it, and at midnight. **File > Refresh** or **⌘R** (**Ctrl+R** elsewhere) asks again.

These are estimates from the costs agents report in the message history. Agents such as Codex do not report dollar costs; the status bar notes when contacts have replies without a reported cost. This is not a bill or a subscription balance. Deleted history and deleted contacts no longer count, and history retention (the newest 600 entries per conversation and 50 past conversations per contact) can limit the totals. The browser demo does not offer this window.
