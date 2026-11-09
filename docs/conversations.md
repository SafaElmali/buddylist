# Conversations

**The toolbar** is in groups. At its start are **Contacts**, which shows your contacts beside the conversation, **Invite**, then **Open in** and **Run** for the working folder. At its other end are the pull request's button (**Create PR**, or **View PR #12** once there is one) and **Side pane**, which collapses the [side pane](#the-side-pane-files-changes-and-checks-above-what-runs-below) to its rail and brings it back out with its tabs as they were. It stays pressed while the pane is out. **Subagents** and **Background** stand next to it, each with a count, only while subagents are at work or something runs in the background. What is in the side pane is opened from its own tabs and their **+**, the **View** menu, ⌘K or the keys, such as ⇧⌘G for Changes and ⌘J for the terminal. A [project manager's](project-managers.md) toolbar has nothing for a folder or a pull request. Files are sent with the **+** under the message box, slash commands are typed after `/` in it, the mode is its badge under the conversation, such as **Asks first**, and **Conversation > Start over** starts a new chat. In the professional look the toolbar shares one row with the title and the window's buttons.

**The menus** are named for what they are about. **Conversation** has who is in it and what they answer with, what you send them and the conversation itself; **View** the panes beside the conversation and how the window looks and sounds; **Code** the working folder, what runs there, the pull request and the project's settings. **Edit** and **Help** are as ever. In a [project manager's](project-managers.md) conversation, **Team** takes Code's place. On a Mac they are in its own menu bar, at the top of the screen, with the window in front, and **Help** there has the box that searches every menu. On Windows and Linux the messenger has them in a menu bar under the title, and the professional look in one **☰** at the start of the title bar.

**Conversation > Save conversation as...** exports a chat as Markdown.

**⌘K** on Mac or **Ctrl+K** on Windows and Linux opens the [command palette](contact-list.md#command-palette). Its keys, and those of the other shortcuts here, can be changed under [Settings > Shortcuts](settings.md#app). The palette lets you jump to another contact, find a past conversation by the words in it, open a file of the contact's folder, run an action from this window's menus or open a page of Settings. It knows other words for things too: `shell` finds the terminal, `reviewer` finds **Invite**, `PR` finds **Create PR**. To message your last viewed contact from another app, use [Quick send](contact-list.md#quick-send).

**⌘F** on Mac or **Ctrl+F** on Windows and Linux finds in the part of the window you are using: the conversation, an open file, a [terminal](terminal.md), or the search box of the **All files** or **Changes** tab. **Edit > Find...** does the same. **Edit > Find in Conversation...**, also in the command palette (⌘K / Ctrl+K), always opens conversation search. The **Search** button stays in the Messenger look; Professional keeps search in the menu, palette and keyboard. In conversation and file search, Enter goes to the next match, and Shift+Enter to the one before.

**Back to latest** appears when you scroll up from the newest line. Click it to return to the bottom. A count on it says how many new agent replies arrived while you were reading above; it clears when you reach the bottom again. While an agent is working, the button shows typing dots instead of its arrow, as more is on its way below; point at it and the arrow is back.

**↑ in the message box** brings back the messages you sent, as it does in a terminal:

- With the caret on the first line of the box, ↑ goes back one message at a time, the newest first. ↓ on its last line comes forward again, and past the newest, what you were writing is back.
- In a message of several lines, also a long one the box wraps, ↑ and ↓ move the caret between its lines as always. With Shift, ⌥ or ⌘ they select and jump as always too, and while the list of slash commands or names is open they pick from it.
- They are the messages of this conversation, also after you closed its window or restarted the app. In a [group conversation](group-conversations.md) they are yours, not the agents'. A new chat (**Conversation > Start over**, or `/clear`) starts with none: the ones before it are in [Message history](#message-history).
- Only the words come back, not a picture you sent with them.
- Change a message you brought back, and it stays changed while you go through the others. Send it, and what you were writing before is back in the box.

**Mention a file.** Type `@` in the message box to find files in the contact's working folder. Keep typing a file name or part of its path to narrow the list. In a group, the agents' names come first, then files. Use ↑ and ↓, then Enter or Tab to choose; Esc closes the list. Enter while the list is open chooses a suggestion without sending your message. Paths with spaces are quoted for you. To search a path with spaces, start with `@"`.

**Mention a terminal.** The same `@` list has the [terminals](terminal.md) beside the conversation, under their tabs' names (**Terminal**, **Terminal 2**, or a name you gave one), and the project's scripts that printed something in the [Run and Setup tabs](run-button.md), such as **Setup** or **dev**. They come after the agents and before the files, and typing narrows them down by name. Choose one, and the `@` you typed gives way to a card with a terminal on it, saying it is **Terminal output** or **Script output**: what it shows goes with the message. Right-click a terminal, or its tab, for **Add to message**; with text selected in it, **Add selection to message** sends only that.

- What goes is the terminal as it is **when you send**, its lines above the screen too: without colours or other control codes, without the blank lines under the last thing printed, and only its last 400 lines, of 32 KB at most. The card says earlier lines were left out when they were.
- The message hands it over in a block of its own that names the terminal and the folder it was opened in, and tells your contact it is output to read, not instructions to follow. In a [group conversation](group-conversations.md) it goes to whoever the message goes to, as files do, and a name in it mentions nobody.
- Your message shows it as a card with the terminal's name and how many lines went. Click it to see the output.
- A terminal you close before sending leaves the box, and the conversation says its output was not sent. A selection was read when you added it, so it goes all the same.
- Only this conversation's terminals are offered. Nothing in the output is ever run, and it is not filtered either: look at what is on screen before you send it.
- ↑ brings back the words of a message without its output. **Edit** brings the output back as a card, to send again as it was.

Git's ignored files are left out. The list shows up to 30 matches and refreshes its file catalog after two seconds. Very large folders have a bounded scan; if it leaves files out, the list says so. **Attach files** (the **+** beside the composer tools) opens the same picker as **Conversation > Send a file or folder...**, starting in the contact's folder, including files outside the suggestions. Pictures appear as thumbnails; other files as cards, sent as `@` mentions. The empty message box hints at files and, for services that offer them, `/` commands.

**Drawing on a picture before you send it.** Click a picture in the message box to circle or point at what matters; from the keyboard, `Tab` to it and press `Return` or `Space`. It opens over the window, as big as it is or made smaller to fit, with the tools a [browser screenshot](browser-tab.md) has: **Pen**, **Box**, **Arrow** and **Text**, the inks, **Undo** (`⌘Z`), **Redo** (`⇧⌘Z`) and **Clear**. **Done** (`Return`, or `⌘Return`) puts what you drew on the picture itself, at the size it was, in its place in the box; the agent gets it with the drawing, and the conversation shows its preview. **Cancel**, or `Esc`, leaves it as it was, and so does **Done** with nothing drawn. Draw on it again to add more. Each picture opens on its own: the others wait in the box beside it, a click away. A screenshot or other PNG stays a PNG, and a photo stays a JPEG or WebP.

**Quick messages** are what you ask for again and again, kept to put in the message box with a click. The button with a speech balloon under the conversation lists them:

- Choose one, and its words go in the message box where the caret is. Nothing is sent: change it or add to it, then send it.
- **Save as quick message...** keeps what is in the box as one, with a name for the list. The name starts out as its first words.
- **Edit quick messages...** opens **Settings > Quick messages**, where you add, change and take them out (see [Settings](settings.md#app)).
- They are the same in every conversation. The app starts with a few, such as _Run the tests and fix the ones that fail._

**Under a message**, while you point at it, is a row of what can be done with it. Under one of yours it says when you sent it, like _Sunday 12:20 AM_, and has **Rewind** (↶), **Edit** (✎) and **Copy**. Under a contact's reply it has **Copy**.

**Copy** copies a message as it was written: a reply as its Markdown, not as the window draws it, and yours with its quotes and the files it names. A tick says it was copied.

**Code in a reply** is in colour when its block says what language it is written in: keywords, strings, comments and names each in a colour of their own, as in the [Changes](#changes) tab. A block is coloured once it is closed, and a block too long to colour quickly stays plain.

**Pictures in a message.** The pictures you send are under your message. The ones an agent shows in its reply, such as a screenshot it writes as `![The page](/tmp/page.png)`, are where it put them in what it says:

- **Click one** to see it over the whole window: fitted to the window, then zoomed with the wheel, a pinch, a double-click, **+** and **−**, and dragged about. **1**, or the percentage button, shows actual size; **0**, or **Fit**, fits it again. **‹** and **›**, or ← and →, go through every picture in the conversation, the ones you sent and the ones in replies, in the order they were said, with a count such as _3 of 5_. **Esc** closes it.
- Sent attachments keep their original bytes separately from the small chat preview. Opening, copying or downloading one uses the original, including after reopening the conversation. Large annotated Browser screenshots keep a lossless PNG for viewing even when the agent receives a smaller JPEG. The viewer shows the available pixel dimensions. Older messages whose originals were never saved still open their preview and say **Preview only**; their missing detail cannot be recovered.
- A picture named by its path from the contact's folder, such as `![The card](shots/card.png)`, `./docs/shot.png` or `../shot.png`, is shown from that folder, and so in the message history. One that isn't there any more, or whose folder was moved, shows as a missing picture.
- A picture from outside the contact's folder, such as one in /tmp, opens too: looking at it runs nothing.
- A picture on another computer, written as `\\server\share\shot.png`, `//server/shot.png` or `file://server/shot.png`, isn't loaded: Windows would fetch it from that computer by itself and tell it who you are. It shows as a missing picture. One on the web loads as ever.
- A picture in a link goes where the link does, as a badge that links to a page. One that links to itself opens over the window.
- The pictures of a reply that is still arriving open too.

**Code in a reply.** Each code block has a **Copy** button of its own, also while its lines are still arriving, and Tab reaches it. It copies just that block's code, and says **Copied**. **Copy** under the reply copies the whole reply as Markdown.

**Diagrams in a reply.** A code block in [Mermaid](https://mermaid.js.org) (` ```mermaid `), the language agents write flowcharts, sequence diagrams, class diagrams and charts in, is drawn as the diagram it describes:

- While the reply comes in, the block is its code. It is drawn once it is closed, and only then.
- It is drawn in the colours of your look and theme, and again when you change them. It is a picture: what it says can't run anything, link anywhere or change the window.
- **Click it** to see it over the whole window, as a picture in a message opens: fitted to the window, then zoomed with the wheel, a pinch, a double-click, **+** and **−**, and dragged about. **Copy source** in the bar under it copies what it was drawn from, and so does the button in its corner, while you point at it. **Esc** closes it.
- A block that is no diagram Mermaid can read stays a code block, with a line under it that says why, such as _This diagram could not be drawn: Parse error on line 3._
- Plans, subagents' reports and the [message history](#message-history) draw them too. **Copy** under the reply copies its Markdown, the diagram's code with it.
- Mermaid is loaded the first time a reply has a diagram, so a conversation without one doesn't wait for it.

**Rewind to a message you sent.** Point at it and click **↶** under it:

- The conversation goes back to just before it, and nothing is sent: your contact forgets it and everything said after it, as `/rewind` does in a terminal. What it was doing stops, its subagents and what it left running in the background too.
- The message is in the message box again, with its pictures, ahead of what you were writing: change it and send it, or don't.
- Where your contact did something after it, such as running a command or changing a file, or is at work, you are asked first. Its files are left as they are: only the conversation goes back.
- A message that still waits to be read is taken back instead, as **Cancel** under it does, and what is going on goes on.
- It goes for the same messages as **Edit**, below.

**Edit a message you sent.** Point at it and click **✎** under it:

- The message is in the message box, with its pictures, under a line that says you are editing it. What you were writing waits until you are done, and **↑** brings back no other message meanwhile.
- **Send** it, and it takes the place of the one you sent: the conversation goes back to just before that message, and your contact forgets it and everything said after it, as `/rewind` does in a terminal. What it was doing stops, its subagents and what it left running in the background too. The lines after it fade while you edit, to show what goes.
- **Cancel**, or **Esc**, leaves the message as it was, and the box as it was before.
- Your contact's files are left as they are: only the conversation goes back.
- Editing your first message starts the conversation over with the new one.
- A message that still waits to be read is taken back instead, as **Cancel** under it does: it is in the message box again, with no line over it, and what is going on goes on.
- It is for a Claude contact on its own. Codex, Gemini, OpenCode and Hermes can't go back to a message, a slash command is no message to go back to, and with several agents in a [group conversation](group-conversations.md) the others heard it too. Nor can a message from before Claude compacted the conversation be edited: the conversation says so.
- A message sent while **Let Claude decide** picks the effort is not one either: its effort check went first.

**Fork chat from here.** Point at one of your contact's replies, and click the fork under it:

- A new contact goes on with the conversation up to and including that reply: _Claude (fork)_, in the same folder, with the same service, model, effort level, fast mode, mode, output style, picture and group. The window goes on to it.
- Its agent's conversation is copied at that reply, so the two go on apart from there. This conversation stays as it is, and so does its agent.
- Both work in the same folder, on the same files: what one changes, the other finds changed.
- Its conversation ends with a line saying where it came from. What you said before the fork can't be edited there; what you say after can.
- It is for a Claude contact on its own. Codex, Gemini, OpenCode and Hermes can't copy a conversation, and with several agents in a [group conversation](group-conversations.md) each has a conversation of its own. Nor can a reply from before Claude compacted the conversation be forked from: the conversation says so.

**How long a turn took.** Point at the last reply of a turn, and the line under it says, like _Worked for 12s_. It is kept with the conversation: it is there when the window opens again, and in [Message history](#message-history).

**Reply to part of a message.** Select words in a message, or triple-click a paragraph, and click **Reply** by them. Or right-click them and choose **Reply**, or **Copy**:

- The words are quoted in the message box, `> ` in front of each line, with the caret on a line under them for your answer. A quote can be edited like anything else you type.
- Select and reply again to answer several parts of a message, or of several messages, in one message: each quote goes under what you wrote so far.
- A selection is quoted from one message. One that runs on into the next message offers no **Reply**.
- What you send shows the quote set apart, over your answer.
- In a [group conversation](group-conversations.md), a name quoted with its `@` mentions nobody. Only the names you write yourself pick who answers.

**Reply with a picture.** Point at a picture in the conversation, such as a screenshot an agent shows in its reply, one a call of its handed back or a diagram it drew, and click **Reply** in its corner. Or right-click it and choose **Reply with this picture**, or open it over the whole window and press **Reply** in the bar under it, or `R`. From the keyboard, `Tab` to a picture's **Reply**, which shows while it has the focus, and press `Return` or `Space`:

- The picture goes in the message box after the pictures there, as it was shared and as big as it is. One you sent goes in at its original size, where the conversation kept one.
- A quote over the caret names it, such as _> Claude's picture: The cart page_: whose it is, and the words its reply gave it, or _diagram_ or _screenshot_. Write your answer under it, as under quoted words.
- Click the picture in the message box to draw on it, as above, then send it: marking it up and sending it back is two clicks.
- A picture file, such as one a reply names by its path, and a diagram go in drawn again at their full size: a JPEG or WebP stays one, anything else is a PNG, and a diagram is as sharp as the window shows it. An animated GIF file goes in as it first shows.
- It works for every agent here: the host and the guests of a [group conversation](group-conversations.md), a manager's too. Your own pictures can be replied with as well. A worker's answer reaches its manager's conversation as a line of text, without its pictures: reply to those in the worker's own conversation.
- One that can't go in says why in the conversation: a picture on the web (save it, then attach the file), one that isn't there any more, or one too big to send (5 MB max). One in the message box already isn't put in again.
- An archived contact's conversation, which is only read, has no **Reply** on its pictures.

**Pin a message.** Right-click a message, yours or a contact's, and choose **Pin message**:

- A line under the **To:** line shows the message pinned last: who said it, and how it starts. Click it to go to the message.
- With several pinned, the line says which of them it shows, like _1 of 3_. The next click goes on to the one pinned before it, and from the first back to the newest.
- A pinned message wears a pin by its name. **✕** on the line, or **Unpin message** on the message, takes the pin off.
- The pins are the conversation's: they are there when its window opens again, and after a restart. A new chat starts with none, and a conversation picked up again from [Message history](#message-history) has its own back. Rewinding to a message, or editing one, drops the pins on what was said after it, with the rest of it.
- Pinning is not hearing from the contact: the contact list sorted by **Last active** stays as it was.

**Questions.** When Claude asks you something with answers to pick from, a card says so in the conversation, like _"Claude has a question for you."_:

- A question that takes one answer has a button for each. Click one, and the card goes on to the next question, if there is one.
- A question that takes several says _Choose as many as you like._, with a box to tick beside each answer. Tick as many as fit, and untick one to take it back.
- **Or type your own answer** under them, in place of the ones on offer: what you ticked or clicked is cleared.
- **Send answer** sends it. Several questions come one at a time: **Back** and **Next**, or a click on one of the dots by them, go from one to another, and **Send answers** sends them all.
- **Skip** answers none, and Claude goes on without them. It picks for itself and says what it picked. The card, the line above it and the history say you skipped.

**Suggested replies.** Once a contact's turn is done, the empty message box shows in grey the message you would most likely send next, such as _"looks good, commit it and open a pr"_. When the reply ends by asking you something, like _"Should I commit it, or would you like to check it in the app first?"_, a few answers come up under it too, and the grey message is the first of them:

- **Tab** writes the grey message into the box, to change or send. It is not sent until you send it. **Esc** puts it away for that reply.
- Tab is only for it while the box is empty. With words in the box, or the `@` and `/` list open, Tab does what it always does. A screen reader hears it as "Suggestion: … Press Tab to use it."
- Click an answer under the reply and it is sent, as if you had typed it. The one the reply says it would pick, if it says, comes first.
- The grey message goes as soon as you type, paste or attach anything. Everything offered goes once you send anything, once the contact starts on something of its own, or once a guest joins. A window you open while they are there has them too, also after you quit and open buddylist again: they are kept with the end of the turn, and a line that comes after it, such as a command the agent left running that ends later, leaves them there.
- None come while a message you sent as it worked waits to be read: that is your answer already.
- The contact's quickest model writes them from the end of the reply, with one question a turn, on the account in use. Claude and Codex contacts have them. Codex asks the small model your Codex account lists, or the conversation's model when it lists none. Gemini, OpenCode and Hermes contacts get none, and nor does a [group conversation](group-conversations.md), where a reply can be for another agent.
- **Settings > Conversations > Suggest replies** turns them off.

**The model badge** under the conversation says which model a contact answers with and, once you choose a level, how hard it thinks before it does: `Opus 5.5 · High`. Click it for **Model...**, **Effort** and **Fast mode**, the same entries as the **Conversation** menu:

- **Model...** opens the same list as [**Add a Contact**](contact-list.md): search it, type any other model, or choose which models it offers with **Add models...**. The list is what the service says it offers, asked again now and then while buddylist runs, so a model that comes out appears without a restart. On a model with no effort levels and no fast mode, the badge opens the list straight away.
- **Default** leaves the model to your own settings for that service. The list names what that comes to, such as **Default (Opus 5.5)**, once the service or a message of yours has shown it. Claude reads the account and folder's settings, including the project's settings in the main checkout when the contact works in a worktree.
- An effort level goes with the model. A model that takes none has no **Effort** entry, and switching to a model that doesn't take the level you chose goes to that model's own.
- Until you choose a level, the badge only names the model: the model uses its own level. **Default**, first in the **Effort** menu, is checked meanwhile, naming the level it comes to where the service says, such as **Default (High)** for Claude or Codex. Where it can't say, the hint explains that it is the model's own. Choose it to give the level back to the model after you picked one.
- Gemini, OpenCode and Hermes say which models they have once you have sent a message, and they are all listed. They have no effort levels.
- **⚡ Fast mode** turns Claude's fast mode on and off: faster answers from the same model, at a higher price. While it is on, an amber bolt follows the model on the badge.
  - It is there only for a model that has fast mode, which is Opus today. On another model the contact answers at its usual speed, and fast again once it is back on one that has it.
  - When something keeps fast mode from working, the bolt is faint, and pointing at the badge says why: a pause after a rate limit, usage credits that are off, a plan without it, or your organization having turned it off. Claude answers at its usual speed meanwhile.
  - Turning it on or off says so in the conversation: _Fast mode changed: On._
- The app remembers all of them for the contact. Nothing is written to your Claude Code or Codex settings.
- A contact keeps them as a guest. In a [group conversation](group-conversations.md) each agent has its own badges, under its name in the **Agents** tab.
- **Or let the contact decide.** Tick **Let Claude decide** at the bottom of the effort menu, and it picks its own level for every message you send:
  - First it replies with a level and a few words on why, like `@Claude(high) The export touches invoices.` That check is done on its lowest level, so it is quick. Then it answers on the level it picked.
  - The badge shows that level, and says it was picked when you point at it. The level you chose yourself stays the contact's own: untick the entry and it is back on it.
  - A level you choose while it is ticked holds until your next message. A slash command gets no check.
  - What you send while it is answering waits for that answer, and then gets a check of its own.
  - In a group conversation the agents [pick levels for each other](group-conversations.md#letting-the-agents-pick-their-effort) the same way.

While a contact works, the last line of the conversation says what it is doing right now and for how long, like _"Claude is thinking 0:12"_:

- It is there for the whole of its turn, also between its tool calls: _thinking_ while it reads what came back and decides what to do next, _writing schema.rb_ while it writes out a long file before the call that saves it, _running npm test_, _typing a message_.
- The status bar says the same, like _"Claude is thinking..."_, and so does the contact's line in the contact list.
- It goes under the contact's to-do list, where it has one. In a group conversation each agent at work has a line of its own.

When an agent stops with unfinished to-dos, **Continue with...** on its checklist lets you choose another agent in the conversation. [Invite](group-conversations.md) one first if the agent is alone. The button sends only the chosen agent the remaining items, including which were in progress, and asks it to inspect existing changes, verify what is already complete, and keep its own checklist. The original checklist stays with its agent.

If an agent's tool loses track of its checklist, so that the agent can't tick off a step any more, the checklist says it may be out of date, and shows no step as in progress. Handing it over sends the unfinished steps as to-dos.

**Send turns into Stop** while a contact works, as long as the message box is empty:

- Click **Stop** to stop what the contact is doing. The button is a greyed-out **Send** again, and the caret is back in the box.
- Start typing and it is **Send** again, for a message that waits for the contact (below). Empty the box and it is **Stop** again.
- **Enter** on an empty box does nothing, so it never stops anything by accident. **Esc** pressed twice, which nudges, and **Conversation > Stop Claude** (**Stop everyone** in a group conversation) stop it too.
- **One Esc stops nothing.** The status bar says _Press Esc again to stop Claude._ (_…to stop everyone._ in a group conversation) for two seconds, and a second **Esc** in that time stops it. Holding the key down counts once. An **Esc** that closes a menu or a dialog, calls an edit off or drops a voice clip does only that, and the next one is a first again.

**A message you send while a contact works** waits for it in the **queued** tray over the message box, until the contact reads it. The tray lists every message that waits, oldest first, each on one line with its pictures, files and, in a [group conversation](group-conversations.md), who it is for. Click a line to read all of it, or point at it. Three lines show at once, and more scroll, so the message box stays where it is. Once the contact reads a message, it leaves the tray and shows in the conversation where it was read, under what the contact did meanwhile, and stays there when you open the conversation again. The tray is gone once nothing waits, and is back as it was after a reload. A screen reader hears _Message queued._ when one of yours starts to wait.

- Claude reads it at its next step, between two tool calls, or once its turn is over. Gemini, OpenCode and Hermes read it once their turn is over. Codex reads it as you send it, so nothing waits there.
- **Send now** on its line stops what the contact is doing, a command it is running too, and the contact reads your message right away. The turn it stopped says _Stopped._, like one you nudged.
- Messages that wait for the same turn each have a line, and **Send now** on any of them stops that turn.
- Several messages that wait are answered one by one, in the order you sent them, each in a turn of its own, never together. In a [group conversation](group-conversations.md) too.
- If the contact doesn't take the message, **Send now** is there again, with a line that says why. Trying again keeps that message and the rest of the queue as they were.
- A [manager's](project-managers.md) note that waits has a line in the tray too, apart from your messages: **Send now** on one of yours, or the next of yours in line, never sends the manager's in its place. In a group conversation you stopped, the tray says the notes are held, and what lets them go (see [Group conversations](group-conversations.md)).
- Queued controls follow the message's identity, including requests sent from toolbar buttons. They clear when the turn takes that message. A manager note's **Send now** also recovers if its interruption fails or times out; retrying keeps one copy, and cancelling removes only that note.
- **Edit** takes it back before Claude reads it, to change: it leaves the tray, and its words and pictures are in the message box again, ahead of what you were writing. Send it and it waits again, last in line. What Claude is doing goes on.
- **Cancel** drops it before Claude reads it: it leaves the tray and is never sent. A manager's note has **Cancel** but no **Edit**.
- If Claude has read it by then, it stays where it is: **Cancel** says _That message is no longer queued._, and **Edit** edits it as it would any message you sent.
- **Edit** and **Cancel** go for the same messages as **Edit** above, and for every message that waits in a [group conversation](group-conversations.md). Other messages that wait have **Send now** only.
- **Stop**, or a nudge, stops the turn without reading anything: Claude still reads what waited once it has stopped, and Gemini, OpenCode and Hermes drop it.

The tool calls a contact makes one after another fold into one line:

- It says what they came to, like _"Claude ran 3 commands, read 2 files and edited a file"_. A call still going on is counted once it is over: the line under the newest one says what it is.
- A subagent's steps are the subagent's: _"A subagent is reading cart.js"_ while it works, with how long that step has taken, and _"Claude asked 2 subagents"_ once it is done. Its steps are under the line, indented.
- Click it for the line of each call, with its **Show output** or **Show changes** link. Under it a command reads as why it was run, where the agent said why; point at it for the command itself.
- A single call is its own line, as before. A to-do list always is.
- **Pictures** a call handed back, such as a screenshot, are under its line, and all of them are in a row under the folded line while its calls are put away. Click one to see it over the whole window, as a picture in a message opens, to zoom in on and drag about. **‹** and **›**, or ← and →, go through the others in its row, with a count such as _2 of 8_, and from the last back to the first. **Esc** closes it.
- A message, a request for permission or the end of a turn starts a new line. So does another agent's call in a group conversation.
- Searching in [Message history](#message-history) or with **Find in conversation** opens the lines your text is in.

**View > Show activity lines** shows or hides the lines for what a contact does, like _"Claude ran `npm test`"_ and a helper's own, indented under it:

- Unticked, a conversation shows the messages only. Questions, plans and requests for permission still come up.
- The lines are kept: tick it again and they are back, each with its **Show output** or **Show changes** link.
- The status bar still says what a contact is doing while it works.
- It goes for every conversation window, and the app remembers it. [Message history](#message-history) always shows them.

**Conversation > Output style** changes how Claude writes its replies, for that contact only:

- A contact you haven't chosen a style for uses the one in your Claude Code settings.
- A new style applies from your next message, and the contact keeps it when you reopen the app.
- The app remembers the choice itself. Nothing is written to your Claude Code settings or your project's `.claude` folder.
- Styles you wrote yourself are listed once you have sent a message. A project's own come from its main checkout, as its other Claude Code settings do (see [The contact list](contact-list.md)).
- Codex, Gemini, OpenCode and Hermes have no output styles, so their **Conversation** menu has no such entry.
- A contact keeps its style as a guest: invited into a [group conversation](group-conversations.md), it answers in the same one.

**Keep a window on top.** The pin by the window's buttons keeps it in front of other apps' windows, as **View > Always on top** does. It stays pressed in while it does; click it again to let the window go. The contact list has one too, and **Tools > Always on top** there.

## Your contacts beside the conversation

A conversation window lists your contacts on its left, so one window is enough to go from one conversation to the next:

- **Click a contact** and the window shows its conversation instead. What it was doing goes on: its agent keeps working, and its terminals and what Run started keep running.
- The list is [the contact list](contact-list.md), laid out the way you left that one: by project unless you grouped it another way, sorted the same, with **Waiting for you** on top. The **...** over it groups and sorts it another way, and the contact list follows. Every project is in it, also when the contact list is narrowed down to one or has [a project hidden](contact-list.md). **Archived** is at the bottom, folded until you click it. Click an archived contact to [read its conversation](#an-archived-contacts-conversation) in this window, or right-click it for **Restore contact**.
- **The row you are in** is marked. A contact with something you have not seen yet is in bold, with the count on its buddy.
- A pull request's tags are their pictures alone until you drag the list wider. Point at them, or at the contact, for the rest.
- **Another contact on a project.** Point at a project and click the **+** at the end of its line, as in the contact list. In a git repository the new contact gets [a worktree of its own](contact-list.md), on a new branch that is named already: press Enter. Its conversation is then shown in this window.
- **Over the list**, the contact list's own rows: **New contact**, **History**, **Search** and **Spending**, as [in the contact list](contact-list.md). A contact added there is shown in this window.
- **A project that has no contact yet.** Click **Add project** under the list for the same three ways as the contact list's **Add project**: a folder on your computer, a repository on GitHub, or a new one with **Quick start**. Then add the contact that works on it, and its conversation is shown in this window.
- **Right-click a contact** for **Open in a new window**, which gives it a window of its own, **View message history...**, **New contact in this project...**, **Rename...**, **Pin to top**, **Add to favorites**, **Archive contact** and **Delete contact**. Pinning and favorites are [the contact list's](contact-list.md), and both lists show them. Archiving puts the contact under **Archived**, where it can be restored in either list. Deleting asks first, as in the contact list, and can take the contact's worktree along. Archive or delete the contact whose conversation is in this window and the window closes. A [project manager](project-managers.md) also has **Manager settings...**, which opens its own page in Settings.
- **Right-click a project** for [the contact list's menu of a project](contact-list.md): a new contact in it or from an issue or pull request, **Project settings...**, **Project instructions...**, **Pin project** to list it before the others, here and in the contact list, **Archive contacts**, **Delete contacts...** and **Remove project...**. **Hide project** is left out, as this list shows every project. A project with nobody on it any more is listed here too, until **Remove project...**.
- A conversation is in one window at most. Click a contact whose conversation is open in another window, and that window comes to the front.
- **Click a toast** and the conversation window you were in last goes on to that conversation the same way.

What you typed and did not send stays with its contact, with the pictures and files you added to it: they are in the message box again when you come back. So are the answers you chose to questions you have not sent yet, on the question you were on.

**The conversation is where you left it.** Scrolled up to read, you come back to the same place, also when more was said in the meantime: the button over the message box goes down to the newest messages and counts the replies you have not seen yet. Left at the newest messages, it follows them as new ones come. The runs of steps you opened, and the output or changes you showed under a step, are open again.

The side pane is as you left it with each contact: the same tabs in the same order, on the same tab in each half, with the lower half folded or the pane filling the window if it was. Its terminals and what Run started ran on, and a web page opens again at its address, without the pages before it to go back to. A pane you left with no tabs stays empty. Inside its tabs:

- **Changes** lists the commit you chose, with the same files open, previewed or marked as viewed, the same folders of its tree put away, and the list scrolled to the file you were reading. A file you viewed that changed since is to be viewed again, and says so.
- **All files** has the same folders open, scrolled as far, and the tab of a file you opened is scrolled where you were, as text if you unticked Preview.
- In the other tabs, what they showed inside them starts over.

This goes for as long as the app runs, also when the contact's conversation opens in another window or in a new one after you closed its window. What you did not send is the window's own, and closing the window forgets it. A contact no window has shown yet starts at its newest messages, as a new window shows it. The pane keeps the width you dragged it to, and stays collapsed if you collapsed it.

**Contacts** in the toolbar hides the list and shows it again. So do **View > Show contacts beside the conversation** and ⇧⌘L (Ctrl+Shift+L on Windows and Linux). The window stays where it is and as wide as it is: hiding the list gives its room to the conversation, and showing it takes the room back. Drag the bar between the two to make the list wider or narrower, and the conversation gets narrower or wider for it; double-click the bar to put it back. A new conversation window opens wide enough for the list beside a conversation of the usual width. Both go for every conversation window, and the app remembers them.

### An archived contact's conversation

Archiving the contact you are reading keeps this window open in the same archived state. Other conversations stay open and keep working. Closing a chat tab with its **✕** still goes on to the next tab; **File > Close** or the window's close button still closes the window.

Click an archived contact, here or in the contact list, and its conversation opens as any other does, to be read:

- **A yellow line over it** says the contact is archived. **Restore** there brings the contact back, and the conversation goes on in the same window, with its message box. **All its conversations…** opens its [message history](#message-history), with the conversations before this one.
- **Nothing in it starts anything.** There is no message box, and no model or mode badges, chat tabs or terminal. The toolbar has no **Invite**, **Run** or pull request button, and its messages have no **Rewind**, **Edit**, **Fork**, **Reply** or pins. The **Conversation** menu has **Restore contact**, **Save conversation as...** and the message history.
- **The side pane can still be read**: its files, what it changed, its checks, its session and what was shared.
- **Nothing about the contact changes until you restore it.** Its agent doesn't start, nothing is saved for it, and it doesn't become the conversation [Quick send](contact-list.md#quick-send) goes back to.

## Chat tabs

More than one chat can work in the same folder, each in a tab over the conversation, as tabs in a web browser do.

- **Open one** with the **+** after the tabs. It lists every service: pick the one the new chat talks to. The service of the chat you are in is first, and **⇧⌘A** (Ctrl+Shift+A on Linux and Windows) or **Conversation > New chat tab** opens one of it straight away.
- **A new tab is a contact of its own**, with its own conversation, agent and history, called after its service: _Claude 2_, _Codex_. Of the same service, it answers with the same model, effort level, mode and output style as the tab it was opened from. Of another, as that service does to begin with.
- **The tabs share the folder**: no worktree is made. What one chat changes, the others find changed, as with a forked chat.
- **Click a tab** to show its chat. What the others were doing goes on, and the window goes on to the tab you picked as it does to a contact picked [from the list beside it](#your-contacts-beside-the-conversation). **⌃Tab** goes to the next tab, and **⌃⇧Tab** to the one before. Each tab keeps what you typed and did not send, and its own side pane, as you left it.
- **A tab says how its chat is doing**: its buddy turns busy while the agent works and away while it waits for you, and a chat with something you have not seen yet is in bold, with the count.
- **✕ on a tab**, or the middle button, archives its chat, as **Archive contact** does: you are asked first if it is working or waiting for you. **Restore contact** in the contact list brings it back, with its tab. The last tab has no ✕.
- **In the contact list** the tabs are listed under the first of them, joined to it by a line, as [started conversations](started-conversations.md) are. Right-click one there to rename it, or open it in a window of its own: that window has the same tabs.
- Deleting the first tab leaves the others together, under the next of them.
- **A [project manager](project-managers.md) has no tabs**: it is one conversation. Its window has no **+**, no **New chat tab** and no ⇧⌘A. Its model badge switches its service instead.

## Plans

In plan mode, Claude writes a plan and waits for your answer before it changes anything. The plan opens in a pane beside the conversation, and the window grows to make room for it.

- **Each plan has a tab.** Approve it, or choose **No, keep planning** and say what should change, under the plan itself.
- **The conversation keeps one line about it**, with a **View plan** link that opens the plan again. The link is still there after you close and reopen the window.
- **View > Plans** lists every plan of the conversation and how you answered it, and opens the one you choose.
- **A plan you sent back** gives its tab to the next one from the same agent. A plan you approved keeps its tab while the agent works.
- **Closing the last tab** closes the pane, and the window goes back to its size.
- **A plan kept in a file** gets a tab too. When an agent writes or edits a Markdown file named for a plan, like `COM-630-plan.md`, `PLAN.md` or one in a `plans` folder, its line in the conversation has a **View plan** link. A run of calls that is folded away shows the plan under its line, so you don't have to open the run to find it. The tab shows the file as a document, as it reads now, and it updates as the agent revises it. There is nothing to answer under it: reply in the conversation. **View > Plans** lists it with the others.

Codex, Gemini, OpenCode and Hermes have no plans to approve, so nothing opens for them.

## Changes

The **Changes** tab shows what a contact's folder holds that the project's main line doesn't: the commits its branch made, and every file that differs, committed or not. It is in the same pane beside the conversation, and works for every contact, whichever service it uses.

To open it, choose **View > Changes**, press ⇧⌘G (Ctrl+Shift+G on Windows and Linux), or click the **+** after the pane's last tab. The pane opens for it even when no plan is open.

- **Commits** lists the commits the branch made since it left the main line (`origin/main`, or whatever the remote's main branch is), the newest first, each with its short name, who made it and how long ago. Click one to list only the files that commit changed. **All changes**, above them, goes back to everything. **Uncommitted changes**, under it, lists only what changed since the last commit: what you staged, what you didn't, and the files git doesn't keep yet, with how many files that is. Click the **Commits** heading to put the list away. In a narrow pane the commits stand under the top line; in a wide one, under the files. A branch with no commits of its own shows the list as soon as it has files to commit, with **All changes** and **Uncommitted changes** holding the same files; with nothing to commit either, there is no list.
- **Filter changed files**, the box under the top line, keeps the files whose name or folder has what you type, its letters in order with anything between them, so `rtcl` finds `retry/client.js`. The rows and **Files** keep only those, each in its group, and the box counts them, such as **3 of 27**. **Commits** keeps the commits whose message, short name or author has every word you type, or that changed a file the box keeps. **All changes** and **Uncommitted changes** always stay. ↓ and ↑ go through the files it kept and Enter opens one, as a click on it in **Files** does. **Esc** empties the box and lists every file again; a second **Esc** leaves the box. ⌘F (Ctrl+F) in the tab goes to it.
- **A row for every changed file**, with the lines it gained and lost: changed, new, deleted and renamed files, and files git could not merge. **All changes** compares the folder as it is with where the branch left the main line: what was committed since, what you staged, what you didn't, and the files git doesn't keep yet. Every file of a new folder has its own row. Without commits of its own, or without a remote, the folder is compared with the last commit, which is what `git status` lists.
  - Its icon says what the file is written in, such as Ruby, TypeScript or a Dockerfile, and pointing at it says what became of the file. The name says so in colour: green for new, amber for changed, red and struck through for deleted, blue for renamed, violet for in conflict.
- **Click a row** to see the file's diff under it, as `git diff` prints it. A new file's diff is the whole file. Several can be open at once.
  - The code is in the colours of its file's language, on the green of an added line and the red of a removed one. A comment or string that runs over several lines is coloured on each of them. A file with a line longer than 1,000 characters, such as a minified one, stays plain.
  - Every line has its number in the file: a removed line its number in the old file, any other its number in the new one. Copying lines leaves the numbers and the + and − behind.
  - In a line that changed, the words that changed are marked, and so are the words they took the place of in the removed line. Lines with too little in common to be one line changed are not marked.
  - The unchanged lines git leaves out between the changes are one line, such as **33 unmodified lines**, with what git says they lead into, like the function the next change is in. Click it to show them. The file is read the first time you do, as it is in the folder, or as it was in the commit you chose. **Show the rest of the file**, after the last change, is there when the file may go on past it. A file longer than the All files tab shows (300 KB) can't show what lies past that, and a file that changed since its diff was drawn gets its new diff instead. What you opened closes again when the file's diff changes.
- **Files** shows the same files as a tree, folder by folder, each with its icon and the lines it gained and lost. A folder that holds nothing but another folder shares its line, as in `src/renderer`. Click a file to open its diff and scroll to it, and a folder to put what is in it away. In a narrow pane the files stand above the rows; drag the pane wider than about 560 pixels and they stand beside them, with the commits under them. There, drag the edge between the files and the rows to make the files wider or narrower, and the top edge of the commits to give them more or less of the column. What you drag them to is kept for every conversation window, and a double-click on an edge puts it back. Click the **Files** heading to put them away and give the rows all the room.
- **Right-click a file**, in **Files** or on the head of its row, for what can be done with it. **Add to message** puts it in the message box, as **Attach files** does. **Copy** copies its **Path** in the repository, its **Full path** or its **Name**. **Open file** opens it in the app your computer opens such files with, and **Show in Finder** shows it in its folder (**Show in File Explorer** on Windows, **Show in folder** on Linux). A deleted file is no longer in the folder, so it can only be copied.
- **⋮**, at the end of the top line, says how the changes are shown. What you choose there is kept for every conversation window.
  - **Show files** shows the files, or puts them away, as their heading does. **Group files by folder** lists them as a tree; turned off, they are one list, each file with its folder after its name. **Separate test, build, and generated files** lists the tests, then lockfiles, built and minified files, generated code and a dumped database schema, each under a heading of its own after the rest, beside the rows and among them. Each heading says how many files are under it.
  - **Collapse all files** and **Expand all files** close or open the diff of every file at once.
  - **Side by side** shows the old lines on the left and the new ones on the right, each with its number in its file, a removed line beside the one that took its place. Each side's lines can be commented on. **Word wrap**, on at first, wraps long lines; turned off, a diff scrolls sideways and what is said under a line stays in sight. **Highlight changed words** marks the words that changed in a line. **Hide whitespace changes** leaves out the lines whose only change is white space, as `git diff -w` does; a file whose only changes were those says so.
  - **Refresh** looks at the folder again.
- **Click a line** of a diff to comment on it. To comment on several lines, drag a line's **+** (or its number) over the others, or Shift-click another line while you type the comment: the lines are highlighted, and the comment stands under the last of them. **Send now** (⌘Enter) says it in the conversation right away. **Add comment** (Enter) keeps it under its line instead, and the bar under the list sends every comment you kept as one message with **Send all**. A message names each comment's file and lines and quotes them. A kept comment can still be sent on its own, edited or deleted, and it stays with its line while the file changes around it.
- **What reviewers said on GitHub** stands under the lines it is about, under **All changes**, while the branch has a pull request that is still to be merged: who wrote it, which lines, the comment and its replies. **Send to chat** says the thread in the conversation, with its file, its lines, everyone's words and its link. ▲ and ▼ go to the previous and the next thread that is still to be resolved, opening its file where it has to. The arrow at the end opens the thread on GitHub. A resolved thread is one line until you click it. A thread whose line has changed since is tagged **Outdated** and stands above its file's diff, with the lines it was written under, and one on a file the list does not have stands above the list. The balloon at the top of the tab, and on a file's row, counts the threads still to be resolved. **Reply** opens a box under the thread; its **Reply** button, or ⌘Enter, posts what you typed on GitHub as you, and Esc puts the box away. **Resolve** marks the thread as resolved on GitHub, and **Unresolve**, on a resolved thread you opened, takes that back. If you have a review of your own on the pull request that is not submitted yet, GitHub adds the reply to it, and the reply is tagged **Pending** until you submit that review on GitHub. These two, and **Re-run failed** under **Checks**, are what the side pane writes to GitHub, each when you click for it, with the [GitHub CLI](https://cli.github.com) and its sign-in; what GitHub refuses is said in the thread.
- **Preview**, on the row of a Markdown file, shows the file as a document, as it reads now, in place of its diff: in the folder, or in the commit you chose. Untick it to see the diff again, with the comments on its lines. A deleted file has no Preview.
- **Viewed**, at the end of a row, marks a file as looked at, as on GitHub: the file is put away and the top of the tab counts how many you have viewed. When a viewed file changes again, the mark comes off by itself and **Viewed** turns amber. The marks last as long as the conversation window is open, and each commit keeps its own.
- **It looks again** when a turn ends, when you go to the tab and when you choose **Refresh**. It never polls. The files you opened stay open, each with its newest diff.
- **A very large diff** is cut off after 2,000 lines, with a note under it. A list of more than 500 files, or of more than 100 commits, says how many more there are.
- **A contact working in a subfolder** sees its whole repository, as its [contact card](contact-list.md) counts it. The card counts a new folder once; the tab lists the files in it. The card counts only what is not committed, so the tab can list more.
- **A folder that is not a git repository** says so in the tab. So does a folder that is gone, a missing `git` and one that takes longer than ten seconds, each with a **Try again** link.

The tab only reads the folder. It doesn't stage, commit or undo anything, and it leaves git's own files alone, so it never gets in the way of the agent's git commands.

The **+** lists every kind of tab the pane can open, each with its shortcut, and under them the conversation's plans. So far those are [**Terminal**](terminal.md), which opens another one, **Changes**, and for a Claude contact [**Subagents**](subagents.md) and [**Background**](background.md).

## The side pane: files, changes and checks above, what runs below

The pane beside a conversation has two halves, each with tabs of its own.

- **On top** is what there is to look at: **All files**, **Changes**, **Checks**, **Session**, **Shared**, a plan, a [web page](browser-tab.md), the [subagents](subagents.md), what runs in the [background](background.md), and beside a [project's manager](project-managers.md) its **Team** and **Brief**. The **+** after its tabs opens any of them.
- **Below** is what runs in the contact's folder: **Setup**, **Run** and the [terminals](terminal.md). It has a **+** of its own, and the arrow in front of its tabs folds it away, down to the tabs. Going to one of them brings it back.
- Every conversation opens with **All files**, **Changes** and **Checks**, and one that nothing was said in yet with all six. See [The Run button](run-button.md) for **Setup** and **Run**. A project's manager changes no files, so its window opens with **Team** in front of **All files**, and nothing below. A contact on [This computer](contact-list.md#this-computer) works on no project, so its window opens with **All files** alone: what its agent made in its folder. It has no **Changes** or **Checks** to open, and no **Run** or **Create PR** over its conversation, which says **&lt;This computer&gt;** where another says its folder.
- The pane is always there, also with every tab closed. The arrows at the end of its bar collapse it to a thin rail at the window's side, and the window gets narrower. The arrows, or a click on the rail, expand it again with its tabs as they were. Opening a tab, from the toolbar or the **+**, expands it too. It stays collapsed in that window when you go on to another conversation.
- A half with more tabs than it has room for gets arrows at the ends of its row. Each click brings the next tab that is cut off into sight, and a trackpad scrolls the row too. The [chat tabs](#chat-tabs) over the conversation have them as well.
- **Pin a tab** with the pin beside its name, or **Pin tab** in its right-click menu. It stays available when a newer plan replaces a draft or a shortcut puts other tabs away. **Unpin tab** lets it behave as usual again. Pinning does not select the tab or expand a collapsed pane.
- Pinned tabs come first in their half, in the order you pinned them. Pinning a tab moves it to the front, after the tabs pinned before it, and scrolls it into sight; unpinning moves it to just after the pinned ones. Below, a pinned terminal goes in front of **Setup** and **Run** the same way. Dragging keeps a tab on its own side of the pinned ones: dragged among them, an unpinned tab lands just after them.
- Pins are saved for **this conversation on this device**, in their order, including after you close its window or restart the app. Pins saved by an earlier version come back first too, in the order they had. Other conversations keep their own tabs. Ordinary unpinned tabs are remembered only while the app runs. A pin whose content is no longer available says so; unpin it to remove it. A pinned terminal does not start a new shell after a restart.
- Archiving leaves pinned files and saved-file plans open to read. Pinned **Setup**, **Run** and terminals become unavailable, with nothing left to run. **Restore** brings Setup and Run back; ended terminals stay unavailable until you unpin them.
- **Keyboard:** Tab reaches each tab and its pin button; Enter or Space selects a tab or toggles its pin. Left/Right, Home and End move between tabs in the same half. Delete, the middle button, or **Close** in the menu explicitly closes a tab and removes its pin. Setup and Run stay with their half as before.

**All files** shows the contact's folder as a tree, each folder with an arrow that says whether it is open and each file with the picture of what it is written in, as in **Changes**. Click a folder to open it, and a file to read it in a tab of its own: line by line, each with its number, in the colours of its language, as a diff is drawn. A link to a text file of the folder in a reply, such as `[create.rb](app/services/create.rb)`, opens it in a tab like this too. Right-click the link for what a right-click on the file here offers, such as **Open file** in the app your computer opens it with.

- **Search files**, the box over the tree, finds a file anywhere in the folder, also in folders you haven't opened, by its name or the folders it is in. Type the letters of it in order, with anything between them: `cnvjs` finds `conversations.js`. A file whose name has them comes before one that needs its folders too, and letters next to one another, or starting a word, before letters strewn about. Each file is listed with its name in bold, its folder after it and the letters found marked. ↓ and ↑ go through them, and Enter or a click opens one, as a click in the tree does. **Esc** empties the box and brings the tree back as you left it, its folders open as they were; a second **Esc** leaves the box. ⌘F (Ctrl+F) in the tab goes to it.
  - In a git repository it searches the files git keeps and the new ones it doesn't ignore, as `git ls-files` lists them. In another folder it searches everything but `node_modules`, `.venv` and `.git`. Only the first 20,000 files of a folder are searched, and the tab says so when it has more. It shows the best 200 and counts the rest. It looks at file names, not at what the files say.
- The folder is only ever read. A file is shown as text, a long one up to its first 300 KB, and one that is not text says so.
- A Markdown file opens as a document, its headings, lists, tables and code drawn as they would be in a reply. Untick **Preview** above it to read its text instead.
- **Find in file:** with focus or the last pointer interaction in an open file tab, press **⌘F** (Mac) or **Ctrl+F** (Windows/Linux). A compact bar shows the query and match count. Enter / ↓ goes forward, Shift+Enter / ↑ goes back, wrapping at either end; **Aa** matches case. **Esc** closes it and returns focus to the code. Syntax colours and line wrapping stay intact. Finding in a Markdown file switches to its source text.
- Find searches literal text, including punctuation, within the portion of the file shown. Large files wait briefly while you type; at most the first **2,000 matches** are highlighted and navigable, with a note when there are more. Narrow the query to find later matches. Changes uses a separate diff view and does not have this in-file find bar.
- What git keeps for itself in `.git` is left out. Everything else is there, also what git ignores.
- Going back to the tab reads the folder again, and going back to a file reads the file again: your contact may have changed it.

**Checks** lists the checks of the pull request of the contact's branch under a heading for how they stand: **Failed** and **Running** open, **Passed**, **Skipped** and **Cancelled** folded away to a count until you click them. A folder left on no branch, as an agent leaves it with `git checkout origin/main` once its pull request is merged, has the checks of the pull request it had, as the contact list does. A heading you open or fold stays so while the tab is open. Over them, a line counts them and a bar shows their shares in red, amber and green. A check's name opens its page on GitHub. Under a failed one run by GitHub Actions is why, in GitHub's words: the step that failed and the errors it reported, such as a test command that ended with an error, or a job GitHub never started. **Re-run failed**, there while one has failed, starts the failed jobs over on GitHub with the ones that waited on them, as GitHub's own **Re-run failed jobs** does for each workflow run, and the list shows them running. GitHub only re-runs a workflow run once all of it is done, so while every failed check's run still has a check going, the button is greyed out and the line under it says which workflow it waits for. What GitHub refuses is said on that line too, and the counts stay.

- It asks GitHub when you open it, when you go back to it, after each turn of your contact, when you press its ↻ button, and every 30 seconds while a check is running and the tab is on show.
- A branch without a pull request says so. It needs the `gh` CLI, signed in, as the pull request tags in the contact list do.
- **Send to chat** on a failed check sends its name, reported errors and GitHub link in the conversation, asking the agent to fix it. With two or more failed checks, **Send all to chat** sends them together in one message. The rows say **Sent** afterwards. In a group conversation, the message mentions the agent whose branch it is.

**Session** says where your contact works, and with what, at a glance. **View > Session info** opens it too.

- **Environment**: the [account](accounts.md) it answers in, its folder and the branch there, with a **Worktree** tag when the folder is a worktree made for it. Click the account to switch to another, and the folder to open it.
- **Context**: how much of its context window is in use. Click it for what is in the window, as the meter in the status bar shows it.
- **MCP servers**: the ones that need you, or else how many work. Click it for the list, to reconnect one, sign in to it, or turn it off or back on. Its search finds a server by name, address, where it is set up or status, such as "sign-in".
- It asks again when you go back to it, and the branch after each turn of your contact. In a [group conversation](group-conversations.md) it is all the host's, whose folder it is.
- What a service can't tell about is left out: a Codex contact shows its folder, branch and context.

**Shared** lists what was shared in the conversation, on a card for each kind: **Pull requests and issues**, **Links**, **Files** and **Pictures**. **View > What was shared** opens it too.

- It has the links in the messages, yours and your contacts', the files an agent linked by their path and the ones you sent, and the pictures you sent. Each is there once, as it was shared the last time, with who shared it and when, the newest first.
- Click one to go to the message it was shared in. The button at the end of its row opens it, as a click on it in the conversation does: a page beside the conversation or in your browser, a text file in a tab beside the conversation and any other file in the app your computer opens it with, a picture over the window. Right-click a page for the rest of what a link offers.
- It changes as the conversation goes on. A reply still arriving is listed once it is all there.
- **Pull requests show their status**, with the same tags as the contact list: **Merged**, **Conflict**, failing checks, **Running**, **Passed**, **Closed**, **Open** or **Draft**. This includes pull requests from other repositories. The tab asks the signed-in GitHub CLI when shown or brought to the front, keeping an answer for a minute and a merged status for the rest of that window. If GitHub cannot be reached, the last known status stays. Clicking the row still goes to its message; its **Open** button goes to the pull request.

## Open the folder in another app

The **Open in** button in the toolbar opens the contact's folder in your editor. It wears the icon of the app it opens the folder in, and pointing at it says which. In the **Code** menu, **Open in** and that app's name, such as **Open in Cursor**, does the same, and **Code > Open in** lists the apps to pick from.

- **Its ▼** lists the apps on your computer that can open a folder: editors (Cursor, VS Code, Windsurf, Zed, Sublime Text, Xcode and the JetBrains IDEs), terminals (Terminal, iTerm, Ghostty and Warp), Finder, and **GitHub**. Pick one to open the folder there. The button stays on it, in every conversation window, until you pick another.
- **Before you pick one**, it opens the first editor there is, and without one the system's file manager: Finder on Mac, File Explorer on Windows, or Files on Linux.
- **GitHub** opens the branch's pull request, or else the branch once it is pushed, or else the repository. It is listed when the folder's `origin` is on GitHub, and the button never stays on it.
- **Copy path** and **Copy branch name**, at the bottom, copy the folder's path and the name of the branch it is on. They are in **Code** and in a contact's right-click menu too.
- On Linux an editor is found by its command, such as `cursor`, `code` or `zed`, and the folder opens in your file manager. Terminals are listed on a Mac only.
- On Windows, File Explorer is available. Editor discovery and opening editors through `.cmd` launchers still need Windows support; open the folder in your editor directly in the meantime.

## Create PR

To read the current PR’s parents and dependents beside the chat, choose **View PR stack...** from its button’s menu or **Code**, or **PR stack** from **View** or the side pane’s **+**. The current PR is highlighted, and uncertain relationships are labelled. You can pin this read-only tab across visits and restarts. See [PR stacks](pull-request-stacks.md).

The **Create PR** button in the toolbar gets the work on a contact's branch into a pull request. Its **▼** has two more ways to one. A contact on [This computer](contact-list.md#this-computer) has no repository, so it has no **Create PR**.

- **Create PR** asks the contact for it, in the conversation: to commit what is not committed yet, push the branch and open the pull request with `gh pr create`, with a title and a description. On the project's main branch, or on a branch whose pull request is already merged, it is asked to start a new branch for the work first. You see the message as if you had typed it, and the contact asks before it runs anything, as its mode says.
- **Create draft PR** asks for the same, as a draft.
- **Create PR manually** opens GitHub's own page for a new pull request in your browser, for the branch the folder is on. The branch has to be pushed already. If it isn't, or the folder is on the project's main branch, the conversation says so instead.
- **Once the branch has a pull request** the button turns into **View PR #12** and opens it on GitHub. A mark on its drawing says how the checks stand: red while one fails, amber while they run, green once they have all passed. Its tooltip says it in words. GitHub is asked again after a turn that was asked for a pull request, and whenever the window comes back to the front.
- **Its ▼** then has **Show checks**, or **Show failed checks**, which opens the Checks tab beside the conversation with the failing ones first, **Auto-merge**, ticked while it is on, and **Archive once merged**, below. With **Auto-merge** on, GitHub merges the pull request by itself once what it requires has passed, squashed if the repository allows it, otherwise with a merge commit, otherwise rebased. Nothing is merged there and then.
  - **Where its base branch requires no checks or reviews**, GitHub has nothing to wait for, so buddylist merges it itself: at once if its checks have already passed, or it has none, and otherwise as soon as they all pass. It merges only the commit whose checks it saw pass, and waits again after a push. Checks that fail keep it waiting for the next push, as GitHub would, and a toast says when it merged, or why it could not. This is kept with the contact, so it carries on after a restart, but nothing is merged while the app is closed: the first look once it is open again catches up. **Auto-merge** stays ticked until then, and unticking it stops it.
  - **Where GitHub won't wait for other reasons**, the conversation says why: the repository does not allow auto-merge, it is a draft, or it is part of a stack.
  - **Archive once merged**, last in the **▼**, puts the contact away once buddylist sees the pull request merged, as **Archive** next to the **Merged** tag does. It starts out ticked or not as **Archive contacts once their pull request is merged** in [Settings](settings.md#every-project) says, and ticking or unticking it makes it this contact's own choice from then on, whatever that setting says later. A contact that is working or waiting for you finishes first.
- **Once it is merged or closed** the button stays on it, as **PR #12 · Merged** or **PR #12 · Closed**, with the tag the contact's row wears, and still opens it on GitHub. **Create PR**, **Create draft PR** and **Create PR manually** move into its **▼**, for a second pull request on the same branch. Once **Continue** has put the folder on a new branch, which has no pull request yet, the button is **Create PR** again.
- **Fix conflicts** appears in the "To:" line while the pull request has conflicts with its base branch, after what the line says. It asks the contact, in the conversation, to merge the latest base branch into its branch, resolve every conflict, run the tests of the files it touched, and commit and push the merge without rewriting the branch's history, then to say which files conflicted and how it resolved them. **Fix conflicts** in the **▼** does the same. Once GitHub sees the conflicts are gone, the button goes too.
- **Continue** appears in the toolbar, next to the pull request's button, after a pull request that is merged or closed, for going on with the same contact. **Start new branch** in the **▼** does the same. The folder moves to a new branch, started from the project's main branch as the remote has it now. The conversation says what the branch is called, and the next thing you ask for names it. The branch it leaves is kept. See [pull request tags](contact-list.md) for when it is refused.
- **With several agents in the conversation** the message mentions the host, so only one of them opens a pull request.
- **Code** in the menu bar lists the same entries.

The app itself commits, pushes and opens nothing: the contact is the one that does. **Start new branch** is the one thing it does in the folder itself, and it only fetches the main branch and checks out a new one.

## Message history

Starting a new conversation doesn't throw the old one away. It moves to the contact's message history, which keeps the 50 most recent.

To open it, right-click a contact and choose **View message history**, or use **Conversation > View message history...** in a conversation window. Over [an archived contact's conversation](#an-archived-contacts-conversation), **All its conversations…** opens it too.

- **The list** shows the current conversation, then the past ones, newest first. Each has its date and your first message.
- **The search box** narrows the list to the conversations that have every word you typed, anywhere in them and in any order, and marks each word in the transcript. Put words in quotes to find them side by side: `"stripe idempotency"`. It looks through your messages, the replies and the activity lines. To look through every contact's conversations at once, use [the search box of the contact list](contact-list.md), or [every contact's message history](#every-contacts-message-history).
- **Continue** picks the conversation up again in its conversation window: its agent goes on from where it left off, and the current conversation moves to the message history. One about another folder can only go on there, and one saved before conversations could be continued can only be read.
- **Why a button is greyed out** is said in a line over the list, not only when you point at it: why the conversation picked can't be continued, or can't be deleted from here.
- **Save as...** exports a conversation as Markdown.
- **Delete** removes the selected conversation after asking first. For an archived contact, its current conversation can be deleted too, here or with **Conversation > Delete conversation...** in its read-only chat. **Delete all** includes it. Restore then starts a fresh conversation, with none of the deleted session to resume. For a live contact, the current conversation stays until you start a new one. Conversations deleted here stay out of **From Claude Code**; the agent’s own files are left alone.

Deleting a contact deletes its history too. Archiving a contact keeps its history: restore the contact to continue one of its conversations.

### Every contact's message history

**Contacts > View all message history...** in the contact list, or **Conversation > View all message history...** in a conversation window, lists the conversations of all your contacts in one window, archived contacts' too.

- **The list** has them under the day each was last added to: Today, Yesterday, This week, This month and Earlier. Each row has your first message and how long ago it was last added to, then whose conversation it is, its project and the branch its folder is on now.
- **From Claude Code** and **From Codex**, under them, have [the conversations you had with Claude Code or Codex outside the app](#conversations-from-your-terminal), by the folder each was held in: also of folders no contact works in yet, so they are there from the first day.
- **Search history** narrows the list to the conversations that have every word you typed, each in what was said or in the conversation's first message, contact, project or branch. Words in quotes are found side by side. Under **From Claude Code** and **From Codex** it finds them by their title, first message, project or branch; a contact's own message history also looks through what was said in them. The [command palette](contact-list.md#command-palette) opens this window searching for what you typed when nothing else matches it.
- Pick one to read it. **Continue**, **Save as...** and **Delete** work as in a contact's message history. **Delete all** is only there.

### Conversations from your terminal

The local conversations you had with Claude Code or Codex outside the app, in a terminal, desktop app or editor, are in the app from the first day, before you add a contact.

**In every contact's message history.** Click **History** over the contact list. Under your contacts' conversations, **From Claude Code** and **From Codex** list them by the folder each was held in, the one last added to first.

- Each has the title its agent keeps, or else your first message. Under it are the branch it was on and what you asked first.
- Pick one to read it. Nothing is copied: Claude Code reads its own files under `~/.claude/projects`, and Codex reads its threads through the installed CLI's app server. Each section lists the 500 newest external conversations. Archived Codex threads, helper threads, buddylist sessions and disposable suggestion threads are left out.
- **A folder a contact of that service works in** names that contact, and **Continue** goes on with the conversation there.
- **A folder no contact works in** has **Add a contact here**, which opens Add a Contact with the folder filled in. For a conversation of that folder, the line over the list also offers **Continue in a new contact there**: see below.
- **A folder that is gone**, such as a deleted worktree's, says so. Its conversations can only be read.
- The app's own conversations are not among them: the copies **Continue** made are listed with the contact that went on with them.

**In a contact's message history.** A Codex contact lists the Codex conversations held in its exact folder. A Claude contact also lists those of other worktrees of the same repository, as `/resume` does.

- Each is marked **Claude Code** or **Codex**, with its branch, and stands in the list by the day it started, among the app's own. The list has the 100 newest.
- The search box looks through what was said in them, and **Save as...** saves one.

**Continuing one.** A conversation goes on only in the folder it was held in. **Continue** copies it through Claude Code's fork or Codex's `thread/fork`, and the contact goes on with the copy. The original stays as it was; Codex never resumes the original for this action.

- One held in another folder than the contact's, such as the main folder of a contact in a worktree, says so over the list. **Continue in a new contact there** makes a contact of the same service that works in that folder itself, not in a worktree of its own, and continues the conversation with it. It asks first: what that contact changes, it changes in that folder.
- **Delete** and **Delete all** leave them alone: they are their agent's to keep. Claude Code removes its own after a month unless your settings say otherwise. The line over the list says so.

**What is shown.** What you typed is shown as yours. Replies, commands, file changes and tool activity use the same display as a contact's conversation. Internal reasoning and agent reminders are left out. A very long one shows its newest 2,000 lines.

**When they can't be read**, such as when `~/.claude/projects` can't be opened or the Codex CLI is missing or too old, the window says so, with what went wrong, instead of listing none. A conversation that can't be opened says why in place of its transcript.

The contact list's search and the palette (⌘K) look through the conversations held in the app only. Gemini, OpenCode and Hermes contacts list the ones held in the app.
