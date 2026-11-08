# Settings

The **gear in the title bar** of the contact list or a conversation, **buddylist > Settings...** in the Mac menu bar, **Tools > Settings...** in the contact list or **View > Settings...** in a conversation, or **⌘,** on Mac (**Ctrl+,** on Windows and Linux, or the keys you gave it under [Shortcuts](#app)) opens Settings in the window you are in.

Settings takes that window's place, under a title that says so. **Back**, at the top left with the name of what you came from, or **Esc** gives the window back as it was: the conversation scrolled where it was, the message you were typing, and the panes open beside it.

- **A conversation goes on under Settings.** An agent keeps working, a terminal keeps running, and the title bar says when someone is at work or waiting for you. A click on that line goes back to the conversation. Esc in Settings closes Settings, and never nudges an agent.
- **The contact list is made wider.** It grows to 660 pixels while it shows Settings, and gets its width back after.
- **One window at a time.** Asked for in another window, Settings moves there, and the first window shows what it had. Asked for from a window that can't hold it, such as the [message history](conversations.md#every-contacts-message-history), it opens in the contact list. **buddylist > Settings...** in the Mac menu bar opens it in the window in front.
- Asked for without a page, it opens on the page it was on last in that window, or on **General**.

On the left, its pages are under **App**, **Agents**, **Every project** and **Projects**, where each of your projects lists what it is set up with. Services, Accounts and Models sit together under Agents. **Instruction presets** is nested under **Every project > Instructions** while either page is open; Instructions also links directly to it. **Project settings...**, in a project's right-click menu, opens it at that project's [Overview](#overview), **Code > Project instructions...** in a conversation at its [Instructions](#instructions), and **Edit teams...** beside a new contact's **Team** at [Roles & teams](#agents). The [command palette](contact-list.md#command-palette) (**⌘K**) opens any page by its name, or by a word for what is on it, such as `hotkeys`, `telemetry` or `PM`.

There is no OK button. A switch or a box is saved as soon as you change it, and the bar at the bottom says so, or says why it could not be kept.

## Layout and controls

Each page uses one centered reading column, up to 680 pixels wide, that narrows with the window. Section headings, their explanations and their controls stay together, with more space between sections than between the parts of a setting.

Lists you can add to, such as quick messages and run scripts, show one line per item. Click a line to open its fields for editing, and click it again to fold them away. Fields have visible labels above them; names and messages use the look's usual text, while commands and addresses use fixed-width text. Long values wrap as the window narrows. **Remove** is on the item's line, and **Add** sits below the list, apart from the last item.

In the **Professional** look, on/off settings are switches to the right of their labels. In the **Messenger** look, they are checkboxes. Click the control or its label, or use **Tab** to reach it and **Space** to change it. Switches have a visible keyboard focus ring and stop sliding when the computer asks for reduced motion. Screen readers announce them as switches or checkboxes to match the look, including when the look changes while Settings is open.

## App

**General.** The [look](professional-look.md) and the [theme](msn-look.md#themes), sounds, showing you as Away while the computer sits idle, and how [voice clips](voice-clips.md) record. The look and the theme are a picture each, a close-up of a conversation drawn in it, big enough to tell the colours apart: click one to change every window at once. A theme's picture is in the look you are in: the messenger's title bar and toolbar, or the professional look's Accept button. Match system's, and a look's, are half by day and half at night.

**Conversations.** What a conversation shows and does: the lines that say what a contact does, [suggested replies](conversations.md) (the message you would send next, grey in the empty box, and answers under a question), and whether a click on a link opens it [beside the conversation](browser-tab.md).

- **Open windows maximized** makes new conversation windows fill the work area of the display they open on, without entering macOS fullscreen. It starts off. Restore returns to the usual window size and position. Windows already open, the contact list and Message History keep their sizing; contacts, side panes and Settings fit inside a maximized conversation. This option is only in the desktop app.
- **Start the conversations Claude adds**, last on the page, lets a side task Claude thinks of itself begin at once. It is off to begin with: those conversations wait with a draft for you to review and send. Turned on, they start in the mode of the conversation that added them, so in one that asks nothing first they change files on their own. See [Started conversations](started-conversations.md).

**Quick messages.** The [quick messages](conversations.md) you put in the message box with a click, offered in every conversation. Each has a name, which is what the list under the conversation calls it, and the words it puts in the box. A message left without a name is called by its first words. **Save as quick message...** in that list adds the one you are writing.

**Shortcuts.** The keys for what buddylist does: the two that work from any app (the contact list and [Quick send](contact-list.md#quick-send)), Settings and the [command palette](contact-list.md#command-palette), adding a contact, and in a conversation a new chat tab, your contacts beside it, the [terminal](terminal.md), the tabs beside the conversation, answering an invitation and recording a [voice clip](voice-clips.md). Click a box, then press the keys you want to use.

- A shortcut is one of the F keys, or a key with Ctrl, Alt or ⌘. Keys another shortcut already has are refused, and the bar at the bottom says which one has them. So are the ones every app keeps, such as ⌘C, ⌘V, ⌘Z, ⌘S, ⌘W and ⌘Q, and Esc, Enter, Tab and Backspace, and [Find in the conversation or an open file](conversations.md)'s ⌘F (Ctrl+F, and Ctrl+Shift+F for a [terminal](terminal.md)).
- **Use default** puts a shortcut back to the keys it starts with. **Use all defaults** puts every one back.
- A change holds at once, in every window that is open: the keys, the menus, the tooltips, **Help > Keyboard shortcuts** and the menu-bar icon's menu. One from any app that another app already has does nothing, and the menu-bar icon's menu then doesn't name it.
- The keys are kept by where they are on the keyboard, so a key that ⌥ or Shift makes type something else is still the same key.
- Esc, Enter and ↑ in the message box, **Ctrl+Tab** from tab to tab, and the keys of a [web page beside the conversation](browser-tab.md) stay as they are.

**Privacy.** Whether the app shares anonymous usage counts, which features are used, and sends error reports, an error it did not expect or a crash. Never what you type, your folders or your conversations.

**Remote access.** Use buddylist from your phone, wherever you are, through Tailscale. Until a phone has paired, the page is five steps, one at a time, each with one button: Tailscale on this Mac, Tailscale on your phone (it ticks itself once the phone is on your tailnet), turning it on with a password (for a browser that can't scan a code), a private address through Tailscale Serve (it asks first and shows what Tailscale prints), and a QR code to pair the phone. Then the page says whether your phone can reach this Mac, or why not, with the switch and the address; lists each phone or browser signed in, with **Sign out** and **Pair another phone**; has the two switches of **Notifications on your phone** (**Only when I'm away from this Mac**, on at first, and **Show what was said**, off at first) and **Keep this Mac awake**; and folds the setup away. [Remote access](remote-access.md) says how to set it up, and what the phone app does.

## Agents

**Services.** Each service runs your agents through a command-line app, such as Claude Code or Codex CLI. buddylist finds it automatically: Claude Code comes bundled, and Codex, Gemini, OpenCode and Hermes are found on your shell’s PATH. Each line shows its status and the detected path and version when available, or identifies bundled Claude Code. The checks are the same as the [welcome wizard](welcome-wizard.md); Gemini, OpenCode and Hermes can confirm installation, but sign-in or provider setup is only known after your first message.

- Open a line for diagnostic actions and its full executable path. Claude also has **Account settings**, which opens its managed accounts. **Use a different installation** holds **Custom executable path (optional)** and **Choose executable...**; it starts closed unless an override is already saved. Leave the path empty for automatic detection. **Use default** clears an override; it is a secondary button, disabled when no override is set. Changes apply to new conversations.
- **Not installed** means the executable was not found. Open the line for installation instructions or **Setup guide**. **Check again** retries after installing or signing in. A failed check says why; a probe that has not answered after eight seconds is stopped and reports a timeout instead of staying on “Checking installation...”.

**Accounts.** The Claude accounts your contacts answer in: **Terminal login** (the account Claude Code uses in your terminal), and the ones you added. **Account settings** in a conversation's usage popover opens this page directly, even while usage is loading. **Use** puts one in use. **Automatically switch accounts at usage limits** is off by default: a limit asks before switching, and accepting applies only to that switch. Turn it on here to let every Claude conversation go on in the next account without asking. See [Accounts](accounts.md).

**Fallbacks.** Build an ordered list of services, models and Claude accounts that can take over after a session limit, weekly limit or repeated server failure. Each entry has its own paid-usage policy (Never by default, Ask, or Allow), minimum allowance, unknown-usage behavior and optional confirmation. Switching automatically never grants spending consent. Current live integrations cannot guarantee no paid usage, so Never entries are skipped with an explanation. A project's **Fallbacks** page inherits, replaces or disables the global list. See [Continuing with another provider](accounts.md#continuing-with-another-provider).

- **Use backup services** turns recovery on; **Switch automatically after checks** controls whether a switch itself asks. Spending consent and an entry's **Always ask** still apply.
- Collapsed rules show their service/model, triggers, account and spending choice. **Account currently in use** is resolved when recovery starts; a named Claude account stays tied to that rule. Other services use their CLI login. Claude's rule editor links to **Account settings**.
- Inherited project rules show whether global fallbacks are on, their order and conditions, and **Edit global fallbacks**. Merely viewing them does not create a project override.
- A minimum remaining allowance is a check before the turn, not a spending cap. The page explains which interruptions qualify and when automatic recovery cannot apply. These explanations do not change eligibility, consent, spending defaults or saved rules.

**Models.** Which models **Add a Contact** offers for each service. Each service's line names them, such as "Opus 5.5, Sonnet 5.5, Haiku 5.5". Click it, then **Choose models...** to change them.

**New contacts.** What **Add a Contact** starts out with for each service: its **Model**, **Effort** and **When it wants to do something**. Each starts as **Like the contact it’s added from**, which is how the dialog has always worked: it copies the contact whose **+** you clicked, or else the one you added last. Pick a model, level or mode instead and every new contact of that service starts with it, wherever it is added from, also on This computer. **Default** is the service's own choice, named where it can say, such as **Default (Opus 5.5)**. The levels follow the model picked here, and a level the new model doesn't take goes back to Default. Each service's line says what is picked, such as "Sonnet 5.5 · High effort · Asks first". You can still change all three in **Add a Contact** itself. A manager's workers on **Your defaults for new contacts** take the model and effort level picked here too, and its workers start in the mode picked here while its **Permission mode** is **The service’s default**.

**Roles & teams.** The agents that join a new contact's conversation with it. See [Roles and teams](group-conversations.md#roles-and-teams).

- **Roles** are the agents. Each has a name, a service, a model and an effort level, the mode it starts in (**Permission**), when it answers, whether it is **Read only**, and its **Instructions**: what it is told, after what its project tells every agent, as a project's [Instructions](#instructions) are. The app starts with a **Reviewer**.
- **A line for each.** Each role is a line with its whole name and how it is set up, such as "Codex · gpt-5.5 · High effort · Answers after changes · Read only · Never asks". A mode is said once one is picked. Click it, or press Enter on it, to open its settings under it. One role is open at a time, so opening another closes it. **Add role**, beside the heading, puts a new role at the end of the list, open, with its name to type. **Remove role** is at the end of what is open. Teams work the same way, and each team's line names its roles.
- **Teams** are roles that join together. Tick the roles a team has. **Add a Contact** offers them under **Team**, and **Invite** offers roles and teams on its **Roles** tab. The app starts with **With a reviewer**.
- A change to a role holds from its agents' next conversation. A role you take out leaves its teams, and the agents made from it answer as any guest does.
- **Hand-offs** sets how many turns the agents of a group conversation take on one message of yours, hand-offs included: 3, 6 (the default), 10, 20 or 50. It holds for every group conversation, from the next turn. See [Group conversations](group-conversations.md).

**Schedules.** Prompts that start a contact by themselves, on a cadence, such as weekdays at 9. A line for each says its name, when it runs and when next, with the switch that turns it on or off at its end. Click it to see its project, service, last run and how many runs it had, and why its last run failed, if it did, with **Run now**, **Edit...** and **Delete**. **New schedule...**, beside the heading, opens the same dialog as **Contacts > New schedule...**. See [Schedules](schedules.md).

## Every project

What every project starts with and is told, and the instructions you keep for any of them. A project's own settings, under **Projects**, win over these.

**Git.** How the branches and worktrees of your contacts are made. See [The contact list](contact-list.md) for what a worktree is.

- **Branch prefix** goes in front of every branch made for a contact, such as `safa/feature`.
- **Name a branch after the work** renames a made-up branch, such as `shop-2`, after the first thing you ask its contact to do. Turned off, the branch keeps the name it was made with, and **Add a Contact** shows that name in the branch field. A contact on [This computer](contact-list.md#this-computer) has no branch: its made-up nickname, such as **Claude (chat-4)**, follows the work the same way, or is kept with this off.
- **Remove worktrees with contacts** decides whether "Also remove its worktree" starts out ticked when you delete a contact. Deleting still asks.
- **Delete the branch with its worktree** deletes the branch on this computer when a contact's worktree is removed. What was pushed stays on the remote. Commits that were only on that branch are gone.
- **Archive contacts once their pull request is merged** puts a contact away as soon as GitHub says its pull request was merged, as **Archive** next to the **Merged** tag does. One that is working or waiting for you finishes first. Only a merge the app sees while it is open counts: a contact whose pull request was merged while buddylist was closed, or one you restore, keeps its **Continue** and **Archive** buttons. **Archive once merged** in the **▼** of a conversation's **View PR** button says otherwise for that one contact, whichever way this is set.

**Environment.** Variables that the scripts, terminals and agents of every project are started with.

- **Variables** have a name and a value. The value is kept out of sight until you press the eye. It is kept in the app's own data as plain text, like a `.env` file. Nothing is written into your repository.
- **Env files** are read each time something is started, so a change in the file needs no restart of the app. They are written like a `.env` file: `NAME=value`, with or without `export` and quotes. A variable typed in wins over one from a file.

**Instructions.** What the contacts of every project are told on top of what you type, before what their project's own [Instructions](#instructions) say, with the same three boxes and the same **Presets** list beside each. A good place for how you like to work wherever you are, such as a skill every agent is to use. A skill or plugin named here has to be installed in each service you use, as each service has its own.

- **Every conversation** is told to every contact, with what its project tells it after it, in each new conversation: with their instructions for Claude and Codex, and with your first message for Gemini, OpenCode and Hermes. Contacts on [This computer](contact-list.md#this-computer) are told it too, as they get the variables of **Environment**, and so are managers and the agents that join a conversation.
- **Create PR** and **Review comments** go before what a project adds to what the **Create PR** button and the comments from the **Changes** tab ask for.
- A project's own come after these, so they can add to them or say otherwise for that project, such as "In this project, open the pull request ready for review, not as a draft."
- Only you change these. An agent can read and save its project's [Instructions](#instructions) when you say so, not these.
- A change takes effect from the next conversation you start, as a project's do. **Create PR** and **Review comments** count from the next time you use them.

**Instruction presets.** Instructions you add to project after project, such as how to show that a change works, kept once to add to any box of Instructions with a click: a project's, or every project's. Each has a name, which is what the **Presets** list calls it, and the words it adds. One left without a name is called by its first words. The app starts with two, **Screenshots in the PR** and **Tests before done**, to change or take out.

- Adding a preset copies its words into the box, so changing or removing it here leaves the boxes that have it as they are.
- **Save as preset...**, in the **Presets** list beside a project's box, adds what is in that box. Cut it down to the part other projects need before you save.

## Projects

A project is a git repository, in whichever worktree, or a folder outside any. It shows here once a contact works on it. Every contact working on a project shares what is set here. Click a project to open its **Overview**, and its pages are listed under it. A folder outside any repository has no **Worktrees** and no **Manager**.

**This computer** is listed here too once a contact is on it: every contact on [This computer](contact-list.md#this-computer) shares it, each in its own folder, and so does one in your home folder itself. Its **Instructions** are what each of their conversations is told, such as which language to answer in, and its **Environment** what their agents and terminals start with. Its **Folder** is `~/.buddylist/this-computer`, where theirs are.

### Overview

How the project is set up, and where it is. **Project settings...**, in a project's right-click menu, opens it.

- **Set up** says how many contacts work on the project, and has a line for each of its pages that says how it is set now, such as "Setup: pnpm install · Run: dev, test" for **Scripts**, or **Off** for the **Manager**, and with several managers how many there are and how many conversations are under them, such as "2 managers · 5 conversations". Click a line to open its page.
- **Main checkout**, or **Folder** for one outside a repository, and **Worktrees** say where the project and its contacts' worktrees are. **Open** shows the folder.

### Scripts

- **Fill in from the project...** detects scripts from the main checkout and shows them before saving. Tick the ones you want, then **Fill In**. Empty Setup and Cleanup fields and the likeliest Run script start ticked; replacing an existing Setup or Cleanup script requires ticking it yourself. Run scripts are added after the ones you have, without duplicating a command. Detection only reads files; it runs nothing.
- Setup uses the package manager named in `package.json` or its lockfile (npm, pnpm, yarn or bun), or `bin/setup`. It also recognizes a `Gemfile` (`bundle install`), `uv.lock` (`uv sync`), `requirements.txt` (`pip install -r requirements.txt`), `go.mod` (`go mod download`) and `Cargo.toml` (`cargo fetch`). Run offers the project's dev script, `bin/dev` and other `package.json` scripts, leaving out install and lifecycle hooks. Cleanup offers `docker compose down` only when a compose file exists. Empty boxes show the project's actual suggestion, or **Nothing found in this project**.
- **Setup script** runs in a contact's new worktree, right after it is made, and from the **Setup** tab beside a conversation whenever you press **Run setup**. Use it to install what the project needs, or to link it from the main checkout: `ln -s "$BUDDYLIST_ROOT_PATH/node_modules" node_modules`. The contact is there at once and the script runs behind it. Its conversation has a line for it, with what it prints, as for a [run](run-button.md). A worktree made from a [pull request](contact-list.md) is the exception: the script would run the pull request's code, so it waits until you press **Run setup**, and the conversation's line says so.
- **Cleanup script** runs in a contact's worktree before the worktree is removed. It gets two minutes. If it fails, the worktree is removed all the same and you are told what it printed last.
- **Run scripts** are what the [Run button](run-button.md) starts. The first one is the button's own. The others are under **Code** in the conversation, and each can run next to the others.
- **Preview URLs** say where a run is looked at. The first is the link in the run's line, and the others follow it. Left empty, that is `http://localhost:$PORT`. An address can name the contact's port as a script would: `$PORT`, `${PORT}`, and `$((PORT + 1))` for the ports after it.

Scripts run through your shell, in the contact's folder, with the project's environment. On Windows that is Git Bash, so they are written as on a Mac or Linux (see [Run](run-button.md)).

### Instructions

What the contacts working on this project are told on top of what you type, after what [every project](#every-project) is told. **Project instructions...**, in a project's right-click menu or under **Code** in a conversation (**Team** in a manager's), opens this page. So does typing "instructions" in the palette (**⌘K**). **From every project**, at the end of the page, says which boxes of **Every project > Instructions** say something, and opens it.

- **Every conversation** is told to a contact before anything else in each new conversation. Claude and Codex get it with their instructions. Gemini, OpenCode and Hermes get it with your first message. A good place for how far a contact takes a change by itself, say opening the pull request and merging it once its checks pass.
- **Create PR** is added to what the **Create PR** button asks for.
- **Review comments** is added to the comments you send from the **Changes** tab: your own on a line, and a reviewer's.

**Presets**, beside each box here and under **Every project > Instructions**, lists your [instruction presets](#every-project). Choose one to add its words to the end of the box, on a paragraph of their own, and it is saved at once. A preset the box has is ticked: choose it again to take it out. **Save as preset...** keeps what is in the box as a new one, for your other projects, and **Edit presets...** opens **Every project > Instructions > Instruction presets**.

**Or ask a contact.** "Make this the scope for this project: open the PR and merge it once the checks pass" has the agent read what the project is told now and write the new instructions. A card in the conversation shows you what would change, line by line: added lines in green with **+**, removed ones in red with **−**, and the lines that stay folded (click _… 9 unchanged lines_ to see them). With nothing saved yet, all of it is added. A long change shows its first lines and **Show all**. Nothing is saved until you answer it, whatever the contact's permission mode, and the rest of the window stays yours meanwhile:

- **Save** keeps the text as the agent wrote it.
- **Edit…** opens it in the card to change first. **Show change** shows the change with your edits, and **Save** (or ⌘↩, Ctrl+Enter on Windows and Linux) keeps exactly what you wrote. Esc goes back to the change. What you wrote stays in the card if you go to another conversation and come back.
- **Don't save** leaves them as they are.

The card then says what happened: _Saved_, _Saved with your edits_ or _Not saved_. Stopping the agent, or closing the conversation, answers it as not saved, and a card still waiting when you quit is not asked again. The agent is told whether you edited the text, and what was saved. It reads and saves only the project's own: what every project is told is yours to change. An agent can save up to 4,000 characters this way. Type longer ones here. What a new conversation is told takes effect from the next conversation you start.

### Worktrees

- **Start new worktrees from** picks the branch a new contact's branch starts from. Left alone, that is the remote's main line. The branch is fetched first.
- **Remote** picks where that branch, and a pull request you start a contact from, is fetched from. It is `origin` unless you choose another.
- **Files to copy** are the files git does not keep that every new worktree needs, such as `.env*`. One pattern on each line. They are copied from the main checkout when a contact's worktree is made. The line under the box says which files match right now.

### Environment

The same as the app's own, for this project alone. A project's variable wins over one of the same name set for every project.

- An env file that is not named in full, such as `.env.local`, is looked for in the contact's own folder. Each worktree then reads its own copy. One the worktree's branch has in git is read from the main checkout instead, in the same folder: the branch can be someone else's pull request, and what its file sets would reach the agent.
- These are always there:

| Variable                   | What it is                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `PORT`, `BUDDYLIST_PORT`   | the contact's own port, for scripts started with **Run** and the setup and cleanup scripts |
| `BUDDYLIST_ROOT_PATH`      | the project's main checkout                                                                |
| `BUDDYLIST_WORKSPACE_PATH` | the contact's folder                                                                       |

### Fallbacks

**Use global fallback rules** follows the list in **Settings > Fallbacks**. Choose **Use this project’s rules** to set a different order, services and spending conditions for this project. Turning off **Use backup services** in its own rules disables recovery here while leaving other projects alone. The same checks and spending consent apply; see [Continuing with another provider](accounts.md#continuing-with-another-provider).

### Manager

A manager using Claude, Codex, Gemini, OpenCode or Hermes that oversees the conversations assigned to it in this project. See [Project managers](project-managers.md). With two or more managers, the page lists them, each with whether it is on, its model, how many conversations are under it and its scope: click one to open what follows under its line, one at a time. **Add another manager...**, at the top of the list, or at the end of the page with one manager, adds one more. Its **Start from** chooses an existing manager's settings and brief, its settings alone, or a fresh start. Each manager keeps its own copy; the new manager's scope and assigned conversations stay its own.

- **A manager oversees this project** adds the project's manager to its section, in the main checkout: a contact named after the project, such as **tagsapp manager**. The bar at the bottom says **Manager joined tagsapp.**, and **Open its conversation**, under the switch, opens it. Turned off, it stays, with its conversation, and oversees nothing. **Add a manager...**, in the project's right-click menu, turns it on too.
- **Service** and **Model** are what the manager answers with. Changing service keeps its brief, sources, checks and team; see [switching services](project-managers.md). Changing the model badge in its conversation changes it here too.
- **New workers use** chooses what the conversations this manager starts answer with: **Your defaults for new contacts**, **Same as the manager**, or **A service and model you pick**, including effort where supported. The default follows the contact you last added yourself, with the model and effort level [New contacts](#agents) picks for that service. **Same as the manager** keeps permissions at least as strict as the manager's. See [its workers](project-managers.md).
- **Permission mode** (beside it) chooses the mode those conversations start in: **The service’s default** (the default: the mode [New contacts](#agents) picks for the worker’s service, else that service’s own), **Same as the manager** (no looser than the manager’s mode: the same where the worker’s service has it, else the nearest that is no looser), or **A mode you pick** from the worker’s service, such as **Never ask**. A mode the worker’s service doesn’t have becomes its default. A mode you pick is your choice and may ask less than the manager; a manager itself stays read-only.
- **Sources** are where it learns what the project is building: PRDs, tickets, Slack channels and threads, designs. Each has a name, a link, or both. **Add source** adds one, and the ✕ on its row takes it out.
- **Checks** are what it looks for in each change: that it follows the design, does what its ticket asks, changes no file another conversation changes, and doesn't repeat or contradict another. **Add check** adds one of your own, a sentence each.
- **Scope** is where Add a Contact's **Under** starts a new contact: a pattern on each line for its branch, such as `safa/release/*`, or a ticket key, such as `COM-6*`, that its issue or pull request can name too. See [Project managers](project-managers.md#several-managers).
- **Instructions** are what it is told on top.
- **Brief** is what it knows of the project so far. It writes the brief itself. Edit it to set something right, and it is told what you changed. The **Brief** tab beside its conversation shows it too, and its **Edit in Settings...** opens this page.

**Project manager.** Once the project has a manager at work, and no [project manager](project-managers.md#project-manager) yet, the page ends with **Add a project manager...**: a manager over its managers, which hands a worker’s job from one to another as you tell it. Its settings are then listed first, without **New workers use**, **Scope** or **Checks**, as it has no conversations of its own.

Good to know:

- The settings are kept in the app's own data, under the project. Nothing is written into your repository.
- A change to a script or a variable holds from the next time something is started. What is running is not touched.
- The browser preview has no Settings.
