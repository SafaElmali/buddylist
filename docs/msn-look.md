# The MSN look

- a Luna-blue title bar and, on Windows and Linux, a menu bar under it: File, Contacts, Actions, Tools and Help in the contact list, Conversation, Edit, View, Code (Team for a [project manager](project-managers.md)) and Help in a conversation. On a Mac the menus are in its own menu bar
- XP scrollbars
- a big glossy toolbar
- display pictures
- font colors
- the classic message, nudge and sign-in sounds

Claude's display picture is its spark logo. Click the picture in **Edit contact...** and pick the Claude Code mascot if you prefer it.

## Themes

A new install starts in [the professional look](professional-look.md). For this one, pick **Messenger** on the welcome wizard's **Pick your look** page, or **Tools > Look > Messenger** in the contact list, or **View > Look > Messenger** in a conversation. An install from before there was a choice stays in it.

**Tools > Theme** in the contact list, **View > Theme** in a conversation, or a picture of each under **Theme** in [Settings > General](settings.md#app), has Luna's blue three ways:

- **Light** is Luna as it always was.
- **Dark** is Luna at night: the title bar keeps its blue, and the panes, bars, dialogs and scrollbars under it go navy. It matches the Terminal tab, which was dark already.
- **Match system** follows your computer's appearance, and changes with it. It is what a new install starts with.

And XP's other colour schemes, each by day and at night:

- **Olive Green** and **Olive Green Dark**: an olive title bar over khaki, and dark olive at night.
- **Silver** and **Silver Dark**: a pale silver title bar with dark writing, and graphite at night.
- **Royale** and **Royale Noir**: Media Center's deeper blue by day, and black at night.
- **Pink** and **Pink Dark**: a pink title bar over blush, and plum at night.

Every open window changes at once, and the choice is kept. In the [professional look](professional-look.md) a palette tints the slate and ink, and gives its colour to what is selected and Send. The colour you write in was picked to be read on white, so at night it is shown lighter: black as near-white, navy as a pale blue. A web page in the [Browser tab](browser-tab.md) is shown in the same colour scheme as the app, as a browser would show it.

### Adding to a stylesheet

A colour that should change at night is written as the default of a role, and `src/renderer/styles/theme.css` gives the role its night colour:

```css
.me-name {
  color: var(--text-strong, #10244a); /* by day; --text-strong is set for the night only */
}
```

- **By day** the colour is the one written there. Nothing in `theme.css` has to change for it.
- **At night** every role is set in the one `@media (prefers-color-scheme: dark)` block of `theme.css`. The app shows its windows in the colour scheme of the theme (`nativeTheme.themeSource`), so no window runs code for it. The browser preview switches that rule on and off instead, in `preview/bridge.js`.
- **A colour that stays** is written plainly: white text on a blue selection, the title bar, a picture's own background.

`test/theme.test.js` fails for a role without a night colour, and for a night colour nothing uses.

### The palettes

Olive Green, Silver, Royale and Pink are Luna's own colours turned to their hue: `scripts/build-palettes.js` reads `theme.css`, `pro-theme.css` and the role defaults of the stylesheets, and writes `src/renderer/styles/palettes.css`. Each window is marked with the palette of its theme (`data-palette`, see `src/renderer/lib/look.js`), and the palette gives the roles its colours, by day and at night. Only blues turn: greys, the XP beige, and the colours that say what something is (a link, a status, a plan's violet) stay.

- **A new colour** in `theme.css` or a stylesheet needs nothing by hand: run `node scripts/build-palettes.js` and commit what it writes. `test/theme.test.js` fails while `palettes.css` is not what the script makes.
- **A colour that stays** but is the window's blue, such as the title bar, is a token by day in `theme.css` (`--titlebar-bg`), so that a palette can turn it.
- **A palette's own colours**, such as Silver's dark title text, are picked by hand in `PALETTES` at the top of the script.
- **The pictures in Settings > General**, a close-up of a conversation in each theme and each look, are stills of the browser preview in `src/renderer/settings/pictures/`. Each is a small part of the window at about half its size, so its colours read at a glance: the messenger's title bar and toolbar, and in the professional look, Claude asking to edit a file, with the theme's Accept button. A look's is the corner of the window, by day and at night. Take them again with `node scripts/make-theme-pictures.js` after a change to a palette or to how a conversation looks. It has no npm script, as a change to `package.json` runs the installer builds on a pull request.
