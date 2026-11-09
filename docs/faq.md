# Questions and answers

What people ask about buddylist, by topic. The [landing page](https://buddylist.dev/#faq) answers the first questions: what buddylist is, whether it is free, which agents you install yourself, which systems it runs on, and what it sends about you.

## Getting started

### Is this just a chat window with a retro theme?

No. Each conversation runs a real Claude Code, Codex, Gemini, OpenCode or Hermes session, with the same agent loop, tools and settings as `claude`, `codex`, `gemini`, `opencode` or `hermes` in your terminal. It can read your project, run commands and edit files.

### How do I chat with Codex?

Choose **Codex** as the **Service** in **Add a Contact**. Codex is not bundled, so install the Codex CLI first with `npm install -g @openai/codex` and run `codex login`. It uses the same login, `config.toml`, `AGENTS.md` and MCP servers as `codex` in your terminal. Codex contacts have their own permission modes, and **Conversation > Commands** has `/compact`, `/review` and your Codex skills. They have no plan approval. More in the [Codex guide](codex.md).

### How do I chat with Gemini, OpenCode or Hermes?

Choose **Gemini**, **OpenCode** or **Hermes** as the **Service** in **Add a Contact**. None is bundled. For Gemini, install Gemini CLI 0.33 or newer with `npm install -g @google/gemini-cli` and run `gemini` once to sign in. For OpenCode, run `npm install -g opencode-ai` and `opencode auth login`. For Hermes, install [Hermes Agent](https://hermes-agent.nousresearch.com) and choose a provider with `hermes model`. Each uses the same settings, commands and MCP servers as in your terminal, and has its own permission modes. More in the guides to [Gemini](gemini.md), [OpenCode](opencode.md) and [Hermes](hermes.md).

## Code and GitHub

### Is there a terminal in the app?

Yes. **View > Terminal** in a conversation, or ⌘J, opens your own shell in that contact's folder, beside the conversation. It is a real terminal, so `vim`, `htop`, colours and Ctrl+C work as they do in Terminal. The **+** after the tabs opens another one, each in a tab you can rename and drag into another order. Putting the terminal away keeps its shells running, and closing the window closes nothing: a terminal belongs to its contact. ⌘F, or Ctrl+Shift+F on Windows and Linux, finds text in its scrollback. The agent doesn't see what you type or what is printed. More in the [terminal guide](terminal.md).

### Can an agent open terminals for me?

A Claude contact can. Say "open three terminals", or "a terminal for the dev server and one for the tests", and each gets a tab beside the conversation, with the name you gave it. Ask for "two terminals running claude" and the command is typed into each one once its shell is up. You are asked first when a command is to run, and shown the command. It is typed once: the agent can't type into a terminal afterwards, and isn't told what the command prints. Codex, Gemini, OpenCode and Hermes can't do this yet.

### Can I see what an agent changed?

Yes. Every edit in the conversation has a **Show changes** link. For everything at once, open the **Changes** tab beside the conversation with **View > Changes** or ⇧⌘G. It lists the commits the branch made and every file that differs from the project's main line, committed or not, with the lines it gained and lost, as a list and as a tree. Click a commit for only its files, or **Uncommitted changes** for what changed since the last commit. Click a file for its diff, with numbered lines and the changed words marked, click a line, or drag over several, to comment on them, and mark a file as **Viewed**. In a wide pane the files stand beside the diffs, and their edge drags them wider or narrower. The **⋯** at the top shows the diffs side by side, wraps long lines or lets them scroll, lists the tests and generated files after the rest, and opens or closes every diff at once. While the branch has a pull request, your reviewers' threads stand under their lines, to send to the agent, answer or resolve. The tab never stages, commits or undoes anything. To read any file, not only a changed one, the **All files** tab next to it shows the folder as a tree, and opens a file in a tab of its own, with numbered lines in its language's colours.

### Can an agent open a pull request for me?

Yes. **Create PR** in the conversation's toolbar asks the contact to commit what is left, push the branch and open the pull request with the GitHub CLI, and it asks before it runs anything, as its mode says. The button then turns into **View PR**, with a mark that is red while a check fails, amber while they run and green once they have all passed. Its **▾** shows the checks beside the conversation, failing ones first, and turns **Auto-merge** on or off: GitHub then merges the pull request by itself once what it requires has passed. Where the repository requires nothing, buddylist merges it itself once its checks pass, while the app is open. Once it is merged or closed, **Continue** moves the same contact to a fresh branch from the project's main line, **Archive** puts it away and **Delete** removes it, after asking. **Create PR manually** opens GitHub's own page for it instead.

### How does it know about my pull requests?

It asks the GitHub CLI. Install `gh` and click **Connect to GitHub** under your name once. A contact whose branch has a pull request then wears tags at the end of its row that say how it stands: **Merged**, **Conflict**, a count such as **2 failing**, **Running**, **Passed** or **Closed**. Click the tags to open the pull request on GitHub. The one for its checks shows them beside the conversation instead, and **Conflict** asks the agent to resolve the conflicts. A toast tells you when checks start failing or have all passed, and the line under your picture counts the pull requests waiting for your review. The **Checks** tab beside a conversation lists its pull request's checks under **Failed**, **Running**, **Passed** and **Skipped**, with a bar that sums them up, and the step that failed with its errors. **Send to chat** hands a failed one to the agent to fix; with several failures, **Send all to chat** sends them together in one message. **Re-run failed** starts them over once their workflow has finished: while it is still running, the button waits and says so. A merge on GitHub shows within a minute. Apart from Auto-merge and Re-run failed, the app only reads, and without `gh` all of it is left out.

### Can I see which pull requests depend on mine?

Yes. Choose **View PR stack...** from the PR button’s menu or **Code**, or **PR stack** from **View** or the side pane’s **+**. A PR in a GitHub stack shows every PR in that stack bottom to top, with its position, even after the lower ones merge; otherwise it shows confirmed parents and dependents by branch. The current PR is highlighted and each one links to GitHub. Uncertain or incomplete relationships say so, and a PR GitHub moved to another base is not called standalone. It only reads; opening it does not rebase, push or merge anything. More in the [PR stacks guide](pull-request-stacks.md).

### Can I keep a side-pane tab when I return to a conversation?

Click its pin, or choose **Pin tab** in its right-click menu. Pinned tabs move to the front of their row, in the order you pinned them, and belong to that conversation across window reopening and app restarts. **Unpin tab** returns the tab to its usual behavior; **Close** removes its pin too. Content that is no longer available says why. More in the [side-pane guide](conversations.md#the-side-pane-files-changes-and-checks-above-what-runs-below).

### Can I look at my app without leaving the conversation?

Yes. **View > Browser**, or ⇧⌘B, opens a web page in a tab beside the conversation: type `localhost:3000` or just `3000`, or right-click a link in the conversation and choose **Open beside the conversation**. A dev server that reloads on a change reloads there too. The **⋯** at the end of the page's bar shows it at a phone's or tablet's size, opens an HTML file from your computer, and can make a click on a link in a reply open it there. The camera on the bar takes a screenshot of the page to draw on, with a pen, boxes, arrows and text, and puts it in the message box. Otherwise the page can't reach the app, your files or the agent, and the agent doesn't see it. More in the [browser tab guide](browser-tab.md).

### Can I run my dev server from a conversation?

Yes. **Run** in a conversation's toolbar starts your project's own command in that contact's folder. The first time it asks for the command and suggests one, such as the `dev` script of your `package.json`. It can be a few lines, run one after the other until one fails, or a script file of the project that **Choose file...** in the same dialog picks. Each contact gets a port of its own in `PORT`, so several contacts on one project can each run a dev server at once. The conversation shows what was started, a link to `localhost` and the output. The agent is not told, and **Stop Run** stops everything the command started. More in the [Run button guide](run-button.md).

### How do I add a project that is on GitHub?

Choose **Add project** in the contact list's **...** menu. **Open GitHub project...** clones a repository: type its address or `owner/name`, or pick one of your own from a list. **Open project...** picks a folder that is already on your computer, and **Quick start...** starts a new project with a git repository and a first commit, and a private repository on GitHub if you leave that box ticked. Each ends in **Add a Contact** with the folder filled in. Listing and making repositories needs the GitHub CLI; cloning by address works without it.

### Can I start an agent on a GitHub issue or pull request?

Yes. **Add a Contact** has a **GitHub issue or PR** field: pick one of the project's open ones from its list, or type a number or paste a link. An issue names the contact after its title, and the branch after its number and title. A pull request checks out its own branch, also from a fork, so what the contact pushes goes to the pull request. The title, text and link wait in the message box as a draft, and nothing is sent until you press Enter. It needs the GitHub CLI, and the app only reads from GitHub.

### What runs when I start an agent on someone else's pull request?

Nothing the pull request brings, until you say so. Its contact works in a worktree of its own, and the project's setup script waits there, since installing runs a package's own scripts: **Run setup** in the **Setup** tab starts it once you have looked the changes over. In that worktree Claude Code takes the project's settings from your main checkout, so hooks, allow rules and MCP servers the pull request adds don't run. Codex, OpenCode and Hermes don't start what the branch sets up either, and Gemini trusts none of the worktrees unless you tell it to. The agent can still run the branch's code, such as its tests, as on any branch.

## Working with agents

### Can two agents work on one repository without undoing each other's work?

Yes. Every contact you add in a git repository works in its own git worktree in `~/.buddylist/worktrees/`, on a new branch, so the folder you picked is never touched. For another agent on the same project, point at the project in the list and click the **+** at the end of its line, or right-click one of its contacts and choose **New contact in this project**. Press Enter and the branch is named after the first thing you ask for, in a few words from Claude, or type a name of your own. The new contact keeps the service, model and mode of the first. Files git doesn't track, such as `node_modules` and `.env`, are not copied. Deleting the contact can remove its worktree too, and the branch and its commits always stay. In a folder that is not a git repository, contacts work in the folder itself. To ask another agent about the very same folder instead, open a chat tab: ⇧⌘A, or the **+** over the To: line, starts a chat there with any agent, as a tab over the conversation.

### Can I choose which model an agent uses?

Yes. Pick a model under **More options** in **Add a Contact**, set the one each service starts with in **Settings > New contacts**, or click the model badge under a conversation to switch later. The list is searchable and takes any model by its exact name, and **Add models...** chooses which ones it offers. Claude Code and Codex are asked for their own lists, so new models show up by themselves. The same badge sets how hard the model thinks, for the models that take a level. Both are remembered for the contact, and nothing is written to your Claude Code or Codex settings. **Default** leaves the model to your own settings for that service. On a model that has fast mode, Opus today, it turns that on too, with a ⚡ on the badge: faster answers from the same model, at a higher price.

### Can the agents decide how hard to think?

Yes. Tick **Let Claude decide** at the bottom of a contact's effort menu and it picks its own level for every message you send. First it replies with a level and a few words on why, then it answers on that level. In a group conversation, **Conversation > Effort > Let the agents decide** works the same way: before anyone answers, one agent names a level for everyone about to answer, such as `@Claude(high) @Codex(low)`. A level you choose yourself holds until the agents pick again. Gemini, OpenCode and Hermes have no effort levels.

### What happens when an agent makes a plan?

In plan mode, Claude writes a plan and waits for your answer before it changes anything. The plan opens in a pane beside the conversation, and the window grows to make room for it. Each plan has a tab: approve it, or choose **No, keep planning** and say what should change. The conversation keeps a **View plan** link, and **View > Plans** lists every plan and how you answered it. Codex, Gemini, OpenCode and Hermes have no plans to approve.

### Can I change a message I already sent?

Yes, to a Claude contact. Point at the message for a row under it: **Rewind to this message**, **Edit** and **Copy**. Rewind takes the conversation back to just before it without sending anything, so Claude forgets the message and everything after it, as `/rewind` does in a terminal, and its words go back in the message box. **Edit** does the same once you send the new version, and **Esc** leaves everything as it was. Files Claude changed stay as they are. Messages in a group conversation and slash commands can't be rewound. To try another way without losing this one, **Fork chat from here** under a reply makes a new chat that goes on from there. A message you send while an agent works waits, greyed out, until it is read: **Send now** stops the turn so the agent reads it at once, and **Cancel** takes it back.

### Can another agent finish the work if I reach a limit?

Yes. **Settings > Fallbacks** lets you choose an ordered list of services, the limits or outages that trigger each, and a spending rule for each. A project can use its own list. **Never use paid usage** is the default; current live integrations cannot guarantee no charges, so those entries are skipped. **Ask before possible charges** asks for one turn, and **Allow paid usage** permits charges for that entry. Permission modes stay the same or become stricter. You can also use **Invite another agent** and **Continue with...** on an unfinished checklist to hand over yourself. More in the [accounts guide](accounts.md#continuing-with-another-provider).

### What are subagents?

A Claude contact often hands part of a job to a subagent, an agent of its own that works beside it and comes back with a report. The **Subagents** tab beside the conversation lists them: what each one is doing right now, how long it has been at work and its report once it is back. **Stop** ends one subagent and lets Claude carry on with the rest. The commands and watchers Claude leaves running are not subagents: the **Background** tab lists those. Codex, Gemini, OpenCode and Hermes don't say what their subagents do. More in the [subagents guide](subagents.md).

### Can an agent check back later on its own?

A Claude contact can. Say "keep an eye on CI and tell me when it's green", "look at the deploy again in 10 minutes", or type `/loop`. Claude says how often it will check back, and so does the status bar. When a check-in is due, Claude answers it without you sending anything, and "stop checking" ends them. Check-ins last while buddylist is open, and one that repeats ends by itself after 7 days. Codex, Gemini, OpenCode and Hermes can't do this. More in the [check-ins guide](check-ins.md).

## Day to day

### What happens to the window when I archive a contact?

The conversation stays open for reading, with **Restore** above it. Other chats and their work stay open. Reading tabs can remain, while runnable content is removed and terminals still starting are cancelled. Closing a chat tab still selects the next tab; the window’s Close action still closes the window.

### How are my contacts grouped on the phone?

**Waiting for you** comes first, then **Working**, with each contact’s project shown. The remaining contacts are grouped by project, with managers and their workers together. Fold a project or a manager’s team and the phone remembers it. Archived contacts have their own folded section and open for reading. More in the [phone guide](remote-access.md).

### Why does a usage meter say over limit or Unknown?

**Over limit** means the provider reported more than 100% used; the percentage stays visible while the bar stays inside its track. **Unknown** means there is no usable reading, not zero usage. Readings just below 100% are no longer rounded up to an exhausted allowance. **Account settings** in the usage popover opens the [Accounts page](accounts.md) directly.

### Can I use more than one Claude account?

Yes. **Tools > Settings... > Accounts** adds another Claude login, such as a personal one beside your work one, through Claude's sign-in page in your browser. Personal and team accounts can share an email address; choose the organization during sign-in. **Use** there, or **Switch account...** under the usage meter in a conversation, puts one in use for every Claude contact. When the account in use reaches its session or weekly limit, the conversation asks to switch to the next one and sends your message again from there, with everything said so far. **Always allow** switches without asking from then on. Every account shares your Claude Code settings, `CLAUDE.md`, skills and plugins, and switching leaves `claude` in your terminal using the account labeled **Terminal login**. **Disconnect** on that login signs it out in both places; **Remove** signs out and forgets an added account. More in the [accounts guide](accounts.md).

### Will it use my usage credits once I reach a limit?

Not by default. A Claude account on a team or paid plan can go on in usage credits once its session or weekly limit is used up, so buddylist stops a turn there instead: it doesn't start one that would use them, and stops one as soon as Claude says it is. The conversation says which limit and when it resets, with **Use credits for this turn**, which asks first, and **Switch account**. Turn it off for an account with **Stop at the plan limit** in **Settings > Accounts**. More in the [accounts guide](accounts.md#stopping-at-the-plan-limit).

### Is there a keyboard shortcut to find contacts and actions?

Press **⌘K** on Mac or **Ctrl+K** on Windows and Linux in the contact list or a chat. The command palette searches contacts, the words in your conversations, the files of a chat's folder, the current window's menu actions, what a conversation's buttons do, such as **Invite** and **Create PR**, and the pages of Settings, each project's too. Type a name or a few words, in any order: every word has to match, and words in "quotes" are found side by side. Use the arrow keys and Enter to choose, or Esc to close it. It knows other words for things too, such as `PM` for a project's manager or `shell` for the terminal. Past conversations open in message history, where **Continue** resumes them. When nothing matches, it offers to search all message history for what you typed. More in the [command palette guide](contact-list.md#command-palette).

### Can I change the keyboard shortcuts?

Yes. **Settings > Shortcuts** has the keys for the command palette, the contact list and Quick send from any app, adding a contact, the terminal, the tabs beside a chat, invitations and voice clips. Click a box and press the keys you want. Keys another shortcut has, or that every app keeps, such as Copy and Paste, are turned down, and **Use default** puts one back. More in the [settings guide](settings.md#app).

### Can I send a message while I am in another app?

Yes. **Control+Option+S** on Mac, **Ctrl+Alt+S** on Linux or **Ctrl+Alt+Shift+S** on Windows opens Quick send for the contact and chat tab you last viewed. It shows the recipients and folder before you send. Enter sends, Shift+Enter adds a line, and Esc closes it while keeping your draft. **Quick send to last contact** in the menu-bar or tray menu works too. More in the [quick send guide](contact-list.md#quick-send).

### Can I save messages I use often?

Yes. The speech-balloon button under a conversation lists **Quick messages**. Choosing one puts its words at the caret for you to edit and send. **Save as quick message...** keeps what you are writing, and **Settings > Quick messages** lets you name, edit or remove saved messages. The list is shared across conversations. More in the [conversations guide](conversations.md).

### Can I see how much my agents have spent?

**Contacts > View spending...** shows reported costs in US dollars for today, this week and this month, with a breakdown by contact. Archived contacts count too. These are estimates from retained message history, not your bill or subscription balance. Some agents, including Codex, do not report dollar costs, and deleted history no longer counts. More in the [spending guide](contact-list.md#spending).

### Can my personal message show the song I am playing?

On Mac, click your name in the contact list and turn on **Show what I'm listening to**. Spotify or Apple Music's song title and artist replace your personal message while music plays. Your saved message comes back when playback stops or you turn the option off. This is optional and available only on Mac. More in the [music status guide](contact-list.md#music-in-your-personal-message).

### How do voice clips work?

Hold **F2**, say your message and let go. What you said is typed into the message box, so you can fix it before you press Enter. Your voice is turned into text on your computer by whisper.cpp, and the recording never leaves it. Neither whisper.cpp nor its model is bundled: run whisper.cpp and download a model; the guide has setup instructions for your platform. **View > Voice clips...** in a conversation, or **Tools > Voice clips...** in the contact list, changes the shortcut, and can send what you said as soon as you stop talking, without waiting for Enter. More in the [voice clips guide](voice-clips.md).

### Can I answer my agents from my phone?

Yes, through [Tailscale](https://tailscale.com), with no server of ours: your conversations stay on your computer, which keeps buddylist running. **Settings → Remote access** walks you through setting it up, one step at a time: Tailscale on your computer and your phone, a password, a private address, and a QR code to pair your phone. Your phone then has a small app that lists who is waiting for you first, and opens a conversation to reply, allow a permission, answer a question, approve a plan or stop an agent. It can also notify you when an agent needs you, finishes or runs into a problem: **Send a test** under its bell checks that they arrive, and on Android a permission's notification has **Decline**. The app opens even while your computer is asleep or out of reach, and says so, with **Retry**. More in the [remote access guide](remote-access.md).

### Can a phone only answer, or only read?

Yes. When you pair a phone, pick **Full**, **Answer only** or **Read only** above its code, and change it any time on its row in **Settings → Remote access**. **Answer only** answers permissions, questions and plans and can stop an agent, but sends no messages, can't **Always allow** and approves a plan only asking before edits. **Read only** just reads. Your computer checks every request against the level, whatever the phone shows, and an open phone app shows a change at once. Phones paired before levels came in, and a browser signed in with the password, have full access. More in the [remote access guide](remote-access.md#what-a-phone-may-do).

### Can I stop it from interrupting me?

Yes. Set your own status to **Busy** or **On The Phone** and the toasts, sounds, nudges and dock bounce stop, while the dock icon and the menu bar keep counting. **Appear Offline** hides the counts too. Nothing is answered for you: when you go back **Online**, every contact still waiting asks again. The app also shows you as Away after five minutes without input.

### Can I find an old conversation again?

Yes. Starting a new chat moves the conversation to message history instead of deleting it. Right-click a contact and choose **View message history** to browse and search its past conversations, save one as Markdown or delete it. **Continue**, or a double-click, makes one the current conversation again, and the agent picks up the session it had; one from your terminal is copied first, so the terminal's own stays as it was. The newest 50 per contact are kept, on your computer. To look through every contact at once, choose **Contacts > View all message history...** for every contact's conversations in one window, newest first, or type in the contact list's search box: from two characters on, it also lists the contacts whose conversations contain every word you typed.

### Where are my earlier Claude Code and Codex conversations?

Local Claude Code and Codex conversations from your terminal, desktop app or editor are already in the app. Click **History** over the contact list: **From Claude Code** and **From Codex** list them by folder, from the first day. Pick one to read it, **Add a contact here** for a folder no contact works in, or **Continue in a new contact there** to go on with a copy, leaving the original unchanged. Codex needs an installed CLI that supports listing, reading and forking threads. When you add a contact, Add a Contact says how many a folder has. More in [Conversations from your terminal](conversations.md#conversations-from-your-terminal).

Chats on claude.ai, in the browser or the Claude app, are kept by claude.ai and can't be brought in yet. **Settings > Privacy > Export data** on claude.ai sends you a copy of them. A Claude Code session on the web comes to your computer with `claude --teleport` in a terminal in the project's folder; once it is there, it is listed with the rest.

### What if I'm done with a project for now?

Archive its contact. Right-click it and choose **Archive contact**: it stops, its conversation window closes and it moves to an **Archived** section that stays folded. Its message history, folder and worktree are kept. The sidebar beside a conversation has the same folded Archived section: click a contact there to read its history. **Restore contact** brings it back as it was, and its conversation picks up where it left off. Turn on **Archive contacts once their pull request is merged** in Settings and it happens by itself (**Archive once merged** in the **▼** of a conversation's **View PR** button does it for one contact, or keeps one out), or right-click the project and choose **Archive contacts** to put all of its contacts away at once. For the contacts you use most, **Add to favorites** lists them at the top.

### Can I use my own emoticons and winks?

Yes. Drop pictures into `emoticons`, `winks` or `pictures` inside the `pack` folder in [your app data folder](getting-started.md#where-your-data-lives), and restart the app. GIF, PNG, WebP and JPEG files work. Put an audio file with the same name next to a wink and it plays with sound. The app comes with its own smileys and 15 classic winks, and a file with the same name replaces the bundled one. Make sure you have the right to use what you add.

## Looks, privacy and updates

### Does it have to look like 2005?

No, and a new install doesn't: it starts in the professional look, with the messenger one click away on the welcome wizard's **Pick your look** page. Otherwise, **Tools > Look > Professional** in the contact list, or **View > Look > Professional** in a conversation, takes the costume off: flat panes, your system's own type, line icons, slate by day and ink at night, and the messenger's blue as its one colour. Every button, menu and key stays where it was. **Messenger** brings the MSN look back, and a theme such as Olive Green gives either look its colour. More in the guides to the [professional look](professional-look.md) and the [MSN look](msn-look.md).

### Is there a dark theme?

Yes. **Tools > Theme** in the contact list, or **View > Theme** in a conversation, has **Light**, **Dark** and **Match system**. Dark is Luna at night: the title bars keep their blue and everything under them goes navy. XP's other colour schemes are there too, each by day and at night: **Olive Green**, **Silver**, **Royale** and **Pink**. Every window changes at once, and web pages in the Browser tab follow along.

### Can I read or change its code?

Yes. buddylist is open source under the MIT license, at [github.com/SafaElmali/buddylist](https://github.com/SafaElmali/buddylist), with its releases. The contributing guide there says how to run it from the source, test a change and send it. A copy you build yourself sends no counts and no error reports.

### Where are my conversations stored?

On your computer: `~/Library/Application Support/buddylist/` on Mac, `%APPDATA%\buddylist\` on Windows, or `~/.config/buddylist/` on Linux (under `XDG_CONFIG_HOME` when set). Each agent keeps its own session transcripts, such as Claude Code's in `~/.claude/`.
