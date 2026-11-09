# Started conversations

An agent can start another conversation, for work that should go on apart from its own: "start a new conversation for the promo film", or a side task it comes across while it works. The new conversation is a contact of its own, listed under the one that started it, and that one hears from it as it works.

**Asking for one.** Say it the way you would to a person. The conversation says _"Claude started a conversation: Update the promo film's roster…"_, and the new contact gets to work at once. Its window doesn't open: double-click it in the list to look in.

**Asking a manager to fix something.** A project's [manager](project-managers.md) changes no files, so work you ask of it goes to a worker. Say "fix this", or yes to work it proposed, and it starts a separate conversation for it at once, in a worktree of its own: you don't need to ask for a new conversation or name a tool. The worker answers as the manager's **New workers use** says. Its service's own subagents share the manager's read-only limits, so the work goes to a worker instead.

**One it thinks of itself** is drafted, and waits for you. It is in your list with its first message in its message box, unsent, and the line says _"Claude added a conversation for you to start"_. Nothing runs, and nothing spends usage, until you start it. It never starts by itself. To have it start at once too, turn on **Settings > Conversations > Start the conversations Claude adds**: the line then says _"Claude started a conversation"_. It works in the mode of the conversation that added it, so in one that asks nothing first it changes files without you looking in.

**Starting a draft, or deleting it.** A draft says it waits wherever it shows:

- **In the contact list**, its row says _Waiting to start_ in the colour of what waits for you, and its buddy wears a play mark. So does its row in the list beside a conversation, and in a manager's [Team tab](project-managers.md), where it is under **Needs you**.
- **In its own conversation**, which starts with _"shop manager drafted this conversation."_, a box over the message box says _"shop manager drafted this. Send to start it, or delete it."_ **Start** sends what is in the message box, as **Send** does: the draft, or what you made of it. A box you emptied gets the draft back first. **Delete…** asks first, as Delete contact does, and its worktree goes with it. One with uncommitted changes, such as files its setup script made, is named in the question, and they go only once you press **Delete** again.
- **In the conversation that drafted it**, a card under the line says who it is and _Waiting to start_, with **Start**. Click its name to show it in that window. Start there starts it as Start over its box does: when it is open in a window of its own, that window sends what is in its box; otherwise its draft goes as it was written. Once it has started, or been deleted or archived, the card says so.
- **On your phone**, its row says _Waiting to start_, and its conversation has the same box, with **Start** and **Delete…** for a phone with full access (see [Remote access](remote-access.md)).

Starting it is sending its first message: its session starts, the conversation that drafted it hears its first reply, and it is counted as a message sent.

**What it is.** A contact like one you add, with the service, model, effort level and permission mode of the agent that started it, in the parent conversation's project and group. If Codex takes over in a Claude conversation after a usage limit, workers it starts use Codex too. A guest passes on its permission mode in that conversation, even when its own contact has broader permissions elsewhere. One a project's [manager](project-managers.md) starts is as the manager's **New workers use** says instead: unless you choose otherwise, the service of the contact you added last yourself, with the model and effort level Settings > New contacts picks for it or else that contact's, in the mode New contacts picks or else the service's own, unless the manager's **Permission mode** says otherwise.

- It works in a worktree of its own, on a new branch, and its project's setup script gets the worktree ready, as for any new contact.
- The branch is named after what it is to do, and so is the contact: "Claude (update-promo-roster)".
- The branch starts from the project's main line, or from the branch of the conversation that started it when that one asks. Only what is committed there comes along.
- Its conversation starts with a line saying who started it, or drafted it for you. Its agent knows nothing else of that conversation: its first message says everything it needs.

**With other agents in it.** Ask for them by name: "start a conversation for COM-631 with Codex in it". They join before its first message, as **Invite** has an agent join, so it is a [group conversation](group-conversations.md) from the start and they take turns on that message. Each is that conversation's own, with its service's default model and mode, and isn't on your contact list. The answer says who is in it, and one that couldn't join says why in the new conversation. A [project manager](project-managers.md) can do this too: "start a worker for the bulk tags ticket, with Codex to review".

**In the contact list** it is right under the one that started it, joined to it by a line. That one shows how many are under it, at the end of its row. The ones those start are listed under it too, on the same level. A conversation that is in another section than the one that started it is listed there like any other contact: one that is waiting for you, a favorite, offline or archived, or one left out by a search.

A conversation a project's [manager](project-managers.md) starts is under that manager, and one started by a conversation under a manager is under the same manager. Under a manager at work, every conversation under it is listed, on one level: the ones it started, the ones its workers started, and the ones you put under it. Each one that was started says by whom, such as _started by shop manager_, when its row has nothing else to say, and its card says it too.

Click the arrow before the contact's buddy, or that count, to fold away the conversations under the contact, and click again to bring them back. Tab reaches the arrow, and with the contact selected, **Left** folds and **Right** unfolds. This works in the contact list and the list beside a conversation, and what you folded stays folded across reloads and restarts. Folding only hides the rows; their agents keep working, and a conversation in another section stays visible.

**Hearing back.** When it has a reply to pass on, the conversation that started it says so in a line: _"Claude (update-promo-roster) finished a turn: The roster is updated…"_. Its agent is sent what was said, so it can tell you, or decide what comes next. If it has nothing useful to add, it can end silently; only the usual time and cost line remains.

- It hears of the turn that answers the first message, the task it was started with, whether that went at once or you pressed **Send**. And of each turn the new conversation takes on its own, as when a check-in is due or something it left running in the background ends.
- A turn you start in the new conversation's window, by writing to it there, is not passed on: you saw the answer. A message you send while it is at work leaves the turn it is in as it was, and where it waits for a turn of its own, that turn is yours.
- A turn that says just what the last one passed on said is not passed on again, as with "CI is still running".
- Progress replies wait while commands or watchers are still running in the background. Only the latest reply is held. A later reply replaces it; an empty later turn keeps it. If the background work ends without another turn, the held reply is passed on then. The first turn, questions, approval requests and turns that change files do not wait.
- One that is at work, or waiting for you, reads it once it is done. Several that came in meanwhile are read together, the newest from each.
- A turn that was stopped or went wrong is passed on with its outcome, without waiting for background work.
- A conversation hears from the ones it started, and no further: what one says only to pass a note on doesn't go up to the one that started it.
- A [project manager](project-managers.md) hears once the round of turns is over instead, and once: where it is told of the round's changed files, that note has what was said too. Once the conversation is put under another manager, the one that started it hears no more of it: the manager it is under does.

Good to know:

- The two can't send each other anything else. To tell the new one something, open it and say it.
- In a [group conversation](group-conversations.md), what any agent starts is listed under the contact whose conversation it is, and that contact's agent hears back.
- An archived contact hears nothing while it is archived. A deleted one leaves the conversations it started in the list, on their own.
- Claude, Codex, Gemini, OpenCode and Hermes can start one using the app's tools.
- In demo mode, say "new conversation": the contact starts one for a side task, and passes on what came of it a few seconds later. Say "new conversation with Codex" for one with Codex in it.
