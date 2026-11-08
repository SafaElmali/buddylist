# Try it in a browser

```bash
npm run preview:web
npx serve dist/web-preview   # or any static file server, then open index.html
```

This builds the app's real windows into a web page that runs in demo mode on a little desktop. It opens in the professional look, as a new install does, on a quiet slate desktop with an ink taskbar; in the messenger look (**Tools > Look > Messenger**) the desktop is XP's. It's handy for trying the interface on a phone, or for showing it to someone without installing anything.

The page starts signed out. Click **Sign In** to begin: no account is needed, and the click is what lets the browser play the sounds. A contact then messages you, so you see an incoming toast straight away.

## The tour

**Show me around** in the yellow note plays the app by itself: a drawn mouse pointer signs in, opens a conversation, asks for a fix, accepts the edit, asks for a terminal and opens the Changes tab, and a balloon says what each step is. It takes a little over half a minute.

- **It is the real interface.** The pointer clicks the app's own windows. Nothing is a recording.
- **Click anywhere, or press a key, and it is yours.** The tour stops where it is, and what it opened stays open. Scrolling does not stop it.
- **It starts from a fresh demo**, so playing it again from the start menu clears your conversations first. **Reset the demo** stops it.
- **It needs room.** On a phone there is no tour, and none in a page opened from a file, where the windows can't reach each other.

A page that embeds the preview can have it play on its own:

- **`#tour` in the address** (`index.html#tour`) starts it once at least half of the desktop is on screen. It does not start for someone who asked their system for less motion, or who has clicked or typed in the preview first. While it waits, the welcome note stays hidden, so it doesn't flash up and vanish as the page is scrolled to the desktop; a click or a key before the tour starts brings it back.
- **To start or stop it yourself**, post a message to the frame: `frame.contentWindow.postMessage({ buddylistTour: 'start' }, '*')`, or `'stop'`. Asked to start while it plays, it starts over.
- **To follow it**, listen for messages from the frame: `event.data.buddylistTour` is `'playing'`, then `'finished'`, or `'stopped'` when the visitor took over.
- **To change its look**, post `{ buddylistLook: 'professional' }`, or `'messenger'`. The frame posts `event.data.buddylistLook` back each time its look may have changed, also from its own **Tools > Look**, so a switch on the page can follow it.

While it plays, the preview leaves the keyboard and the scrolling of your page alone.

## What is made up

Nothing behind the windows is real: there is no agent, no git and no shell in a browser.

- **The replies are scripted.** What you type picks one, as in [demo mode](../README.md#no-login-use-demo-mode): anything gets a command to accept, `fix` an edit to a file, `plan` a plan, `ask me` a question, `diagram` a reply with a [diagram](conversations.md) in it. `terminal` has a Claude contact [open terminals for you](terminal.md): "three terminals", "a terminal for the tests", "a terminal running git status". `subagents` has it start two [subagents](subagents.md), which work side by side for a few seconds. `background` has it leave a dev server and a watcher on CI [running in the background](background.md). `check back` has it set a [check-in](check-ins.md), due a few seconds later.
- **The terminal is a pretend shell**, also one a contact opened for you. It says so in its first line. It answers `help`, `ls`, `pwd`, `whoami`, `echo`, `clear`, `exit`, `git status`, `git branch`, `git log`, `git diff`, `npm test` and `npm run dev`, about the contact's made-up folder. Anything else is "command not found".
- **The Changes tab lists made-up files.** An edit you accepted from a scripted contact joins them, and `git status` in the terminal lists it too. One contact's branch has two made-up commits as well, to look at one by one. The contact with an open pull request has a few made-up review comments under the lines of its files. A reply you write, and a thread you resolve, stay in the page and are posted nowhere.
- **Pull requests, branches and costs** on the contact rows and cards are made up as well.
- **A conversation starts without [your contacts beside it](conversations.md#your-contacts-beside-the-conversation).** The desktop is a small one, and the contact list is right next to the conversation. **Contacts** in the toolbar shows them. On a phone there is no room for them, and no button.
- **There is no [Browser tab](browser-tab.md).** The preview is a web page itself, and has no page to show beside a conversation.
