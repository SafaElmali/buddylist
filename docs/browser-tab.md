# The browser

A **Browser** tab in a conversation window shows a web page beside the conversation: the dev server your contact just started, or a page it linked to. You look at the page and keep talking, without switching to another app.

**Opening it.** There are three ways in:

- **View > Browser** or `⇧⌘B` (`Ctrl+Shift+B` on Linux and Windows, or the keys you gave it under [Settings > Shortcuts](settings.md#app)). So does the **+** after the side pane's tabs, then **Browser**.
- **A link in the conversation.** Right-click it and choose **Open beside the conversation**. This works for the link of [the Run button](run-button.md) too.
- A click on a link opens it in your own browser. Turn on **Open links beside the conversation**, in the page's **⋯** menu or in Settings > Conversations, and a click opens it here instead. A right-click offers both either way. A link to a file of the contact's folder is not a page: a text file, such as `[app.js:12](src/app.js:12)`, opens in a tab beside the conversation, as a click on it in **All files** does. Any other file, such as a recording `[video](/path/to/proof.mp4)`, opens in the app your computer opens it with, as **Open file** in **All files** does. A link that names a file from the top of the disk opens it even outside the contact's folder, such as the screenshots an agent keeps in `/tmp`. Outside the folder, a link to something that runs code, such as an app, a script, an installer or a file allowed to run, is not opened: a dialog says why.

**The address bar** takes what you would type in a browser, and a little less:

- `localhost:3000`, or just the port: `3000`.
- `example.com`. A site is asked over https, and a server on your computer or your network over http.
- Only web pages. A file, or anything that is not an address, is refused and the tab says so. The exception is a file you opened with **Open HTML file...**, below, and the files in its folder.

**Around the page.** Back, forward and reload are in the bar. While a page loads, reload is stop. The **⋯** at the end has the rest.

- The tab is called what the page is called.
- A dev server that reloads the page when a file changes does so here too. For one that doesn't, press reload after your contact changed something.
- A server that isn't running yet gets a line saying so, with **Try again**.

**The ⋯ menu:**

- **Open in Arc** opens the page in your own browser, called by its name. **Copy URL** puts its address on the clipboard.
- **Open HTML file...** shows a page of yours from your computer, in this tab. Its links go on to the files in its folder, and to web pages.
- **Viewport** draws the page at the size of a **Phone** (375 × 812), a **Tablet** (768 × 1024) or a **Desktop** (1280 × 800), made smaller to fit the tab. **Responsive** fills the tab again. At a phone's or tablet's size the page is told it has a touch screen and runs on Android, and loads again so that it sees so. Each page keeps its own size until its tab is closed.
- **Show dev server logs** goes to the **Run** tab, with what [the Run button](run-button.md) started prints.
- **Open links beside the conversation**, as above.
- **Clear browsing data** forgets every site's cookies, storage and cache, after asking. Every page beside every conversation is signed out.

**Showing your contact what you see.** The camera in the bar, **Take a screenshot to draw on**, takes a screenshot of the page as it is drawn, and puts it in the page's place to draw notes on:

- **Pen** draws freehand, **Box** draws a box around something, **Arrow** points at it, and **Text** puts a few words where you click. Enter, or a click anywhere else, puts the words down. `Esc` drops them.
- Red to begin with. Yellow, green, blue, black and white are next to it. Words have an edge in black or white, so they can be read on any page.
- **Undo** (`⌘Z`, `Ctrl+Z` on Linux and Windows) takes the last note back, and **Redo** (`⇧⌘Z`, `Ctrl+Y` on Linux and Windows) puts it back again. **Clear** takes them all off, and **Undo** brings them back.
- **Add to message** (`Return`, or `⌘Return`) puts the screenshot, with its notes, in the message box as a picture, as a pasted one goes in. Write what you want done beside it and send it, or take it out again with its ✕. Nothing is sent before you send it.
- **Cancel**, or `Esc`, drops the screenshot.

Either way the page comes back as it was. The screenshot is as sharp as your screen showed the page. It goes as a PNG, or as a JPEG where a PNG would be over the 5 MB a picture can be. A page at a size of its own, such as a phone's, is taken as big as it is drawn. While you draw, the page goes on in the background, and the conversation is yours to write in.

**How much room it has.** The window grows to make room for the page, and the conversation keeps its width. From there:

- **Drag the bar** between the conversation and the side pane to make the page wider or narrower. The conversation gives the room, or takes it. A double-click on the bar puts the pane back at the width it started with.
- **Fill the window.** The square button at the end of the pane's tabs has the pane take the whole window, over the conversation. Press it again to have the conversation back, as you left it.
- Both work for everything in the side pane: [a terminal](terminal.md), a plan, the changes.

**More than one.** Each **+ > Browser** opens another page in a tab of its own, up to twelve in a conversation window. A page that opens a new window gets a new tab here instead.

**Keys, while you are in the page:**

| Key                                 | What it does          |
| ----------------------------------- | --------------------- |
| `⌘R` (`Ctrl+R` or `F5`)             | Reload                |
| `⌘L` (`Ctrl+L`)                     | To the address bar    |
| `⌘[` and `⌘]` (`Alt+←` and `Alt+→`) | Back and forward      |
| `Esc`, in the address bar           | Puts the address back |

**Putting it away and closing it** are different things, as for [the terminal](terminal.md):

- Collapsing the side pane, with **Side pane** in the toolbar, hides the pages. They stay as they were, and come back when you expand it again. **View > Browser** or `⇧⌘B` goes back to the page you looked at last.
- The ✕ on a page's tab closes that page.
- Closing the conversation window closes its pages. They do not come back when you open the conversation again.
- Going on to another contact in the same window, from [your contacts beside the conversation](conversations.md#your-contacts-beside-the-conversation) or a [chat tab](conversations.md#chat-tabs), closes them too. Coming back to the contact opens them again at their addresses, where they were among the side pane's tabs, without their back and forward history.

## What a page can't do

A page is a stranger to the app, whoever made it:

- **It can't reach the app.** It has none of what the conversation window can do: no access to your contacts, your files or the agent.
- **It gets no permission it asks for**: no camera, microphone, location or notifications. Downloads are refused. The one thing allowed is putting text on the clipboard when you click a page's Copy button.
- **It can't open windows**, close the conversation window or take it somewhere else.
- **It keeps its own cookies**, apart from your browser's and from the app's. You are not signed in anywhere to begin with. Where you do sign in, you stay signed in the next time you open the app, until **Clear browsing data**.
- **It can't open a file on your computer.** Only you can, with **Open HTML file...**. That page goes on to the files in its folder and no others, and a web page goes to none.

Good to know:

- Your contact is not told any of this. It doesn't see the page or know that you opened it, unless you send it a screenshot.
- While you are in the page, the keys belong to the page. The window's own shortcuts, such as `⌘J` for the terminal, work again once you click in the conversation or press `⌘L`.
- A menu or a dialog that opens over the page shows a still picture of the page behind it until it closes.
- There are no developer tools here. For those, open the page in your own browser with **Open in** in the **⋯** menu.
- The [live demo](https://buddylist.dev/demo/) has no Browser tab: it is a web page itself.
