# Grok

Grok contacts run the [Grok Build](https://github.com/xai-org/grok-build) `grok` installed on your computer, with the same sign-in, `config.toml`, `AGENTS.md`, skills and MCP servers.

**Set it up.** Install Grok Build and sign in:

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
grok login                     # opens your browser
```

To use an xAI API key instead, set `XAI_API_KEY`. Grok Build needs an xAI account that has it, or an API key.

It isn't bundled. The app finds `grok` on your `PATH` (your login shell’s, on a Mac or Linux); set `BUDDYLIST_GROK_CLI` to use a different one. Installed it while buddylist was open? Your next message finds it: when the program isn’t on the `PATH`, buddylist reads your `PATH` again before it gives up, as **Check again** in **Settings > Services** does.

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

**Your Claude Code settings count too.** Grok follows the hooks and allow rules in your Claude Code settings (`~/.claude/settings.json`), in every folder. So **Ask before acting** doesn't ask about a command they approve, such as one a `PreToolUse` hook allows.

Good to know:

- A new mode or model applies straight away.
- **Always allow** is offered for file edits only, and lasts until you quit the app or start a new chat. Grok's own "always allow" for a command, an MCP tool or a website keeps it allowed in that folder for good, so buddylist never picks it: there you get **Accept** and **Decline**.
- A message sent while Grok is busy waits for its turn.
- Grok leaves Plan mode with your approval of its plan, which buddylist can't give yet. To let it start, pick **Ask before acting**.
- It looks at the pictures you send, in versions of Grok Build that take them.
- Its thinking and its reasoning effort aren't shown, and it doesn't report what a reply cost.
- With a **Read only** role, as a guest in a [manager's conversation](project-managers.md), or as a manager, Grok works in Plan mode without its shell, its file tools and agents of its own. It reads, searches and looks things up, and of MCP tools it has only buddylist's own: those of your MCP servers are refused, and the ones from your Claude Code and Cursor settings aren't started. It can't run commands, so a Grok reviewer can't run your tests. A hook of buddylist's lets through only the tools it knows to read, so a tool a later Grok adds is refused too (checked against Grok Build 1.0.77). It knows buddylist's own MCP tools by their server's name, `messenger`, so an MCP server of yours with that name would get through too: give yours another name. Grok reads a folder's own MCP settings only once you trust that folder. Whatever else it asks to change is declined without asking you.

**Folders Grok doesn't trust.** Grok reads a folder's `AGENTS.md`, `CLAUDE.md`, `.grok/config.toml`, hooks, plugins and `.claude/settings.json` only once you trust that folder in Grok. Out of the box it trusts none of the contacts' worktrees, in `~/.buddylist/worktrees`. Keep it that way. A worktree's branch can be someone else's pull request, and in a folder it trusts Grok runs the hooks and MCP servers the branch sets up.
