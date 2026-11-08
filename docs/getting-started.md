# Getting started

buddylist puts your coding agents in a buddy list, the way MSN Messenger had your friends. Each contact is an agent working in one of your project folders, or on [This computer](contact-list.md#this-computer) with no project, for a question or some writing, and each conversation is a real session of it: the same agent, tools, settings and login as `claude` in your terminal. Claude Code comes with the app. [Codex](codex.md), [Gemini](gemini.md), [OpenCode](opencode.md) and [Hermes](hermes.md) contacts run the ones you already use.

Want to look around first? The [live demo](https://buddylist.dev/demo/) is the app's real windows in your browser, with scripted contacts.

## Install

- **Mac (Apple Silicon):** [Download the DMG](https://github.com/SafaElmali/buddylist/releases/latest/download/buddylist-mac-arm64.dmg), open it and drag **buddylist** to **Applications**.
- **Windows (x64):** [Download the installer](https://github.com/SafaElmali/buddylist/releases/latest/download/buddylist-win-x64.exe) and run it. Install Git for Windows for Claude Code and project scripts. The Windows installer is unsigned.
- **Linux (x64):** [Download the AppImage](https://github.com/SafaElmali/buddylist/releases/latest/download/buddylist-linux-x86_64.AppImage), make it executable and open it, or [download the Debian package](https://github.com/SafaElmali/buddylist/releases/latest/download/buddylist-linux-amd64.deb) and install it with `sudo apt install ./buddylist-linux-amd64.deb`.

Mac, Windows and AppImage installations download updates in the background. Debian packages show an update notice; install the new `.deb` to update. Intel Mac and ARM Windows/Linux installers are not provided.

The Mac app is signed and notarized by Apple, so the first time you open it macOS only asks whether to **Open** it. Linux AppImages need FUSE support; on Debian or Ubuntu, use the Debian package if your system cannot mount the AppImage.

## The welcome wizard

The first time, a [welcome wizard](welcome-wizard.md) opens in front of the contact list. It takes about a minute:

- It says which of your agents are installed and signed in, and what to do about one that isn't.
- It [signs you in to Claude](welcome-wizard.md#signing-in-to-claude) through your browser if you aren't yet. A sign-in from `claude` in a terminal counts too.
- It ends in your first project: a folder on your computer, one of your repositories on GitHub, or a new one.

**Help > Getting started** in the contact list opens it again.

## Your first conversation

Double-click a contact to open its conversation, and say what you want done. The agent reads your project, runs commands and edits files, and you see it as a messenger would show it: _"Claude is typing a message..."_ in the status bar, and lines such as _"Claude ran `npm test`"_ for what it did.

- **It asks before it acts.** A command or an edit comes as an invitation: **Accept (⌥C)**, **Always allow** or **Decline (⌥D)**.
- **Stop it any time.** While the agent works, **Send** turns into **Stop**. **Nudge** shakes the window and stops it too, and so does pressing `Esc` twice. The first `Esc` only says in the status bar that a second one stops it, so one stray press stops nothing.
- **More than one at a time.** The **+** on a project starts another contact for it, in a worktree of its own, so two agents don't undo each other's work. See [The contact list](contact-list.md).
- **Bring in another agent.** Invite a second contact into the conversation, and they answer in turn: see [Group conversations](group-conversations.md).

## Keeping up to date

On Mac, Windows and AppImage installations, new versions download in the background. Once one is ready, a card at the bottom of the contact list says so: **Restart** installs it. While a contact is working or waiting for you, **When idle** comes first: it installs it by itself once your contacts are done and you are away from the computer. **Help > What's new** opens the [changelog](https://buddylist.dev/changelog).

Debian installations show an update notice. Download the new `.deb` and install it with the same `sudo apt install` command.

## Where your data lives

Contacts, settings and chat history stay on your computer, in the app's data folder:

| System  | Default folder                                                    |
| ------- | ----------------------------------------------------------------- |
| macOS   | `~/Library/Application Support/buddylist/`                        |
| Windows | `%APPDATA%\buddylist\`                                            |
| Linux   | `~/.config/buddylist/`, or `$XDG_CONFIG_HOME/buddylist/` when set |

Past conversations are in `history/archive/` inside that folder. Each agent also keeps its own session files, such as Claude Code's in `~/.claude/`. The conversations you had with Claude Code before the app are read from there, and listed under **History** from the first day: see [Conversations from your terminal](conversations.md#conversations-from-your-terminal). `BUDDYLIST_USER_DATA` overrides the app's data folder when set.

## Where next

- [Conversations](conversations.md): plans, the files that changed, the side pane, Create PR and message history
- [The contact list](contact-list.md): statuses, groups, projects from GitHub, worktrees and pull requests
- [The Run button](run-button.md), [the terminal](terminal.md) and [the browser](browser-tab.md) beside a conversation
- [Settings](settings.md): the app's own, and each project's
- [The MSN look](msn-look.md) and [the professional look](professional-look.md)
