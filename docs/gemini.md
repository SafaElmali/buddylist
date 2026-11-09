# Gemini

Gemini contacts run the `gemini` installed on your computer, with the same sign-in, `settings.json`, `GEMINI.md`, extensions and MCP servers.

**Set it up.** Install [Gemini CLI](https://github.com/google-gemini/gemini-cli) (0.33 or newer) and sign in:

```bash
npm install -g @google/gemini-cli   # or: brew install gemini-cli
gemini                              # choose "Sign in with Google"
```

To use an API key instead, get one from [Google AI Studio](https://aistudio.google.com/app/apikey), set `GEMINI_API_KEY`, run `gemini` and choose **Use Gemini API key**.

It isn't bundled. The app finds `gemini` on your `PATH`; set `BUDDYLIST_GEMINI_CLI` to use a different one.

**Add a contact.** Pick **Gemini** as the **Service** in **Add a Contact**.

You get the same windows as with Claude:

- streamed replies
- a line for each command, file read, file change, search and tool call
- Accept / Always allow / Decline invitations
- Nudge to stop
- conversations that pick up where they left off
- Gemini's own slash commands (`/memory`, `/init`, `/restore`, …) in **Conversation > Commands**

Gemini has its own **Permission mode** menu, under **Conversation** and in the mode badge under the conversation:

| Mode                   | Gemini asks before...                                   |
| ---------------------- | ------------------------------------------------------- |
| Ask before acting      | changing files and running commands                     |
| Auto-accept file edits | running commands                                        |
| Plan mode              | nothing: it only reads, and writes a plan               |
| Never ask              | nothing. Only use it in folders you don't mind breaking |

Good to know:

- A new mode or model applies straight away.
- In a folder Gemini doesn't trust, it stays in Ask before acting or Plan mode, and says so. It also skips that folder's `.gemini/settings.json`, `.env` and `GEMINI.md`.
- Out of the box Gemini trusts none of the contacts' worktrees, in `~/.buddylist/worktrees`. Keep it that way. A worktree's branch can be someone else's pull request, and in a folder it trusts Gemini starts the MCP servers and commands in the branch's `.gemini/settings.json` without asking. So don't trust `~/.buddylist/worktrees` or a folder above it, and don't turn folder trust off.
- **Always allow** lasts until you quit the app or start a new chat.
- A message sent while Gemini is busy waits for its turn.
- Gemini leaves Plan mode with an ordinary invitation, not plan-approval buttons.
- A mode Gemini says it switched to by itself counts only where it is stricter, or follows your **Accept** on its invitation: an approved plan, or **Always allow** for a file change.
- Its thinking isn't shown, and it doesn't report what a reply cost.
