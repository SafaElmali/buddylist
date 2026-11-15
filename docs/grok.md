# Grok

Grok contacts run the [Grok Build](https://github.com/xai-org/grok-build) `grok` installed on your computer, with the same sign-in, `config.toml`, `AGENTS.md`, skills and MCP servers.

**Set it up.** Install Grok Build and sign in:

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
grok login                     # opens your browser
```

To use an xAI API key instead, set `XAI_API_KEY`. Grok Build needs an xAI account that has it, or an API key.

It isn't bundled. The app finds `grok` on your `PATH`; set `BUDDYLIST_GROK_CLI` to use a different one.

**Add a contact.** Pick **Grok** as the **Service** in **Add a Contact**. **Add models...** in the Model list asks your Grok for its models, as `grok models` lists them.

You get the same windows as with Claude:

- streamed replies
- a line for each command, file read, file change, search and tool call
- Accept / Always allow / Decline invitations
- Nudge to stop
- conversations that pick up where they left off
- Grok's own slash commands (`/compact`, `/context`, `/memory`, …) in **Conversation > Commands**

Grok has its own **Permission mode** menu, under **Conversation** and in the mode badge under the conversation:

| Mode              | Grok asks before...                                     |
| ----------------- | ------------------------------------------------------- |
| Ask before acting | changing files and running commands                     |
| Plan mode         | running commands. It changes no files but its own plan  |
| Never ask         | nothing. Only use it in folders you don't mind breaking |

Never ask is Grok's always-approve. Each conversation starts with it on or off as its mode says, and with Grok's auto mode off, whatever your Grok settings say.

Good to know:

- A new mode or model applies straight away.
- **Always allow** is offered for file edits only, and lasts until you quit the app or start a new chat. Grok's own "always allow" for a command, an MCP tool or a website keeps it allowed in that folder for good, so buddylist never picks it: there you get **Accept** and **Decline**.
- A message sent while Grok is busy waits for its turn.
- Grok leaves Plan mode with your approval of its plan, which buddylist can't give yet. To let it start, pick **Ask before acting**.
- It can't look at pictures here, so only your words are sent.
- Its thinking and its reasoning effort aren't shown, and it doesn't report what a reply cost.
- With a **Read only** role, or as a guest in a [manager's conversation](project-managers.md), Grok works in Plan mode, and every file change or command it asks for is declined without asking you.

**Folders Grok doesn't trust.** Grok reads a folder's `AGENTS.md`, `CLAUDE.md`, `.grok/config.toml`, hooks, plugins and `.claude/settings.json` only once you trust that folder in Grok. Out of the box it trusts none of the contacts' worktrees, in `~/.buddylist/worktrees`. Keep it that way. A worktree's branch can be someone else's pull request, and in a folder it trusts Grok runs the hooks and MCP servers the branch sets up.
