# The Run button

**Run** in a conversation window starts your project's own command, such as a dev server or a test watcher, in that contact's folder. Each contact gets a port of its own, so several contacts on the same project can each run a dev server at once. A project can have more scripts than the button's own, and a script that sets up each new worktree.

**The first time.** With no command known for the project, **Run** asks for one. It suggests one when the folder says enough: the `dev` script of its `package.json`, run with npm, pnpm, yarn or bun as the lockfile says, or the project's own `bin/dev`. After that, **Run** just starts it.

- The command belongs to the project, not to one contact. Every contact working in that repository uses it, in whichever worktree. For a folder outside a git repository, the project is that folder.
- **Code > Change the run command...** changes it later. A command that is running keeps running: the new one is used the next time you press **Run**.
- The app remembers the command itself. Nothing is written into your repository.

**More than one script.** **Code > Project settings...** opens the project's [Scripts](settings.md#scripts) in [Settings](settings.md). Add a script there, such as a test watcher, and it shows under **Code** in the conversation as **Run Tests**.

**Fill in from the project...** on that page reads the main checkout and offers its dev script, `bin/dev` and other `package.json` scripts, together with setup and cleanup commands it can detect. Review the choices and press **Fill In** to save them. Existing run scripts stay first; only new commands are added. Setup and Cleanup replacements need an explicit tick. Detection starts nothing.

- The first script in the list is the **Run** button's own.
- Each script runs next to the others, with a line of its own in the conversation. While one runs, its entry under **Code** stops it.
- A contact has one port, whatever it runs. A script that needs a second one can use the ports after it: `$((PORT + 1))`.

**The setup script.** A project's setup script runs in a contact's new worktree right after it is made, and shows in the conversation the same way: a line that says it is setting up, what it prints one click away, and how it ended. A pull request's worktree is not set up by itself: its line says the script waits, and **Run setup** in the **Setup** tab runs it. See [Settings](settings.md#scripts).

**Setup, Run and Terminal, beside the conversation.** A conversation that nothing was said in yet opens with three tabs in the lower half of the [side pane](conversations.md#the-side-pane-files-changes-and-checks-above-what-runs-below): **Setup**, **Run** and a [terminal](terminal.md). The **+** after those tabs opens **Setup** and **Run** again later.

- **Setup** shows what the setup script prints. **Run setup** runs it, also again later, and **Stop setup** stops it.
- **Run** has a button for each of the project's run scripts, and shows what each prints. The first button is the **Run** button's own.
- A project with no script yet offers to add one right there. **Add manually** opens a box with a guess from what is in the folder, such as `pnpm install`. **Ask Claude** asks your contact to work the script out: it answers in the conversation, for you to add.
- A script added here is the project's, as one added in Settings is: every contact working on the project uses it.

**A port of its own.** A contact's first run picks a port that is free at that moment and that no other contact has: 4100, 4110, 4120 and so on. The contact keeps it between runs and when you reopen the app, so your bookmarks stay valid.

- The command finds its port in the environment as `PORT` and `BUDDYLIST_PORT`.
- The project's own [variables](settings.md#environment) are there too, and `BUDDYLIST_ROOT_PATH` for the project's main checkout.
- If something else has taken the port by the time you press **Run**, the contact gets another one and the conversation says so.
- A dev server that doesn't read `PORT`, such as Vite, needs the port as an option: `pnpm dev --port $PORT`. The suggestion adds it where it can tell.

**While it runs.** The button reads **Stop Run**. It is not **Stop**, which stops the agent. The conversation gets a line of its own with:

- what was started and on which port
- a link that opens `http://localhost:<port>` in your browser. Right-click it to open the page [beside the conversation](browser-tab.md) instead. A project whose page is somewhere else says so under [Preview URLs](settings.md#scripts)
- **Show output**, which shows what the command prints as it arrives

When the command ends, a line says so, with the exit code if it failed. Close the conversation window and open it again, and the command is still shown as running, with its output so far.

Good to know:

- Your contact is not told any of this. The lines are between you and the window. They are not kept in your message history.
- Unless you hand it over: type `@` in the message box and choose the script, such as **dev** or **Setup**, or right-click its tab and choose **Add to message**. The message then has the end of what its newest run printed, as [a terminal's output](conversations.md) does.
- The command runs through your shell, with the same `PATH` as in your terminal. On Windows that is Git Bash, the bash that comes with Git for Windows, so a script is written the same everywhere; `CLAUDE_CODE_GIT_BASH_PATH` says where it is, as for Claude Code. Without Git Bash it runs in cmd.exe.
- Only the end of the output is kept, about a thousand lines, and only while the app is open. Nothing of it is written to disk.
- Stopping stops everything the command started, not just the command itself. Whatever ignores that is killed after three seconds.
- Everything a contact runs is stopped when you delete the contact, change its folder or quit the app. Quitting waits until it is gone.
- The browser preview starts nothing: it makes up a port and a few lines of output.
