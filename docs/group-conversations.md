# Group conversations

A conversation doesn't have to be with one contact. Invite other contacts from the conversation window, and they all answer in it: a Claude next to a Codex or a Gemini, or two Claudes on different models.

- **The host and its guests.** The contact whose conversation it is, is the host. The contacts you invite are its guests.
- **One folder.** Everyone works in the host's folder. A guest gets a session of its own there, so the conversation you have with that contact in its own folder is not touched. A contact with a worktree of its own leaves it behind as a guest, and its own guests work in its worktree. The agents are told to stay there and make no clone or worktree of their own, also for work that goes in another pull request, so the [Changes](conversations.md#changes) tab shows everything they do; they split it into branches when they commit.
- **In turn, or all at once.** They take turns unless you switch: only one of them works at any moment, so two never change the folder at once. Or they [answer all at once](#answering-all-at-once): everyone starts together, in the same folder.

In the conversation window:

- **Invite** in the toolbar, or **Conversation > Invite...**, asks **Who should join this conversation?** Pick one and click **Invite**, or double-click it. Who can join is on four tabs, each with how many are on it:
  - **New**: a contact you don't have yet. Pick its service and click **Next**, then pick its model, its effort level where the model takes any, its nickname and **When it wants to do something**: the permission mode it joins with, such as asking first or acting without asking. Changing services offers that service's modes, starting at its default. In a manager's conversation this is locked to read-only, with **Agents join read-only here.** underneath. Model and effort lists name what **Default** comes to where the service can say, such as **Default (Opus 5.5)** or **Default (High)**; otherwise the effort's hint says it is the model's own.
  - **Roles**: the roles and teams you keep in **Settings > Roles & teams**. A role joins with its own service, model, effort and mode, and a team brings all its roles. With none yet, it says so and has **Set up roles...**, which opens **Settings > Roles & teams**. See [Roles and teams](#roles-and-teams).
  - **Your agents**: the agents you wrote as files, such as Claude Code's in `.claude/agents`. Each is tagged with whose files it is in and where, such as **Claude Code · project** or **Claude Code · personal**. See [Your agents](#your-agents).
  - **Contacts**: your contacts that work in the project's main folder and are not in the conversation yet. One joins as it is, with its name, model and mode. A contact in a worktree of its own is not listed: as a guest it would work in this conversation's folder, and leave its worktree and its conversation behind. Nor is a project's manager. With nobody there, the tab is greyed out, and says why when you point at it.
- **In a manager's conversation** everyone you invite works read-only, and Invite says so under its list: work goes to a worker. A guest there answers as part of the manager, with its tools, and starts a worker under the manager for a change you ask of it. A service that can't work read-only, such as Hermes, is greyed out on every tab, and says why. See [Project managers](project-managers.md).
- **Which tab.** Invite opens on the tab you picked last, in any conversation window, while anyone is on it. Otherwise it opens on **Roles** when you have a role or a team, and on **New** when you don't.
- **Keys.** **←** and **→** go from tab to tab, and **⌘1** to **⌘4** (**Ctrl+1** to **Ctrl+4** on Windows and Linux) straight to one. **↑** and **↓** go through the list, and **Enter** invites the one picked, or goes on to **Next**. Type to filter the tab: what you type shows in the box at the top, every word has to match, and **Backspace** takes it back. Another tab starts unfiltered. A long list scrolls inside its tab, and the dialog keeps its size from tab to tab.
- **The conversation's own.** A role, an agent of yours and a new agent are not on your contact list, and are deleted when they leave or when the host is deleted.
- **Or keep a new agent.** Tick **Also add it to my contact list** in its second step, and it is a contact like any other, in the host's folder and group. It gets no worktree of its own.
- **One name each.** A row whose name is in the conversation already is greyed out and says so: a mention could not tell the two apart.
- **In it from the start.** Ask a Claude contact to [start a conversation](started-conversations.md) with others in it, such as "a conversation for COM-631 with Codex in it". They join before its first message, as a contact you don't have yet does, so they take turns on that message.
- The ✕ on a guest's row in the list, or **Conversation > Remove from this conversation**, takes it out again. The ✕ asks first: tick **Also delete it from my contact list** there for a guest you don't need anywhere else. Its own conversation and message history are deleted with it. A guest that is not on your contact list is deleted either way.
- **Remove the host too.** The conversation's own agent has a ✕ as well, while a guest is here to take over; with nobody else here, or for a project's manager, it is greyed out and says why. Everyone stops, and the guest that answers first takes the conversation over: it answers as the contact from then on, with its own service, model, permission mode and session, so it goes on from where it was. The contact keeps its conversation, folder, worktree and name; only a nickname made up from the service's name says the new one, so "Codex (shop-2)" becomes "Claude (shop-2)". The lines of the agent that left keep its name. The guest's role, or the agent of yours it runs as, comes with it. Alone again, it is told what was said and done since it last spoke with your next message. A project's manager stays in its own conversation: switch its service instead.
- **Pause one.** The ❚❚ on an agent's row, or **Conversation > Pause in this conversation**, pauses it. It stays in the conversation and hears everything, but answers only when you mention it. Worker reports, manager messages and other agents’ mentions cannot wake it. Pausing it also stops what it is doing, as a nudge would stop that agent alone: the conversation says "Codex has been paused and stopped.", what it already wrote stays, and whoever is next in line answers. A nudge still stops everyone. Resuming it doesn't restart the turn it was stopped in. Its row says **Paused** and its buddy is greyed out. Click ▶ to resume it. It takes up from where it last spoke, so it hears what it missed. A paused agent stays paused in a new conversation, and the host is no longer paused once its last guest leaves. An agent on its own is never paused: it answers whatever you say, also after a fallback was looked for and none took over.
- **Continue workers with another service.** A manager's **Continue workers with...**, in either contact list or its **Team** menu, moves several stopped workers to another service. It reuses the same group and folder, pauses the source and continues a compatible general participant, inviting one when needed. Read-only and ask-first restrictions are preserved or narrowed. See [Continuing with another provider](accounts.md#continuing-with-another-provider).
- **Who is there.** The title bar and the **To:** line name everyone. Under the conversation, where a contact's model, effort and mode are, a button says how many agents are here, such as **3 agents**. Click it, or pick **Agents** in the side pane's **+**, for the **Agents** tab: a list of them all, each with its status, model, effort, [fast mode](conversations.md) where its model has it, and mode. A conversation with several agents opens with the tab, as does one someone just joined. Click the button again to put the tab away. The tab stays when one agent is left, and **Agents** in the side pane's **+** opens it for any conversation: an agent on its own has no grip, pause or **Replies**, and its ✕ is greyed out and says why.
- **Who is doing what.** Every line says whose it is, and the status bar says who is typing and who is waiting for you.
- **Whose context and usage.** The status bar names the agent its meters belong to. It prefers an agent at work, then one that isn't paused. Click the meters and choose **Agent** to inspect someone else; that choice stays while the agent is here and the window is open. Each agent has its own context in this conversation and its provider's account limits. **Conversation > Context and usage...** also lets you choose an agent. `/context`, `/usage`, and the **Session** tab still open the host's figures.

Who answers depends on what you send:

| You send                       | Who answers                                                          |
| ------------------------------ | -------------------------------------------------------------------- |
| a message without a mention    | everyone who isn't paused, top to bottom in the Agents tab           |
| `@Codex can you review this?`  | only the ones you mention, in the order you mention them, paused too |
| `@shop manager is this right?` | the conversation's manager, from its own conversation; nobody here   |
| `/compact`, or another command | the host alone, because slash commands belong to the host's provider |

Taking turns, they answer in that order, one after another. All at once, they all start right away.

The Agents tab lists the host first, then the guests as they joined. **Drag a row** by the grip at its start to change who answers first, or right-click it and pick **Move up** or **Move down**. With the grip focused, the up and down arrow keys move it too. The host can go below a guest: it still owns the conversation and still takes slash commands. The order is kept with the host, and the conversation says so: "Codex answers first now, then Claude." A message already waiting keeps its line; the next one goes by the new order.

In a conversation under a project's [manager](project-managers.md), `@` also names that manager, first in the list. It isn't in the conversation: it answers from its own, and its answer appears here under its name. A message that names only the manager gets no turn from anyone here, and the agents hear the manager's answer as news, which hands nobody a turn. One that also names an agent here gives that agent its turn as usual.

A mention is `@` and the contact's name, in any letter case. So two contacts with the same name can't be in one conversation. A file you send, like `@CLAUDE.md`, is not a mention.

You don't have to type the name out. Type `@` and a list of everyone in the conversation opens: pick one with the arrow keys and **Enter** or **Tab**, or with the mouse. The mentions in a message you sent are marked. In a [project manager's](project-managers.md) conversation, the list also has the conversations it oversees, after the agents: one of those is a tag, which points the manager at that conversation and decides nobody's turn.

- **They hear each other.** When its turn comes, an agent is sent what you and the others said since it last spoke, with a line for everything the others did in the folder. A guest's first turn starts with a recap of what was said before it joined.
- **Hand-offs.** An agent passes the turn on the way you do. A reply that says `@Codex please review` gives Codex a turn, unless Codex is paused. The agents are told who is paused.
- **Everyone paused.** A message that mentions nobody then gets no answer, and the conversation says so.
- **Six turns per message.** The agents take at most six turns on one message of yours, hand-offs included. Then the conversation says "Hand-offs paused after 6 turns." and waits for you. To give them more or fewer, pick another number under **Hand-offs** in **Settings > Roles & teams**.
- **A message sent while they are busy** waits in line, and the count of turns starts over. Several of them are answered one by one, in the order you sent them: each gets turns of its own, after everyone already in line, and is never folded into another one’s. One still waiting gets its turns even when hand-offs paused on the one before. Taking turns, the one that is working finishes first. All at once, only the ones it is for that are still working wait to finish. The others start right away.
- **Send now, Edit or Cancel.** Until one of them starts on it, a message that waits is in the **queued** tray over the message box, which says who it is for (_to Codex_, _to everyone_), with **Send now**, **Edit** and **Cancel**. **Send now** stops whoever is answering, and the line goes on: the next in line starts with your message. **Edit** takes it back to change: its words and pictures are in the message box again. **Cancel** drops it unsent. Either way the turns that were only for it leave the line, and whoever is answering goes on. Once one of them has started on it, it shows in the conversation where it was read.
- **Stopping.** **Stop**, in Send's place while they work, or a nudge stops everyone, and nobody still in line gets a turn. In a [manager's](project-managers.md) conversation, **Stop** on the manager's row in the Agents tab does the same. Declining a request ends the round too. Messages from a project manager wait for you then, also ones that came before: the tray says _Held since you stopped_, and they go with your next message, or one at a time with **Send now**.
- **A mode each.** Every agent has its own mode in the conversation. A guest starts with its contact's mode, and changing it here doesn't change it there. To change one, click the mode under its name in the Agents tab, or pick the agent in **Conversation > Permission mode** first. A guest of a project manager's conversation stays in the mode it works read-only in: its menu shows that mode, greyed out, and says why.
- **A model, effort level and fast mode each.** They belong to the contact: a guest answers with the ones it has in its own conversation, and changing them here changes them there. To change one, click it under the agent's name in the Agents tab, or pick the agent in **Conversation > Model**, **Conversation > Effort** or **Conversation > Fast mode** first. **Conversation > Fast mode** lists the agents whose model has it.
- **Or the agents pick their effort themselves.** See [below](#letting-the-agents-pick-their-effort).
- **An output style each.** A style belongs to its contact, like its model: a guest answers in the one you chose in its own conversation. **Conversation > Output style** here is the host's.
- **Requests** from any of them appear in the conversation. The toast says who is asking.
- **A new conversation** starts everyone over. The guests stay invited.

## Roles and teams

A role is an agent you keep to work alongside a contact, such as a reviewer that looks over every change. A team is a few roles that join together. Both are set in **Settings > Roles & teams**.

- **Or join later.** Pick a role or a team on the **Roles** tab of **Invite**. A team's role whose name is in the conversation already is said there, and the others still join.
- **A team joins a new contact.** Pick it under **Team** in **Add a Contact**. Its roles join the new conversation right away, each under its name, with its service, model and effort. They are the conversation's own, as a contact you don't have yet is. The next contact you add like that one starts with the same team.
- **What a role is told.** Its **Instructions** come after what the project tells every agent, with its name and how it answers.
- **When it answers.** **To every message** is how any guest answers. **Only when mentioned** joins paused. **After another agent changed files** waits for the others: once they are done, it gets a turn of its own if one of them wrote or edited a file since it last heard what went on. With no change, it sits the message out.
- **The review goes round.** A reviewer that mentions the agent that made a change hands it back. Once that agent changed the files again, the reviewer looks again. The turns per message still count, and stopping the round, or declining a request, ends it.
- **The mode it starts in.** **Permission** picks one of its service's modes, named as the conversation's mode badge names them. **Default** is the one it started in before a mode could be picked, and says which, such as _Default (Asks first)_. **Never ask** asks you first, as the mode badge does, and so does turning **Read only** off while it is picked, as the role then changes files without asking. The role's line ends with the mode picked, such as "· Never asks". An agent that invites the role on another service has it start in that service's own mode. You can still change the mode in the conversation.
- **Read only.** It doesn't change files, in any mode. With the default, Codex starts in **Read only**, Gemini and OpenCode in **Plan**, Claude in **Ask before acting**, and Hermes in **Ask before changing files**. Claude goes without the tools that write files, and Claude and Codex run its commands in a sandbox that writes nothing, so they can start in any mode you pick, **Never ask** included: it then runs commands that change nothing without asking you, and one that needs more is declined. Where Claude Code's sandbox can't run, such as Linux without bubblewrap, a read-only Claude in **Auto-accept file edits** or **Never ask** doesn't start, and the conversation says why: install bubblewrap, or pick a mode that asks first. One moved into either mode while it runs starts again in it before its next message, with the sandbox required. A read-only Claude also goes without the tools that make or leave a worktree, and without the tools of MCP servers other than buddylist's. Gemini and OpenCode keep from changing files only in **Plan**, and Hermes only in **Ask before changing files**, where every file change it asks for is declined: with Read only on, they start in that one whatever is picked, and the editor says so. One that can't be put in **Plan**, or leaves it, is put back in it, or stops and says why: it never goes on in another mode.
- **What reaches past the sandbox asks you.** A command a read-only agent wants typed into a terminal beside the conversation asks you first in every mode, **Never ask** included: it runs in your own shell, outside the sandbox, and the card says so. A conversation it starts waits for you to start it, even one it says you asked for, and whatever **Start the conversations Claude adds** says (see [Started conversations](started-conversations.md)). A [manager's](project-managers.md) conversation is the exception: it starts the workers you ask for, as before.
- **In the Agents tab**, a role that answers after changes, or that works read-only in a mode other than its service's read-only one, says so next to its name, and its mode badge says it stays read-only when you point at it.
- **Mentioned, it always answers**, and you can pause, resume and remove it as any guest.

The default **Reviewer** is a Claude that answers after changes, is read only, and hands back what has to change.

## Agents a manager invites

A [project's manager](project-managers.md) can invite agents into the conversations it oversees too, such as a Claude Opus reviewer for each worker. Each is a guest there, as one you invite: it is in the **Agents** tab with its model badge, you can pause or remove it, and the conversation says who invited it, such as _"tagsapp manager invited Claude (Opus 5.5) as Reviewer."_ Its row says **invited by tagsapp manager** next to what its role has it do.

- **A reviewer by default.** Without a role from **Settings > Roles & teams** it is a **Reviewer**, the conversation's own: it answers after changes, is read only, and hands back what has to change, as the default role does. A service that can't work read-only, such as Hermes, can't join as one. With a role it answers as the role says.
- **What it was asked.** The manager can give it a first message, such as what to review against which ticket. It starts on that once it has the turn, after the conversation's own agent if that one is at work, and is told it on every later turn too. It reads nothing meant for the conversation's own agent.
- **What it says reaches the manager.** Once a round is over, the manager hears what it said after the conversation's own agent, under its name.
- **The same limits.** It takes turns as any guest does, the turns per message still count, and a conversation holds up to 10 agents a manager or another agent invites.

An agent starting a conversation can ask for agents in it with a model, an effort level or a role too, as well as by service alone.

## Your agents

An agent of yours is not a role. A role is the app's: you set it in **Settings > Roles & teams**, for any service. An agent of yours is one you wrote as a file for the program a service runs in. Today those are Claude Code agents: Claude Code's own custom agents, each a Markdown file in `.claude/agents`, with its own prompt, tools and model. **Invite** lists them on its **Your agents** tab.

- **Which ones.** Invite asks Claude Code which agents it has for the conversation's folder. It lists the ones defined in the project's `.claude/agents`, also in a folder above the conversation's, tagged **Claude Code · project**, then your own in `~/.claude/agents`, tagged **Claude Code · personal**. In a worktree, the project's come from the main checkout, as the agent's settings do. Claude Code's built-in agents and the agents of plugins are not listed. An agent defined in both places is the project's.
- **It joins as a Claude.** It is the conversation's own, under the agent's name, and its session runs as that agent, with the agent's prompt, tools and model. What the app and the project tell every agent still comes on top. Only Claude can run one.
- **In the Agents tab**, it says **Claude Code agent** next to its name.
- **A file that is gone.** If the agent's file is deleted or renamed, Claude answers as itself, and the conversation says so. Put the file back and it runs as the agent again.

## Answering all at once

They take turns at first: one answers, and the next waits for it to finish. They can also answer all at once, each on a turn of its own, in the same folder.

- **Switch it** under **Replies**, at the bottom of the Agents tab: click **Take turns** or **All at once**. The line under it says what the chosen one does. Or tick **Conversation > Answer all at once**. Both are there once the conversation has a guest.
- **It is kept on the host**, for this conversation. A new conversation answers the same way. A guest's own conversation keeps its own.
- **The conversation says so.** Switching adds the line "Everyone answers at once now: each agent starts as soon as a message is for it." Switching back adds "Everyone takes turns again, one after another."
- **Everyone starts right away.** Everyone your message is for starts at once. An agent only waits for its own turn before: one that is still working starts its new turn when it finishes.
- **A hand-off to a busy agent** waits for it to finish.
- **An effort check still goes alone.** With the agents [picking their effort](#letting-the-agents-pick-their-effort), the check waits for everyone to finish, and nobody starts while it runs. Then everyone your message is for starts together.
- **Switched in the middle**, everyone in line who isn't working starts. Switched back, the ones working finish, and the rest take turns.
- **They know.** The agents are told they answer at the same time, to keep to their own part, and to leave alone the files another agent may be changing. What the others say and do reaches each of them on its next turn.
- **The rest is the same.** Pausing, mentions, the turns per message and stopping work as they do when they take turns.

## Letting the agents pick their effort

You give the goal, and the agents decide how hard each of them should think about it. **Conversation > Effort > Let the agents decide** turns it on for the conversation. A contact on its own can do the same for itself: see [Conversations](conversations.md).

| You choose            | Who picks the levels                                                    |
| --------------------- | ----------------------------------------------------------------------- |
| Off                   | you do, with the effort badges                                          |
| Whoever answers first | the first agent your message is for: the host, or the first you mention |
| an agent's name       | always that agent, also when your message is for someone else           |

- **An effort check comes first.** Before anyone answers a message of yours, the one who picks gets a short turn of its own. It replies with a level for everyone about to answer and a few words on why, like `@Claude(high) @Codex(low) The fix is small, the review is not.` You see it in the conversation, and the others read it. It then answers like the rest, if your message was for it.
- **The check is quick.** It is done on that agent's lowest level, and is not one of the turns per message.
- **A hand-over can give a level.** `@Codex(high) please review` gives Codex a turn on **High**. Without a level, it keeps the one it had.
- **The nearest level counts.** An agent given a level its model doesn't take gets the nearest one it does: **Max** is **High** for a model that stops there. Gemini, OpenCode and Hermes have no levels, so none is picked for them. They can still be the one who picks.
- **The levels stay in this conversation.** The badge in the Agents tab shows the level that was picked, and says so when you point at it. The contact keeps its own level, in its own conversation and wherever else it is a guest.
- **You can still step in.** A level you choose for an agent is its contact's own, as always, and holds here until the agents pick again.
- **Off again**, everyone answers with its own level. So does anyone you give another model. Once the last guest has left, the host goes on picking for itself.
- A slash command gets no check. A new conversation forgets the levels that were picked, and they go on picking.

A guest that leaves is stopped if it was working, and the others carry on. Deleting a contact takes it out of the conversations it was a guest in, and deletes the guests that were made for its own.

In the contact list, the host is Busy or Away while anyone in its conversation is working or waiting for you, and a line under its name says who it is with. A conversation you save keeps the name each reply was written under, also after that contact is renamed or deleted. So does the message history.
