# Subagents

A Claude contact often hands part of a job to a **subagent**: an agent of its own, which works beside it and comes back with a report. The **Subagents** tab shows which of them are at work and what each one is doing, in the pane beside the conversation.

**Opening it.** Choose **View > Subagents**, press ⇧⌘H (Ctrl+Shift+H on Linux and Windows, or the keys you gave it under [Settings > Shortcuts](settings.md#app)), or click the **+** after the pane's last tab.

- While subagents are at work, a **Subagents** button in the toolbar opens it too, and wears the number of them. It stays pressed while the tab is on show, and a second click puts the tab away. It goes once none is at work.
- In the conversation, the line _"Claude asked a subagent to..."_ has a **View subagent** link. It goes to that subagent's row, and opens it.

**A row for every subagent.** The ones at work come first, in the order they were asked.

- **What it is doing right now** is under its name: "Running npm test · 3 steps", "Reading cart.js", "Thinking" between two steps. Next to its name are the kind of subagent it is, such as `Explore`, and how long it has been at work.
- **Click a row** for the whole of it: what it was asked, in Claude's words; every step it took, each with its output or its changes one click away; and its report, once it is back.
- **Stop** ends that one subagent. Claude is told, and carries on with the rest: the turn is not stopped. A nudge (Esc twice) stops everything, the subagents too.
- **A subagent that has ended stays listed**, under the ones at work: whether it finished, ran into a problem or was stopped, how long it took, and its report. They are still there when you open the conversation again, and go when you start a new one.

Good to know:

- **A subagent can outlast the turn it was asked in.** Claude may answer "I will tell you when they are back" and go quiet while they work. The tab, and the number on the button, say that they still are. So does the contact list: the contact stays Busy, with "2 subagents at work" under its name, though nobody is typing.
- **Claude speaks up again when they report**, without you sending anything. That is a turn like any other: the status bar says it is typing, and **Stop**, or Esc twice, stops it.
- **The conversation tells the same story in order**: "Claude asked a subagent to...", then a "Subagent ran..." line for each step. With several subagents at work at once, only the tab says which step is whose.
- The line that asked for a subagent stays open until the subagent is back. Its **Show output** is then the subagent's report.
- In a [group conversation](group-conversations.md), the subagents of everyone there are listed, each with whose it is. Subagents at work hold nobody up: the next agent gets its turn. When one of them reports and its agent speaks up, a message you send meanwhile waits for it to finish.
- Subagents end when you quit the app, and when you delete or archive their contact. They are listed as stopped.
- Subagents from before this tab existed are listed without their steps: those were not saved with whose they were.
- Commands and watchers Claude leaves running are not subagents: the [**Background**](background.md) tab lists those.
- Codex, Gemini, OpenCode and Hermes do not say what their subagents do, so their conversations have no **Subagents** tab.
- In the [live demo](https://buddylist.dev/demo/) and in demo mode, a message with "subagents" (or "helpers") in it has a Claude contact start two scripted ones.
