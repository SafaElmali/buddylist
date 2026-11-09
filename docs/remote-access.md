# Remote access

Use buddylist from your phone, wherever you are. Your phone opens a small app made for it, served by buddylist on your Mac through [Tailscale](https://tailscale.com), a private network between your own devices. There is no server of ours in between: your conversations stay on your Mac, and Tailscale encrypts the traffic between your devices. Keep the app running on the Mac while you use it. Your phone can also get a [notification](#notifications) when an agent needs you, finishes or runs into a problem.

```
iPhone on 5G or any Wi-Fi                       Your Mac
┌──────────────────────┐   Tailscale (HTTPS)   ┌───────────────────────────────┐
│ the phone app        │══════════════════════▶│ tailscale serve (https :443)  │
│  (Safari, or on the  │                       │   └▶ buddylist on 127.0.0.1   │
│   Home Screen)       │◀── replies, prompts ──│       the same conversations  │
│ Tailscale app (on)   │                       │       as its windows          │
└──────────────────────┘                       └───────────────────────────────┘
```

## Set it up

Open **Settings → Remote access**. Until a phone has paired, the page is five steps, one at a time: each one done is ticked, with what it came to, and the one to do now says what it needs, with one button for it. A step that waits for Tailscale, on this Mac or on your phone, looks again every few seconds and ticks itself.

```
┌─ Remote access ─────────────────────────────────────────────┐
│ [Mac]- - -•- - -[phone]  Your phone reaches this Mac        │
│                          through Tailscale… Step 3 of 5     │
│ ✓ Install Tailscale on this Mac   Signed in as you@ on mac  │
│ ✓ Install Tailscale on your phone your-iphone is on your…   │
│ ③ Turn on remote access                                     │
│   ┌───────────────────────────────────────────────────────┐ │
│   │ Password [            ]  Once more [            ]     │ │
│   │ [Turn on]                                             │ │
│   └───────────────────────────────────────────────────────┘ │
│ ④ Give buddylist a private address                          │
│ ⑤ Pair your phone                                           │
└─────────────────────────────────────────────────────────────┘
```

1. **Install Tailscale on this Mac**, open it and sign in. **Get Tailscale** opens its download page. If Tailscale didn't answer, the step says what Tailscale said, such as that it isn't running; open Tailscale, connect, and choose **Check again**.
2. **Install Tailscale on your phone** and sign in to the same account; the step names it. Scan the small code on screen with the phone's camera to get Tailscale. The step ticks itself once your phone shows up on your tailnet (buddylist reads Tailscale's own list of your devices, `tailscale status`, for an iPhone, iPad or Android signed in as you). Where it can't see it, choose **My phone has it**.
3. **Turn on remote access**: type a password twice and choose **Turn on**. The password signs in a browser that can't scan a code; your phone pairs with a code instead. Use at least 12 characters. Only a salted scrypt hash of it is kept, in `remote.json` in buddylist's data folder, readable by your user only. If it doesn't start, such as with another program on port 6767, the step says why.
4. **Give buddylist a private address**: choose **Set up Tailscale Serve**. buddylist shows the exact command and runs it only after you confirm, then shows what it printed:

   ```sh
   tailscale serve --bg --https=443 http://127.0.0.1:6767
   ```

   The first time, Tailscale may ask you to turn on HTTPS certificates for your tailnet; the link it prints opens from Settings. You can also copy the command and run it yourself. If Serve already passes port 443 on to something else, buddylist uses 8443, and 10000 if 8443 is taken too; Settings says so before you run the command, and offers none if all three are. Once this step is done, what Tailscale printed stays under it, one click away.

5. **Pair your phone**: pick what the phone may do, **Full**, **Answer only** or **Read only** (see [What a phone may do](#what-a-phone-may-do)), and choose **Show code**. On your phone, with Tailscale on, point the camera at the QR code and open the link. Or open the address shown, such as `your-mac.your-tailnet.ts.net`, and type the code. To open it like an app, add it to your Home Screen: in Safari, tap **Share**, then **Add to Home Screen**. On Android, Chrome offers **Install**. The phone app says how until you add it or tap **Not now**. The copy on the Home Screen keeps a sign-in of its own, so it asks for a code once more: choose **Pair another phone** on your Mac for it. While setting up, **Copy address** copies the address to open.

### Once a phone has paired

The page then says how it stands instead of the steps:

- At the top, whether it is ready for your phone, with the **Remote access** switch and the address to open, with **Copy**, and which phone last reached it and when (or that one is connected now). When something keeps your phone out, it says what, with what to do: Tailscale not connected on this Mac (**Check again**), Tailscale Serve's settings that couldn't be read (**Check again**), Tailscale Serve no longer passing the address on (**Set up again**), Funnel on, or why it isn't running.
- **Phones and browsers**: each device signed in, with when it paired and when it signs out if unused, whether its notifications are on or failing (and why), what it may do (**Full**, **Answer only** or **Read only**, to change there), **Sign out**, and **Pair another phone**, with what the phone you pair may do above it.
- **Notifications on your phone** (see [Notifications](#notifications)).
- **Keep this Mac awake while remote access is on** stops the Mac from sleeping by itself while remote access is on, so your phone can reach it. It is off until you turn it on: once your phone has paired, the page asks once, under how it stands (**Keep awake** or **Not now**), and the switch is here after that. A closed lid still puts a MacBook to sleep unless it is plugged in with an external display.
- **Setup**, folded away: Tailscale on this Mac (**Check again**), the private address (**Stop serving** turns Serve off again, `tailscale serve --https=443 off`), and **Change password…**.

Signing every device out doesn't bring the steps back: the page stays as it is, with **Pair a phone**.

## The phone app

It is drawn in the [professional look](professional-look.md), in the palette of your theme, by day or at night as your phone is, and in the text size your phone is set to: on an iPhone or iPad, Text Size and Larger Text in Settings.

### Home

```
┌─────────────────────────────┐
│ buddylist  ● Mac 🔔 Sign out│
├─────────────────────────────┤
│ WAITING FOR YOU 3           │
│ api-worker                  │
│ [Permission] Wants to run…  │
│ docs-bot                    │
│ [Question] Asks 2 questions │
│ web-fixer          Finished │
│ WORKING 1                   │
│ build-runner  Reading app.js│
│ ▾ SHOP 3                   │
│ Shop manager      Manager   │
│   cart-worker               │
│   checkout-worker           │
│ ▸ WEBSITE 4                │
│ ▸ ARCHIVED 2               │
└─────────────────────────────┘
```

- **Waiting for you** lists the contacts that asked you something first, saying what: a permission, a question, a plan or a change to the project's instructions. Then the ones that finished with something you haven't read, with how much.
- **Working** lists who is at work, and what each is doing, with the accent dot on its picture: also one whose turn is over while what it left [in the background](background.md) still runs, such as "2 commands running in the background", rather than as finished. Both it and Waiting for you show each contact’s project folder name (or This computer). A contact appears only in its priority section while it needs you or works, and returns to its usual section afterwards.
- **Projects** group the remaining contacts with the same grouping and manager hierarchy as the Mac’s default project view: projects by name, managers first, and their workers underneath. Favorites, This computer, Offline and Archived are listed as on the Mac when they have contacts; Archived starts folded, and its conversations open read-only; restore a contact on the Mac to reply. Empty projects are omitted.
- Tap a section’s name and count to fold it, or the arrow and count beside a manager to fold its team. This phone remembers each fold across reloads and reopening the app, separately from the Mac. Long project names are shortened visually, without showing the full path.
- With nobody waiting, **Waiting for you** says **Nothing needs you right now**. A contact that asks you something is drawn larger than one that finished, so it reads first.
- Under **Waiting for you**, one hint at a time: on a phone set to **Answer only** or **Read only**, what it may do (**Got it** puts it away until the level changes); then turning on notifications, then adding buddylist to your Home Screen. **Not now** puts it away.
- With more than 10 contacts, a filter at the top finds them by name or project, archived ones included. What you typed stays when you come back from a conversation.
- **Sign out** asks first, as signing in again needs a new code from your Mac, or the password.

Tap a contact to open its conversation. One that waits for you opens at its card, with what led to it above. The phone's Back goes back to Home, to the row you opened. **● Mac** at the top is green while the phone reaches your Mac, and amber while it tries again; a screen reader hears "Mac, connected" or "Mac, reconnecting". On Windows it says **PC** and on Linux **computer**, here and everywhere else on the phone, the sign-in page included.

### A conversation

- What was said, with replies in Markdown as they stream in, a line for each tool call with ✓ or ✗, and how each turn ended. A long conversation opens at its newest part, and **Show earlier** above it has the rest.
- **Permissions**: the command, change or address to look at, then **Decline**, **Always allow** where it is offered, or **Allow**.
- **Questions**: pick an option, or tick as many as you like where a question takes more, or write your own answer, then **Send answers**. **Let it decide** lets the agent go on with its own picks.
- **Plans**: read the plan, then approve it in one of the ways the agent offers, such as **Yes, auto-accept edits**, or **No, keep planning**, with what should change.
- **Project instructions** an agent wants to save: read the new text, then **Save** or **Don't save**.
- **Saying something**: type and tap **Send**. The phone's own keyboard starts a new line with Return; with a keyboard and mouse, Return sends. A message sent while the agent works waits its turn, marked **Queued**, with **Interrupt and send** to have it read now and **Cancel** to take it back into the box. A manager's message has **Edit** as well: it leaves the queue unread and its words go in the box, ahead of what you wrote, to send as yours, and its manager is told. A line under the conversation says whose they are, with **Put back**, which returns the message to its queue and the box to what you had written. Going Back, or the page loading again, puts it back too; a dropped connection keeps the edit. With **Answer only** or **Read only** neither shows. A manager's message your Stop holds says _Held since you stopped: it goes with your next message_, with **Send now**, as there is nothing to interrupt. However far the conversation has scrolled on, a line over the box says how many wait, such as **2 queued · Show**: tap it for the oldest.
- **Stop** stops whoever is at work, in one tap, as the conversation window's Stop does. While someone works, the button by the message box is **Stop** until you type, then **Send**. With a keyboard, Esc twice does the same.
- What you are writing, the options you picked on a question and feedback on a plan stay through Back, a reload or a dropped connection, in their own conversation.
- Once you have answered everything a conversation asked, **Next:** names whoever waits for you next, in the order Home lists them, a tap away.
- A conversation you have open on the phone counts as read, on the Mac too.
- Managers and project managers are talked to as anyone is.

On a phone set to **Answer only**, the message box and **Send** are gone, and the cards have no **Always allow**; **Stop** is there while someone works. On one set to **Read only**, cards show what they ask with nothing to press, and there is no **Stop**. Where the message box would be, one line says so.

A card answered on the Mac, or on another phone, goes away on yours too.

### Out of reach

A lost connection says so at the top, and a conversation says **Not reachable** instead of what its contact was doing. If it isn't back within 30 seconds, the top says what to check, with **Retry**. Once it is back, the phone app picks up where you were without reloading: Home stays where you scrolled, and a conversation opens where you were reading, with what happened meanwhile. A message sent as the connection dropped stays, marked as not confirmed yet, and is checked with your Mac once it is back, so it arrives once; an answer to a card works the same way.

The phone app keeps a copy of itself (its page, code and styles, never what was said), so it opens with your Mac out of reach, asleep or with Tailscale off: it says **Can't reach** your Mac, with what to check and **Retry**, instead of a browser error. The copy is renewed while the phone reaches your Mac, so it follows buddylist's updates.

## Notifications

Your phone can get a notification when an agent needs you (a permission, a question or a plan), finishes, or runs into a problem, even with the phone app closed. Tap one and the phone app opens that conversation, at its card.

On Android, a permission's notification also has **Decline**, on a phone set to **Full** or **Answer only**: it declines that request on your Mac without opening the app, as **Decline** on its card does. There is no **Allow** there, as the notification doesn't show what would be allowed: open the card for that. If the request was answered meanwhile, on your Mac or another phone, a quiet notification says **Already answered elsewhere**. If your Mac can't be reached, the phone is signed out or its level no longer lets it answer, the card opens instead. An iPhone shows no buttons on a web app's notifications: tap it to open the card.

**Turn them on in the phone app**: tap **Turn on** on Home, or the bell at the top, then allow them when your phone asks. Your Mac sends a first notification at once, "Notifications are on", so you know they work. With them on, the bell offers **Send a test**, which has your Mac send this phone a notification at once, and **Turn off**. Signing the device out turns them off too. **Phones and browsers** in Settings says which devices have them on.

What works where:

- **iPhone and iPad**: only buddylist on the Home Screen, on iOS 16.4 or later. Safari itself can't get them. Add buddylist to your Home Screen (Share, then **Add to Home Screen**), open it from there, sign in with a new code from **Pair another phone** on your Mac, then tap **Turn on**. The phone app says so in Safari, and the Home Screen copy's sign-in page says so too.
- **Android**: Chrome, Edge or Firefox, in the browser or installed.
- **A computer**: Chrome, Edge, Firefox, or Safari on a Mac.

The phone app checks how they stand each time you come back to it. If your Mac couldn't deliver the last one, Home says why, with **Send a test**. A subscription your browser renewed without telling your Mac is given to it again. If your Mac sends them to a subscription your browser no longer has, as after clearing its data, the phone says they stopped and offers **Turn on**. Turning them off while your Mac can't be reached leaves them on, and says so, with **Try again**.

If your phone's question whether to allow them is closed without an answer, the card says so, and **Turn on** asks again. If they were blocked, the card says where to allow them: on an iPhone, **Settings › Notifications › buddylist**; in Chrome, **⋮ › Settings › Site settings › Notifications**, for your Mac's address. When they can't be turned on, the card says whether your phone's push service didn't answer or your Mac couldn't be reached, with **Try again**.

Two switches under **Notifications on your phone** in **Settings → Remote access** say when they come and what they say:

- **Only when I'm away from this Mac** (on at first): only while the Mac is locked, or nobody has used it for 5 minutes. Off, they come while you're at the Mac too, but not for the conversation you're looking at there.
- **Show what was said** (off at first): off, a notification says only who and what kind, such as "api-worker needs your permission" with "Open to allow or decline". On, it shows what they asked or said instead, on your lock screen too.

A status that keeps the Mac's pop-ups away, **Busy**, **On The Phone** or **Appear Offline**, keeps your phone quiet too. Where your phone shows a number on the app's icon, it counts who is waiting for you, as Home's first section does.

```
Your Mac                                  push service                  your phone
┌──────────────────────────────┐  https   ┌─────────────────────┐       ┌─────────────────────┐
│ an agent needs you           │─────────▶│ Apple, Google,      │──────▶│ service worker      │
│ └▶ Notifier: toast here,     │encrypted │ Mozilla or Microsoft│       │ decrypts, shows it  │
│    and the phones with       │+ signed  │ (passes it on, can't│       │ tap ▶ phone app at  │
│    notifications on          │          │ read it)            │       │ that conversation   │
└──────────────────────────────┘          └─────────────────────┘       └─────────────────────┘
```

Notifications are the one thing that leaves your tailnet: a phone gets them through its browser's own push service, as every web app's. Each is encrypted for that phone alone and signed with a key your Mac made, so the push service passes on what it can't read, and nobody else can send to your phone in buddylist's name. The push service sees when one is sent and how big it is. buddylist sends only to those push services' https addresses, nowhere else.

### What stays on the Mac

Adding or changing contacts, Settings, message history and search, pictures and voice clips, files, changes, terminals, the Run button, browser panes, inviting guests and editing a plan stay in the Mac's windows. The phone app shows none of them, rather than buttons that don't work.

## What a phone may do

Each phone or browser has an access level, picked above the code as you pair it and changed on its row under **Phones and browsers**:

| Level           | Reads Home and conversations | Answers permissions, questions, plans and instructions | Stop | Sends messages, **Interrupt and send**, **Cancel** | **Always allow** |
| --------------- | ---------------------------- | ------------------------------------------------------ | ---- | -------------------------------------------------- | ---------------- |
| **Full**        | yes                          | yes                                                    | yes  | yes                                                | yes              |
| **Answer only** | yes                          | yes, once at a time; a plan only asking before edits   | yes  | no                                                 | no               |
| **Read only**   | yes                          | no                                                     | no   | no                                                 | no               |

- **Full** is what a phone could always do, and the level a code pairs with unless you pick less. A browser signed in with **the password** has full access: the password stands for everything the agents can do. Devices paired before levels came in (v0.7.0) keep full access.
- **Always allow** from a phone is a standing rule on the Mac, as from the conversation window: that agent isn't asked about the same kind of request again. Only a phone with full access may give it, and the same goes for a Codex Computer Use card's **Allow … for this conversation** (see [Codex](codex.md)).
- A plan approved in a mode that does more unasked, such as **Yes, auto-accept edits**, widens what the agent does for the rest of the session in the same way. On a phone set to **Answer only** the plan offers only **Yes, ask before edits**, and says once that the other needs full access.
- Every level reads every conversation, marks one read as it opens, and gets [notifications](#notifications).
- Your Mac checks each request a phone makes against its level, whatever the phone app shows: a request its level doesn't allow is refused, and the phone says why, in words. A level changed in Settings applies from the phone's next request, and an open phone app shows the change at once.
- None of the levels lets a phone change settings, pair other devices or see the device list.

## Signing in

- **A code** pairs a phone. It is shown only in Settings on the Mac, works once and for five minutes, and is cancelled after five wrong tries. The QR code carries it after the `#` in the address, so it never reaches Tailscale or a log; the page takes it out of the address at once.
- **The password** signs in a browser that can't scan the code. Changing it signs out every device, unless you untick that.
- **Sign out all**, and a new password that signs every device out, also stop the code shown in Settings from working: show a new one to pair again.
- **On the sign-in page**, a code sends itself once its eighth character is typed. A wrong code stays in the box, with what went wrong right under it. A conversation opened while the phone is signed out, from a notification for one, opens once you have signed in.

Each phone or browser that signs in is a device, listed under **Phones and browsers** with its name (such as iPhone · Safari, or iPhone · Home Screen), how it came (Tailscale, with its tailnet address and login, or this Mac), when it was last used, when it paired, and when it signs out if unused. Two of the same phone are told apart by when they paired. Your Mac says when a new device signs in. **Sign out** ends a device at once and sends its open pages back to the sign-in page; **Sign out all** ends every one. **Sign out** in the phone app ends that one device. A device stays signed in across restarts until it goes unused for 30 days.

## Safety

- buddylist listens on 127.0.0.1 only. Nothing else on your network reaches it; Tailscale Serve, on the Mac, passes on what comes from your tailnet.
- **Tailscale Funnel** would put buddylist on the public internet. buddylist won't turn on while Funnel is on for it, nor start with the app if Funnel was turned on meanwhile, and says how to turn Funnel off (`tailscale funnel --https=443 off`). If Funnel is turned on later, remote access turns itself off and signs every device out. A request marked as coming through Funnel is refused, and buddylist asks Tailscale whether Funnel is on (at most every 10 seconds): only Tailscale saying so turns it off, so a request that only claims it can't sign your devices out.
- Others on your tailnet can reach the sign-in page, but need a code shown on your Mac or the password. Wrong passwords are limited to 5 from one device's tailnet address and 20 in all within 15 minutes; Settings says which address waits and until when, next to pairing. Wrong codes are counted apart, with the same limits, and a new code starts them over, so a phone that mistyped a code pairs with the next one at once. A successful sign-in doesn't count as a try.
- Cookies are HttpOnly and SameSite=Strict, and only sent over https behind Tailscale. Every form post and WebSocket must come from buddylist's own page (its Origin), and requests for any other host name are refused, so other websites can't use your session.
- A signed-in device can read every conversation and, as far as [its level](#what-a-phone-may-do) lets it, answer permission requests and send messages, as you can in the app. Agents run on the Mac with each contact's own permissions. A device can't change settings, pair other devices or see the device list. If you lose a phone, sign it out in Settings.
- Of Settings, a phone is told only the theme it is drawn in. Environment variables, accounts, the agents' programs, instructions and what a project is set up with stay on the Mac, and so does any setting added later. A phone can't run a service's setup check, or ask for a service's models in a folder.
- Before you sign in, only the sign-in page is there, with the app's name and icons for a Home Screen, and the phone app's service worker (code, no data). The phone app and everything it loads come after.
- Notifications go only to Apple's, Google's, Mozilla's or Microsoft's push service, over https, encrypted for the phone (RFC 8291) and signed (RFC 8292, VAPID). By default they don't say what was said.

## How it works

`src/main/remote/access.js` turns the host on and off as Settings says, and keeps the password, the devices, whether it is on and whether a phone has paired through Tailscale once (`setUp`: Settings shows how it stands instead of the steps from then on) in `remote.json`. `host.js` is a Node HTTP server on 127.0.0.1:6767. Signed in, `/` is the phone app (`src/renderer/phone/`), and only it and what it loads are served: the shared code, the professional look's colours and the packages that draw Markdown. The Mac's own windows are not. The host checks Host and Origin, refuses Funnel requests (Tailscale marks them `Tailscale-Funnel-Request`), limits sign-in attempts and connection sizes, and carries requests and events over a WebSocket. `devices.js` keeps a SHA-256 of each device's token, never the token. `pairing.js` makes the codes. `tailscale.js` reads `tailscale status --json` (with the account this Mac is signed in with, and the iPhones, iPads and Android devices on the tailnet signed in as the same user, which tick the phone step) and `tailscale serve status --json`, and runs its fixed commands with no shell. It runs them with `TAILSCALE_BE_CLI=1`: the Mac app's command (`/Applications/Tailscale.app/Contents/MacOS/Tailscale`) is the app itself, and acts as the command only in a shell or when told to, so run from buddylist opened in the Finder it would otherwise try to open its window and print "The Tailscale GUI failed to start". When Tailscale doesn't answer, Settings shows what it printed. Static files are checked after resolving symlinks.

The phone app runs the app's own preload over `remote/network-ipc.js`, so it has the same `window.messenger` as a window. `remote/routes.js` forwards only an explicit list of channels, the ones the phone app uses; none of Settings' remote requests are on it. Of those, `allows(access, channel, args)` lets a device ask only what its level allows, from three lists every forwarded channel is in exactly one of: `READS` (what reads, marks a conversation read, or is only counted), `ANSWERS` (`chat:respond`, `chat:interrupt`) and `SENDS` (`chat:send`, `chat:send-now`, `chat:cancel`). `full` asks all of them; `answer` asks `READS` and `ANSWERS`, with `chat:respond` never `always` and approving a plan only in mode `default`; `read` asks `READS`. A level that isn't one of the three is read only, and a channel none of the lists names reaches only a device with full access. A refused request answers `{ error, code: 'not-allowed', access }`, which the phone says in its own words, naming the computer. `app:init` and `chat:init` answer a page with `settings: { theme }` only, and `app:init` adds `host: { name, noun }`, the Mac's name on the tailnet (`studio-mac`) and what it is (`Mac`, `PC` or `computer`), and `access`, the device's level. A level changed in Settings (`remote:device-access`) reaches the device's open pages as `{ kind: 'access', access }` over their WebSocket. Each device keeps its level in `remote.json`, which has `version: 2` since: reading one without a version gives each device that has no level `access: 'full'`. The `settingsChanged` event reaches a page as `{ theme }`; `projectChanged` doesn't reach it. A page hears what happens in the conversation it opened last. `X-Forwarded-For`, `X-Forwarded-Proto` and `Tailscale-User-Login`, which Tailscale Serve sets, are only trusted from a loopback peer; of `X-Forwarded-For`, only the last address, the one Serve added, is.

Files go out with a validator (a weak `ETag` of size and time, `Cache-Control: no-cache`), so a file a phone has is answered 304 with nothing after it, and text is compressed with brotli or gzip as the browser takes it, each version of a file once (`Delivery` in `web.js`). The phone app's page names every module it imports by name up front (`<link rel="modulepreload">`), so they come together rather than one import after another; a module loaded with `import()` is left for when it is needed. A build of the app (`npm run build:app`, so every installer) has the phone app as one minified bundle in `src/renderer/phone/build/` (`buildPhone` in `scripts/build-app.js`): the messenger (the preload on `network-ipc.js`) and Home, the conversation with Markdown and highlighting apart, loaded once one opens, what they share in pieces of their own (so the messenger and the screens have one copy of each module), and the stylesheets in one. Each file is named by a hash of what is in it and goes out with `Cache-Control: public, max-age=31536000, immutable`; `src/renderer/phone/bundle.json` says which file of the page each stands for and which modules they import, and the page names those instead (`phonePage`). `npm start` serves the modules as they are, named from `moduleGraph`. The page has the user's palette inline, the professional look's by day and at night (none for Luna's blue); a theme changed on the Mac meanwhile brings the professional look's part of `palettes.css`, which is all the phone is served of it.

News for every window reaches each page at most once a second, the latest of each kind and only when it changed, and contacts without what the phone never draws (a pull request's details, how an agent runs). A page tells the host when it is hidden (`{ kind: 'visible', visible: false }` over its WebSocket) and hears none of that news until it says it is back (`visible: true`), when it gets the latest at once; what happens in the conversation it shows keeps coming. A page that opens its socket as `/api/socket?patches=contacts` gets the contact list whole once, then as `{ kind: 'event', channel: 'contacts:changed', patch: { set, removed, order? } }`: the contacts that changed or came, the ids of those that went, and the order of ids where it changed.

A conversation opens on a phone with its newest 150 entries: `chat:init` answers a page with `history` cut to those and `more: true` where there are older ones. `chat:history(contactId, { before, limit })` answers `{ entries, more }`: the `limit` entries (100 unless asked, at most 500) before the entry whose id is `before`, newest last, or the newest without it.

A failed `/api/pair` or `/api/login` answers 401 with `{ reason, triesLeft }`: `reason` is `wrong`, `used`, `expired` or `cancelled` (for a password, always `wrong`), and `triesLeft` how many more wrong ones that phone has before it waits. A wait answers 429 with `{ retryAfterSeconds }` and `Retry-After`. `/login`, `/pair` and a signed-out `/` lead to the sign-in page with their `then` (where to go once signed in, such as `#/c/<id>`) and `why` (`signed-out`, `expired`) query parameters, and nothing else of the address. `chat:send(contactId, { text, clientId })` from a page: a `clientId` the same device sent within 10 minutes is answered with the first answer, and the message isn't said again, so a send that lost its connection can be sent again safely.

Notifications: a device that turns them on posts its browser's push subscription to `/api/push` (and `DELETE` turns them off). `push.js` keeps it on that device in `remote.json`, with the Mac's VAPID key pair, made the first time one is asked for, and takes each note `Notifier.notify` (`src/main/notifier.js`) shows: whose it is and what kind (permission, question, plan, finished, error). It sends the note when the switches say so, to every device with a subscription. `web-push.js` encrypts it (aes128gcm: ECDH P-256, HKDF, AES-128-GCM) and signs it (an ES256 JWT), with Node's own crypto, and posts it only to an https address of a known push service. A subscription its push service no longer has (404, 410) is forgotten. Any other refusal, or a note that can't be sent, is kept as the device's last failure until a note goes through, and shown in Settings. `GET /api/push` answers `{ publicKey, on, endpoint, failure }`: `endpoint` is the subscription the Mac holds for that device ('' with none), for the phone app to hold up to its browser's own, and `failure` is `{ at, reason }` or null. `POST /api/push/test` sends that device a test note: 204 once the push service took it, 409 with notifications off, 502 with the reason where it didn't. The phone app's service worker, `src/renderer/phone/sw.js`, is served at `/sw.js` for the whole app; it shows the notification, sets the icon's number where the Badging API is there, and on a tap opens the conversation. A permission's note to a device whose level may answer carries `decline: { contactId, requestId }`, which the worker shows as a **Decline** action; it posts that to `/api/decline`, which declines the request through the same `chat:respond` handler a page uses: 204 once declined, 409 `{ reason: 'answered' }` where it no longer waits, 403 `{ reason: 'not-allowed', access }` for a level that can't answer, 401 signed out.

`BUDDYLIST_REMOTE_PORT` picks another port for a test run (`0` for any free one). With `BUDDYLIST_TEST=1`, `BUDDYLIST_PUSH_TEST_ORIGIN` names a fake push service on 127.0.0.1 a check run may send to, and `BUDDYLIST_TAILSCALE_CLI` a stand-in for Tailscale's command, such as `test/fixtures/fake-tailscale.js`, which answers from the JSON file `FAKE_TAILSCALE_STATE` names, so a check run never asks the real Tailscale.

```sh
node --test test/remote-*.test.js test/phone-app.test.js
npm test
npm run lint
```

For a real-app check, have Playwright's WebKit and Chromium (`npx playwright-core install webkit chromium`) and use the development Electron executable (or a packaged app executable):

```sh
node scripts/check-remote-ui.js node_modules/electron/dist/Electron.app/Contents/MacOS/Electron dist/remote-check .
```

This creates and removes an isolated demo profile with a few contacts at work and a stand-in for Tailscale, signed in and serving, turns remote access on in Settings, shows a code with its QR code, and pairs an iPhone-sized WebKit with the code. It checks Home's project sections, project labels, manager hierarchy, fold memory after reload, narrow layouts and their order, a reply, a permission, questions, a plan, a queued message's Cancel and Send now, Stop, marking read, a manager, a dropped connection, and signing out from the phone and from Settings, and takes a still of each screen by day and at night. Then a phone-sized Chromium turns notifications on against a fake push service on this computer, which checks the signature and decrypts each note: the first note, a permission with who and what kind only, the service worker showing it with **Decline** and a tap opening the conversation, the text once **Show what was said** is on, a permission declined from its notification, and nothing after the device is signed out. `BUDDYLIST_CHECK_VIDEO=1` records a video too. Agent replies are simulated; no paid agent account is needed.

A release's scripts are not quite `npm start`'s: with `SENTRY_AUTH_TOKEN` set, Sentry's build plugin makes each one from a module of its own, so the built preload sets `module.exports` and an ES module ends with an `export` (see `sourceMaps()` in `scripts/build-app.js`). So the messenger runs the preload as the CommonJS module it is, and the service worker is built as a classic script. `test/build-app.test.js` builds as a release does; to check the phone app in a packaged app built that way, give the build a token without `SENTRY_ORG` and `SENTRY_PROJECT`, which sends nothing:

```sh
SENTRY_AUTH_TOKEN=local npm run build:app && npx electron-builder --mac --dir --arm64 --publish never
node scripts/check-remote-ui.js dist/mac-arm64/buddylist.app/Contents/MacOS/buddylist dist/remote-check
```

A pull request that changes the phone app, what serves it or what a build makes of it runs this check the same way on Linux, against an unpacked package (the phone job of `.github/workflows/build-app.yml`; `scripts/packaging-changes.js` says which pull requests), where the app says "computer" where a Mac says "Mac".
