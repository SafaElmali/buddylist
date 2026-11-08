# The professional look

The same app without the 2005 costume: flat panes, the system's own type, buddylist's own line icons, slate by day and ink at night, and the blue of the messenger's windows as its one colour. A new install starts in it, by day or at night as your computer is. Pick it with **Tools > Look > Professional** in the contact list, **View > Look > Professional** in a conversation, or **Settings > General > Look**. **Messenger** brings the MSN look back, and so does the welcome wizard's **Pick your look** page. An install from before there was a choice stays in the messenger until you pick this one.

The look and the [theme](msn-look.md#themes) are two settings. The professional look comes by day, at night and following your computer, like the messenger. A theme in another palette tints it: the frame, bars, sidebars and text take that palette's hue, olive-grey for Olive Green, grey for Silver, blush for Pink, and the palette's colour takes the place of the blue. Royale Noir is black and grey. Every open window changes at once, and the choice is kept.

## What changes

- **One bar along the top.** The window's buttons and its title share a row: round buttons at the left on a Mac, flat ones at the right elsewhere. The menus are in the Mac's own menu bar, and elsewhere in one **☰** where the app's icon was.
- **The toolbar is in that row too**, in a conversation: line drawings with their names next to them, in the same groups, a hairline between two. **Contacts** and **Side pane** are their drawings alone, at either end. In a narrow window the title gives way first, and pointing at a button still says what it does.
- **The conversation reads like a chat.** What you said sits on the right, in a rounded bubble, with no name or time over it: the time is in the row under it, as you point at it. An agent's reply stays on the left, by its picture, with its name and the time on a line over it, without "says:". A pinned message of yours still has its pin over the bubble, one that waits fades, and one you are editing has a blue ring. The conversation stays a comfortable width in a wide window, and what an agent does is a quiet line with a drawing in front.
- **The message box** has a microphone for voice clips, nudge and Send along its bottom edge, and with them how you write to the contact: its model and effort, then its mode (`Opus 5.5 · High · Asks first`), with the bolt of [fast mode](conversations.md) after the effort on a model that has it. Click the model for its model, effort and fast mode, or the mode to change it. While the agent works and the box is empty, Send is a soft red **Stop**. With several agents, a button such as **3 agents** is there instead, and opens the **Agents** tab in the side pane, with each one's own.
- **Accept, Always allow and Decline are buttons**, each with its key after it. What a form is for, and Send, are in the blue.
- **Your contacts and the side pane are sidebars**, with flat rows and tabs.
- **A contact's status is still its buddy**: a small flat one in green, red or amber, and only its outline when offline.

Nothing you can do changes: every button, menu, key and sound is where it was. Font colours and the emoticon picker are the messenger's own, so they are not in the professional message box: a typed code such as `:)` still makes an emoticon. What you sent in a colour before is shown in the text's own colour.

## Adding to a stylesheet

The look is the attribute `data-look="professional"` on each window's page (`src/renderer/lib/look.js`). It comes in the page's address, so the first paint has it, and changes with the settings.

- **Colours** are in `src/renderer/styles/pro-theme.css`: every role and token of `theme.css`, by day and in one block for the night. A new role in the messenger's stylesheets needs a colour there too. Each palette's are in `palettes.css`, made by `scripts/build-palettes.js`: its `slate` and `slateNight` turn the slate and ink, its `accent` and `accentNight` the one colour.
- **Everything else** is in `src/renderer/styles/pro.css`, all of it under `:root[data-look='professional']`, so the messenger never sees it. It has no night of its own: it draws with the roles.
- **Icons** keep their messenger drawings in `src/renderer/lib/icons.js`, each named with `data-icon`. `pro.css` draws buddylist's own line icon in its place, on a 16-point grid with 1.4-point lines, in the colour of the text around it. A new icon needs a drawing there.
- **What a stylesheet can't reach**, such as a terminal's colours, listens with `onLook()` from `lib/look.js`.

`test/theme.test.js` fails for a colour without a professional value by day or at night, a rule of `pro.css` outside the look, and an icon without a line drawing.
