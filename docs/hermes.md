# Hermes

Hermes contacts run the `hermes` installed on your computer, with the same providers, `config.yaml`, `SOUL.md`, memories, skills and MCP servers.

**Set it up.** Install [Hermes Agent](https://hermes-agent.nousresearch.com) and choose a provider:

```bash
hermes model
```

It isn't bundled. The app finds `hermes` on your `PATH`; set `BUDDYLIST_HERMES_CLI` to use a different one. If Hermes says its ACP dependencies aren't installed, install them the way its message says.

**Add a contact.** Pick **Hermes** as the **Service** in **Add a Contact**. Models are named `provider:model`. After your first message the model menu lists the ones from the providers you're signed in to.

You get the same windows as with Claude:

- streamed replies
- a line for each command, file read, file change, search and tool call
- Accept / Always allow / Decline invitations
- Nudge to stop
- conversations that pick up where they left off
- its to-do list
- Hermes's own slash commands (`/tools`, `/context`, `/compress`, …) in **Conversation > Commands**

Hermes's **Permission mode** menu, under **Conversation** and in the mode badge under the conversation, decides what it asks before changing a file:

| Mode                                  | Hermes asks before changing...                                       |
| ------------------------------------- | -------------------------------------------------------------------- |
| Ask before changing files             | any file                                                             |
| Auto-accept file edits in this folder | a file outside the folder, or a sensitive one (`.env`, `.git`, keys) |
| Accept every file edit                | a sensitive file                                                     |

**In every mode Hermes runs commands without asking, unless it finds one dangerous**, like `rm -rf` or `git reset --hard`. Only give it folders you don't mind it changing.

Good to know:

- **Always allow** is for that kind of command, until you quit the app or start a new chat. buddylist never picks Hermes's own "Allow always", which keeps a command allowed in every folder from then on.
- A file edit can only be allowed once. To stop being asked, pick an Auto-accept mode.
- Hermes waits a minute for your answer to an invitation. After that it goes on as if you had declined.
- A message sent while Hermes is busy waits for its turn.
- Its thinking isn't shown, and it doesn't report what a reply cost.
- With a **Read only** role in a [group conversation](group-conversations.md), Hermes starts in Ask before changing files, and every file change it asks for is declined without asking you. It is told to run only commands that change nothing, but nothing stops one it doesn't find dangerous.

**In a contact's worktree** Hermes reads the branch's `.hermes.md`, `AGENTS.md` or `CLAUDE.md`, as it would in your main checkout. It doesn't run the plugins in the branch's `.hermes/plugins`, even with `HERMES_ENABLE_PROJECT_PLUGINS` set: a worktree's branch can be someone else's pull request. For the same reason, don't add `~/.buddylist/worktrees`, or a folder above it, to `skills.trusted_project_dirs` in your Hermes settings.
