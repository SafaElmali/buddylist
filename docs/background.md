# Background

A Claude contact can leave things running while it carries on: a **command** started in the background, such as a dev server or `gh run watch`, or a **watcher** that tells it whenever something happens. The **Background** tab lists them, with what each one printed, in the pane beside the conversation.

**Opening it.** Choose **View > Background tasks**, press ⇧⌘K (Ctrl+Shift+K on Linux and Windows, or the keys you gave it under [Settings > Shortcuts](settings.md#app)), or click the **+** after the pane's last tab.

- While something runs in the background, a **Background** button in the toolbar opens it too, and wears the number of tasks that are running. It stays pressed while the tab is on show, and a second click puts the tab away. It goes once nothing runs.
- In the conversation, the line _"Claude started `npm run dev` in the background"_ has a **View in Background** link. It goes to that task's row, and opens it.

**A row for every task.** The ones that run come first, in the order they started.

- **Under its name** it says that it runs, or how it ended: Claude's own words where it gave them, such as `completed (exit code 0)`. Next to its name are its kind, _Command_ or _Watcher_, and how long it has run.
- **Click a row** for what it runs and the end of what it printed. While it runs, that is read again every two seconds, and stays at the bottom unless you scroll up.
- **Stop** ends that one task. Claude is told, and carries on: the turn is not stopped.
- **A task that has ended stays listed**, under the ones that run, until you start a new conversation.

Good to know:

- **What runs in the background keeps the contact Online, but not idle.** Its turn is over, so you can write to it, and quitting or restarting to update doesn't wait for it: a dev server can run all day. Its row in the contact list wears this tab's arrow going round on its buddy and says what runs, such as "A command running in the background", in the colour of what a busy contact is doing; the status bar says the same. The manager's Team tab and the phone list it under **Working**. Once the last one ends, the row goes back to what it said before. Stopped at its [plan limit](accounts.md#stopping-at-the-plan-limit), it won't go on once they end, so its row doesn't say it is at work.
- **A watcher can wake Claude up.** When it reports something, Claude may answer without you sending anything, as it does when a subagent reports.
- What Claude leaves running ends with its Claude Code: when you quit the app, start a new conversation, or Claude switches accounts. It is then listed as stopped.
- Only the last 8 KB of what a task printed can be read: that is what Claude Code keeps of it.
- A task's output can't be read any more once its Claude Code has ended. What you read before then stays on show.
- [Subagents](subagents.md) are not listed here: they have a tab of their own.
- In a [group conversation](group-conversations.md), everyone's tasks are listed, each with whose it is.
- Codex, Gemini, OpenCode and Hermes don't say what they leave running, so their conversations have no **Background** tab.
- In the [live demo](https://buddylist.dev/demo/) and in demo mode, a message with "background" in it has a Claude contact start a scripted dev server and a watcher on CI. The watcher ends after a few seconds; the dev server runs until you stop it.
