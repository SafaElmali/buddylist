# The terminal

**Terminal** in a conversation window opens your own shell in that contact's folder, beside the conversation, as the terminal of a code editor does. It is a real terminal: `vim`, `htop`, colours and `Ctrl+C` work as they do in Terminal.

**Opening it.** Choose **View > Terminal**, **Terminal** in the side pane's **+**, or press `⌘J` (`Ctrl+J` on Linux and Windows). The menu entry stays ticked while the terminal is on show. [Settings > Shortcuts](settings.md#app) can give it, and `⌘T` below, other keys. The window grows to make room for it, as it does for a plan. The shell is the one you use in Terminal, started the same way, in the contact's folder: its worktree, if it has one.

- `⌘J` takes you to the terminal. Pressed there, it puts the terminal away and takes you back to the message box.
- The terminal is 80 columns wide where your screen has the room, and the conversation keeps its width. On a smaller screen the terminal is the one that gets narrower.
- **Wider, narrower or the whole window.** Drag the bar between the conversation and the terminal, and double-click it to put it back. The square button at the end of the tabs has the terminal fill the window, and brings the conversation back. The width you dragged to is kept until you close the window, also when it goes on to another contact.
- What you type in a terminal is the shell's. `Esc` there does not nudge your contact, and the voice clip shortcut does not record.

**More than one.** The **+** after the tabs lists what can be opened beside the conversation: choose **Terminal** there for another one. So do `⌘T` (`Ctrl+Shift+T` on Linux and Windows) and **View > New terminal**. Each is a shell of its own, in a tab of its own, next to the tabs of the plans.

- From the second on, a tab says which one it is: **Terminal 2**, **Terminal 3**. A new one takes the lowest number that is free.
- Click a tab to go to that terminal. `⌘J` goes back to the one you used last.
- **A name of your own.** Double-click a tab, or right-click it and choose **Rename...**, and type one: "dev server", "tests". Enter keeps it, Esc doesn't. Emptied, the tab says again which terminal it is.
- **Their order.** Drag a tab sideways to another place among the tabs.
- Names and order stay with the terminals: open the conversation again and they are as you left them.

**Finding in it.** `⌘F` in a terminal (`Ctrl+Shift+F` on Linux and Windows: `Ctrl+F` there is the shell's) opens **Find in terminal** over its top right. So does **Edit > Find...** while you are typing in the terminal. It finds in everything the terminal printed, its last 5,000 lines too.

- As you type, every place your text is in is marked, and the newest is chosen and scrolled to: the one nearest the prompt. **Next**, or Enter, goes to the one before it, further up. Shift+Enter comes back down.
- The box says which one you are at and how many there are, counted from the newest: _2 of 14_. Past 1,000 it says _1,000+ matches_: type more to narrow it down.
- Upper and lower case are the same to it, as in **Find in conversation**. What the terminal prints while the box is open is looked through too.
- Esc or the box's ✕ puts it away, and the marks with it. You are back in the terminal, with what was found last still selected, to copy.
- Each terminal has a box of its own: another tab shows nothing of it, and `⌘F` there again brings it back with what you typed.
- In an open file tab, `⌘F` (`Ctrl+F`) opens [Find in file](conversations.md). In **All files** or **Changes**, it goes to the tab’s search box. In the conversation it finds in the conversation. **Edit > Find in Conversation...**, also in the command palette, always searches the conversation.

**Asking for them.** A Claude contact can open terminals for you: say "open three terminals", or "a terminal for the dev server and one for the tests", and each gets a tab, with the name you gave it. With a [voice clip](voice-clips.md) that is sent as soon as you stop talking, you only have to say it. Codex, Gemini and OpenCode can't do this yet.

- **With something running in them.** "Open two terminals running claude", or "a terminal with the dev server", and the command is typed into each one once its shell is up, as you would type it.
- **You are asked first** when a command is to be run, and shown the command, as before your contact runs one itself. Terminals with nothing in them open without a question.
- **It is typed once.** Your contact can't type into a terminal afterwards, and is not told what the command prints.

**Handing its output to your contact.** Type `@` in the message box and choose a terminal from the list, or right-click the terminal, or its tab, and choose **Add to message**. A card goes in the box, and what the terminal shows when you send the message goes with it: its last 400 lines, as plain text. Select something in the terminal first, and **Add selection to message** sends only that. See [Mention a terminal](conversations.md) for the rest.

**Putting it away and closing it** are different things:

- **View > Terminal** and `⌘J` put the terminals away. Their shells run on, and come back as you left them. Collapsing the side pane hides them until you expand it again.
- The ✕ on a terminal's tab closes that terminal. Its shell ends, with what was running in it. So does typing `exit`.

**Closing the window** closes nothing. A terminal belongs to its contact, not to the window: open the conversation again and its terminals are there, with what they printed.

Good to know:

- Your contact is not told any of this, also not in a terminal it opened for you. It doesn't see what you type or what is printed, and nothing of it is kept in your message history, unless you add a terminal to a message: then that message has what it showed.
- A window that opens later shows each terminal's screen as it is by then, with its last 5,000 lines to scroll back through.
- A contact's terminals close when you delete or archive it, or change its folder. All of them close when you quit the app.
- For a dev server, [the Run button](run-button.md) is the better fit: it gives each contact a port of its own, and stops everything the command started.
- The [live demo](https://buddylist.dev/demo/) has no shell: a terminal there is a pretend one that answers a handful of commands, such as `git status`.
