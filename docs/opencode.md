# OpenCode

OpenCode contacts run the `opencode` installed on your computer, with the same providers, `opencode.json`, `AGENTS.md`, custom commands and MCP servers.

**Set it up.** Install [opencode](https://opencode.ai/docs) and sign in to a provider:

```bash
npm install -g opencode-ai
opencode auth login
```

It isn't bundled. The app finds `opencode` on your `PATH`; set `BUDDYLIST_OPENCODE_CLI` to use a different one.

**Add a contact.** Pick **OpenCode** as the **Service** in **Add a Contact**. Models are named `provider/model`; `opencode models` lists yours.

**Add models...** in the Model list asks your OpenCode for the models of the providers you connected, along with its free models. Tick the ones you want in the picker, or type an exact `provider/model` name. If the CLI is missing or the list cannot be read, the dialog explains what to do.

You get the same windows as with Claude:

- streamed replies
- a line for each command, file read, file change, search and tool call
- Accept / Always allow / Decline invitations
- Nudge to stop
- conversations that pick up where they left off
- your opencode commands and skills in **Conversation > Commands**

OpenCode's **Permission mode** menu, under **Conversation** and in the mode badge under the conversation, has its two built-in agents:

| Mode  | What it does                                                          |
| ----- | --------------------------------------------------------------------- |
| Build | works on the project, asking only where your opencode settings say so |
| Plan  | looks and suggests, without changing anything                         |

**Out of the box, Build doesn't ask before changing files or running commands.** To be asked, add this to `opencode.json`:

```json
{ "permission": { "edit": "ask", "bash": "ask" } }
```

Good to know:

- A new mode or model applies from your next message.
- **Always allow** lasts until you quit the app or start a new chat.
- A message sent while OpenCode is busy waits for its turn.
- Agents you defined yourself aren't in the **Permission mode** menu.
- `/undo` and `/redo` don't work here.
- It reports what each reply cost.

**In a contact's worktree** OpenCode uses your main checkout's `opencode.json` and `.opencode/` folder, not the branch's. A worktree's branch can be someone else's pull request, and OpenCode runs the plugins and MCP servers a folder sets up without asking. It still reads the worktree's `AGENTS.md`. Relative paths in `instructions` aren't found there; use `AGENTS.md` or full paths.
