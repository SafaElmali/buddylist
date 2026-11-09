# Codex

Codex contacts run the `codex` installed on your computer, with the same login, `config.toml`, `AGENTS.md`, hooks and MCP servers.

**Set it up.** Install the [Codex CLI](https://github.com/openai/codex) and log in:

```bash
npm install -g @openai/codex
codex login
```

It isn't bundled, because its binary is over 300 MB. The app finds `codex` on your `PATH`; set `BUDDYLIST_CODEX_CLI` to use a different one.

**Outside conversations.** **History** over the contact list has **From Codex**, with your local terminal, desktop and editor threads grouped by folder. Search by title, first message, project or branch; a Codex contact’s own History also searches what was said in that folder’s threads. **Add a contact here** selects Codex and that folder. **Continue in a new contact there** forks the thread through Codex, so the original stays unchanged. Archived threads and buddylist’s own sessions and suggestions are excluded. Reading starts no conversation and runs no turn. If the CLI is missing or too old, History explains why; update it with `npm install -g @openai/codex`. See [Conversations from your terminal](conversations.md#conversations-from-your-terminal).

**Add a contact.** Pick **Codex** as the **Service** in **Add a Contact**.

You get the same windows as with Claude:

- streamed replies
- a line for each command, file change, web search and MCP tool call
- Accept / Always allow / Decline invitations
- questions and app-tool approval choices, with your answers sent back to Codex
- network and filesystem access requests that show the destination or paths before you accept
- Nudge to stop
- conversations that pick up where they left off
- suggested replies, using the small model your Codex account lists (or the conversation's model when it lists none): the message you would send next, grey in the empty box for **Tab**, and buttons after questions (controlled by **Suggest replies** in Settings)
- the **meter** at the end of the status bar, or `/context`: how full the context window is, how much of your plan's limits is used, and under **Usage credits** the credits you have left past them

Codex has its own **Permission mode** menu, under **Conversation** and in the mode badge under the conversation:

| Mode                           | Codex asks before...                                    | Its commands can write... |
| ------------------------------ | ------------------------------------------------------- | ------------------------- |
| Ask before acting              | every file change, and most commands                    | inside the folder         |
| Work freely inside this folder | leaving the folder or using the network                 | inside the folder         |
| Read only                      | changing anything                                       | nowhere                   |
| Never ask                      | nothing. Only use it in folders you don't mind breaking | anywhere                  |

A manager or read-only guest stays in a read-only filesystem sandbox in every mode, **Never ask** included. Its commands read the network inside that sandbox, so `gh api` or `gh pr checks` work without a prompt, and Codex isn't asked to confirm each command first: nothing it runs can write. When Codex asks to run a command outside the sandbox, buddylist declines it without asking you, as accepting could let it write. That includes a retry without the sandbox and a network approval, since Codex's request doesn't say whether accepting keeps the sandbox. The conversation says so once a turn, and Codex is told to start a worker for changes. `git fetch` writes into `.git`, so it is declined too. The mode badge keeps the selected approval mode, which still decides whether buddylist's own tools ask, such as messaging a worker, and its tooltip explains the read-only restriction.

**Fast mode.** Open the model badge under the conversation, or **Conversation > Fast mode**. This works for Codex managers and ordinary contacts; in a group, choose the Codex participant. Fast mode selects Codex’s `priority` service tier, independently of reasoning effort. The menu and badge show the model’s speed description and disclose increased usage. See [OpenAI’s speed guide](https://learn.chatgpt.com/docs/agent-configuration/speed) for current subscription and credit rates.

Buddylist only offers Fast mode when the installed Codex app-server advertises the model’s `priority` service tier and permits Fast mode. A model or older CLI that does not report that capability gets an unavailable explanation. Update Codex and refresh **Models** to check again. A saved Fast preference is suspended on an unsupported model and applies again when a supported model is selected; it can still be turned off while unavailable. An older CLI that cannot report speed support keeps using its own settings and shows a notice that it cannot confirm the saved choice; update it to apply that choice.

Untouched contacts keep using their Codex settings. Choosing on or off is saved for that contact, including where it joins as a guest, across new sessions and app restarts. Off explicitly clears the tier instead of inheriting a global Fast setting. Changing a manager’s service clears the old provider’s speed choice; switching to Codex starts with Fast off. Fast mode changes no permissions, read-only restrictions or fallback spending policy.

**MCP approvals.** Buddylist’s authenticated private MCP bridge uses the app’s own action checks, so reading the brief and starting a requested coding contact do not encounter a second approval gate. External MCP tool confirmations still appear in the conversation, independently of the command permission mode. Accept approves only that call; declining or cancelling prevents it from running. Unsupported forms and URL flows are cancelled with a notice rather than accepted or opened automatically.

**Computer Use.** Codex’s Computer Use asks before each action in an app, such as “Allow Computer Use to use "Preview"?”. Its card has a third choice that names the app: **Allow Computer Use in Preview for this conversation**. The same question about the same app, from the same MCP server and the same Codex, is then accepted without a card. It is offered where the server lets a session remember the answer and names the app it is for. Another app, another server or tool, another agent and another conversation still ask, and **Accept** and **Decline** remember nothing. It lasts while that Codex session does: Stop, a reconnect, the agent leaving the conversation or quitting buddylist ends it. buddylist keeps it in memory and never asks Computer Use to remember it, as Computer Use would keep it on disk for the thread, past a restart. A read-only manager or guest is offered it too, as you approve each call there already. Its card says plainly that Codex could then click and type in that app without asking: Computer Use isn’t a file change, so the read-only sandbox doesn’t stop it. Its commands and file changes are still declined. On a phone the choice needs full access, as **Always allow** does.

Good to know:

- Messages you send while Codex works wait in a visible queue, including during `/compact` or `/review`. Each starts a turn once the one before finishes. They wait in the tray over the message box. **Send now** stops the current turn for the next queued message; **Edit** takes a queued message back into the message box, and **Cancel** drops it. Nudge, a failed turn, or a disconnected session clears the queue.
- After a stopped turn, the next message resumes the same conversation in a fresh Codex process. This clears a cancelled tool runtime that could otherwise leave later calls waiting indefinitely. The interrupted call is never replayed automatically. Process-local tool state and Codex’s session approvals reset too. Worker tools accept a `request_id`: reuse it with the same inputs to recover the original worker’s confirmation after a lost result. These attempts are kept while buddylist is running, including across provider reconnects.
- A new mode, model, effort level or Fast mode choice applies from the next message you send once Codex is done. **Never ask** also stops the asking straight away, while Codex is still working.
- **Always allow** lasts until you quit the app, start a new chat, or stop a turn.
- **Conversation > Commands** has `/compact`, `/review` and your Codex skills. `/review` looks at your uncommitted changes; say what else to look at after it (`/review the last commit`).
- A review never asks before it runs a command, and a mode you just picked only applies to it after your next message.
- Codex has no plan approval here.
- It doesn't report what a reply cost.
- The meter fills in as Codex works. Codex says how full the window is, not what fills it, and a new chat says once you've sent a message.

**In a contact's worktree** Codex trusts nothing of the folder, whatever your `config.toml` says. A worktree's branch can be someone else's pull request, and in a folder it trusts Codex starts the MCP servers in the branch's `.codex/config.toml` without asking. So a project's `.codex/config.toml` doesn't apply there. Put what you need in `~/.codex/config.toml`. Codex skips the worktree's `AGENTS.md` too, so the app reads it and passes it on.
