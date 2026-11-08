# How the code is organized

The main idea: **the windows never see provider-specific data.**

1. A provider turns its native stream into a small set of [session events](../src/providers/contract.js): `text-delta`, `tool`, `permission`, `result`, and a few more.
2. It describes tool calls as neutral **activities**, such as `{ kind: 'command', command: 'npm test' }` or `{ kind: 'edit', path, changes }`.
3. The windows render activities, so they work unchanged for any provider.

Provider-specific choices are plain data in the provider's descriptor: permission modes, plan-approval buttons, model suggestions, usual effort levels, common slash commands, built-in output styles and the login hint. A provider that can be asked says itself which models it has, each with the effort levels it takes; one that can't says so from a session.

A [group conversation](group-conversations.md) needs nothing from a provider either:

- A conversation is known by its host contact's id. Its guests are listed with that contact, each with the mode and session it has there.
- Every participant has a session of its own, in the host's folder. `turns.js` decides whose turn it is, and `relay.js` writes the one text an agent is sent on its turn.
- Every event on its way to a window says who it is from in `speaker`. A `participants` event follows when someone joins, leaves or changes. Both are described in [`contract.js`](../src/providers/contract.js), next to the session events.

What an agent can ask of the app itself, such as [terminals](terminal.md) beside its conversation, [another conversation](started-conversations.md), saving [its project's instructions](settings.md#instructions), or a [project manager](project-managers.md)'s messages to the conversations it oversees, is the app's own too. It is described once, in `main/app-tools.js`, and a provider that can give its agent tools wraps it its own way: Claude as a tool server in this process (`providers/claude/app-tools.js`). What was asked for reaches the windows as an activity of kind `app`.

A [helper](subagents.md), an agent's own subagent, has no event of its own either:

- The call that asks for one is an activity of kind `delegate`. What the helper does are `tool` events with `sub`, each naming that call in `helper`.
- The call's `tool-result` comes when the helper has ended, with its report. Until then the helper is at work, also after the turn it was asked in.
- Helpers at work after that turn leave the session `idle`: nobody is typing. `conversations.js` counts them from those two events, and lists the contact as busy with "2 subagents at work".
- A session can then go to `working` without being sent anything: Claude Code starts a turn of its own when a helper reports, and says `init` at the start of every turn. In a conversation with several agents, `turns.js` takes that as the turn going on.
- The Subagents tab is drawn from those, as they happen and from the saved history alike. A session only adds `stopHelper`, and a provider says in its descriptor that its sessions tell (`helpers`). The code calls them helpers; the window calls them subagents, as Claude Code does.

What an agent left running [in the background](background.md), a command or a watcher, is the session's own too, and is not saved:

- The session lists all of it in a `background` event whenever any of it changes: what runs, and what ran and ended. What still runs when its agent is gone is listed as stopped. Claude's comes from Claude Code's task events (`task_started`, `task_updated`, `task_notification`), checked against `background_tasks_changed`, its list of what runs now; `providers/claude/background.js` keeps it.
- `conversations.js` keeps each participant's list, and hands it to the window with the participants. The Background tab is drawn from that. A session adds `stopBackground` and `backgroundOutput`, which reads the end of what one printed, and a provider says in its descriptor that its sessions tell (`background`).

A [check-in](check-ins.md), something an agent set itself to be woken for later, is the session's own as well:

- The session lists them in a `check-ins` event whenever they change, and an empty list once its agent is gone. Claude's come from Claude Code's `Stop` hook, which lists them after every turn.
- One that is due starts a turn nobody sent anything for, as a helper's report does. The session says so first, with a `notice`. Claude's is a prompt Claude Code's `UserPromptSubmit` hook names that the session never sent.
- `conversations.js` keeps them with each participant, so the status bar and the contact list say when someone checks back. A provider says in its descriptor that its agents set them (`checkIns`).

Codex and ACP agents reach the app’s tools through `app-tool-bridge.js`. Each session has a loopback-only HTTP server and a random bearer token; its stdio proxy runs with the app’s executable and `ELECTRON_RUN_AS_NODE=1`. Codex receives the token only in its app-server environment and forwards it to the proxy through MCP `env_vars`; its `-c` arguments contain the variable name, never the token. ACP receives the proxy’s environment in session JSON over stdin. Closing a session closes its server.

```
src/
  providers/            AI back ends, behind one contract
    contract.js         the interface every provider implements (JSDoc types)
    base-session.js     shared state machine + permission-prompt round trip
    index.js            provider registry
    app-tool-bridge.js  session-scoped app tools over an authenticated loopback server and stdio proxy
    json-rpc.js         JSON-RPC over a process's stdin and stdout, shared by Codex and ACP
    setup.js            asking a CLI whether it is installed and signed in, without starting a session, and to sign in
    claude/             Claude, via the Claude Agent SDK
      session.js        SDK messages -> session events
      activity.js       Claude Code tool calls -> provider-neutral activities
      app-tools.js      the app's own tools, as a tool server for the SDK
      accounts.js       more than one Claude login, each in a config folder of its own that shares the user's
      sessions.js       the conversations Claude Code keeps itself, such as a terminal's, for the message history
      transcript.js     one of those -> the entries a conversation window is drawn from
    codex/              Codex, via `codex app-server`
      rpc.js            the app server's flavour of JSON-RPC
      session.js        app-server notifications and approval requests -> session events
      activity.js       Codex commands, patches and tool calls -> provider-neutral activities
    acp/                any CLI that speaks the Agent Client Protocol
      session.js        ACP updates and permission requests -> session events
      activity.js       ACP tool calls -> provider-neutral activities
    gemini/             Gemini CLI, via `gemini --acp`
    opencode/           OpenCode, via `opencode acp`
    hermes/             Hermes, via `hermes acp`
    demo/               scripted fake session and made-up accounts (npm run demo, UI tests)
  main/                 Electron main process
    index.js            wiring
    conversations.js    the sessions of every conversation; events -> history, statuses, unread counts, windows, toasts
    turns.js            whose turn it is when several agents share a conversation
    relay.js            what an agent is sent on its turn: what the others said and did
    ipc.js              every request a window can make
    notifier.js         toasts, sounds, dock badge and bounce, as far as your status allows
    auto-away.js        Online to Away while the Mac sits idle, and back again
    analytics.js        anonymous usage counts: which requests of a window are counted, and sending them to PostHog
    tray.js             the menu-bar icon: statuses, unread count, its menu
    quit-guard.js       "Signing out will end 3 conversations.": asks before quitting, or restarting to update, while contacts are busy
    shortcuts.js        the shortcuts that work from any app, and Settings... in the Mac menu bar, as Settings > Shortcuts has them
    updates.js          a newer version: asked of the public repository of releases, and whether this copy can put it in place itself
    app-updater.js      a newer version downloaded in the background and put in the app's place by Restart (electron-updater)
    idle-restart.js     Restart when idle: restarts by itself once no contact is busy and the Mac sits idle
    icons/              the menu-bar pictures
    contact-card.js     the hover card: git branch, its pull request, uncommitted changes, today's cost
    changes.js          the Changes tab: the commits a folder's branch made, the files that differ from the main line or from the last commit, the diff of each and each file whole, read with `git`
    review-threads.js   the Changes tab: what reviewers said about the lines of a contact's pull request, asked of `gh`; replying and resolving
    pull-requests.js    each contact's pull request, its checks and conflicts, watched with `gh`; the toast when checks fail or pass
    pull-request-page.js  "Create PR manually": the page on GitHub that opens a pull request for a folder's branch, read with `git`
    review-requests.js  pull requests waiting for your review, asked of `gh`, or that `gh` is still to be connected
    github-sign-in.js   "Connect to GitHub": signs `gh` in from the app, with the one-time code GitHub wants typed into its page
    github-lookup.js    the issue or pull request a new contact is started from, asked of `gh`
    worktrees.js        a contact's own git worktree of a project, on a new branch or a pull request's
    projects.js         a project that is not here yet: cloned from GitHub, or started from nothing
    accounts.js         the logins added for a service, which one is in use, and the next to go on in when one reaches a limit
    setup-check.js      the welcome wizard's list: every service's CLI and GitHub's, each with how it stands, and the sign-ins started from it
    voice.js            voice clips -> text, with whisper.cpp
    files.js            the All files tab: what a folder of a contact's holds, and what a file says, only ever read; and what was picked to send: pictures to put in, paths to @mention
    checks.js           the Checks tab: the checks of a contact's pull request, asked of `gh`, why each failed one failed, and re-running them
    runs.js             the Run button: a project's own scripts for a contact, its port, their output, and stopping all of it; the setup script of a new worktree
    git-bash.js         where Git Bash is, which a project's scripts run in on Windows
    run-command.js      which project a folder belongs to, and a guess at the command that starts it
    project-settings.js what each project is set up with, the variables its scripts, terminals and agents are started with, and the projects there are
    terminals.js        the terminals beside a conversation: your own shell in a contact's folder, on a pseudo-terminal (node-pty)
    browser.js          the web pages beside a conversation: each a view laid over its window, with a session of its own and nothing of the app's
    app-tools.js        what an agent can ask the app itself to do: open terminals, with a command in them, or start a conversation; and a project's manager's: message a conversation, look at them, keep the brief
    schedules.js        prompts that start a contact by themselves, on a cadence: one timer for the next run that is due, the runs missed while the app was closed run once, Max runs, Run now
    managers.js         each project's manager: the contact it is, what it hears of the rounds that changed files in its project's other conversations, its messages to them, and the fresh session that takes over once its context window fills
    error-reports.js    errors nothing caught and processes that crashed, sent to Sentry: this process's own and the ones a window hands over
    pack.js             bundled media plus the user's emoticon, wink and picture files
    storage/            profile + contacts + settings, per-contact history and the archive of past conversations
    windows/            window creation, a conversation window going on to another contact, toasts, the nudge shake, room for what opens beside a conversation, the window Settings is in
  preload/index.cjs     the only bridge between windows and main process
  pack/                 15 classic Winks, matching soundtracks and browser manifest
  shared/               used by both sides: IPC channel names, what a project is set up with (scripts, variables, files of variables, preview URLs, instructions), activity wording, the app's own tools, what a project's manager is set up with and told, branch names, contact groups, feedback reports, error reports and what they leave out, the usage counts' PostHog project, the contact list's layout, your contacts beside a conversation, the themes, project names, GitHub issues and pull requests, connecting to GitHub, pack addresses, plan titles, the side pane's room, the shortcuts you can change and the keys each starts with, reading a unified diff, comparing two texts line by line, what the Changes tab calls uncommitted changes, finding a file by the letters of its name or the way to it, which workflow runs of a pull request still have a check going, turn costs, who quitting or restarting would interrupt, schedules and the cron their cadence is kept as, your statuses, @mentions, what goes into a message as a picture, window titles, pull request wording, reading the changelog and its address, run output, a terminal's size and scrollback and what its Find says, a web page's address, place and keys
  renderer/             the windows (plain ES modules; only a packaged app is bundled)
    lib/                frame, menus, dialogs, icons, emoticons, pictures and the viewer that shows one over the window, Markdown and the diagrams in it (Mermaid, loaded the first time a reply has one), sounds, handing an uncaught error to the main process
    sounds/             the three original MSN notification recordings
    contacts/           the contact list window; its list is drawn beside a conversation too
    chat/               the conversation window
    history/            the message history windows: one contact's, and every contact's
    onboarding/         the welcome wizard: what a new install opens with
    settings/           Settings, over the contact list or a conversation: the app's own pages, and each project's (see docs/settings.md)
    toast/              the corner pop-up
    styles/             theme tokens by day and at night, XP controls, window frame, per-window CSS; the professional look's tokens and styles (pro-theme.css, pro.css); the other palettes of Tools > Theme (palettes.css, made by scripts/build-palettes.js)
preview/                the browser preview: stand-ins for the preload and main process
site/                   the landing page and its changelog (npm run build:site) and the Worker behind its feedback form
scripts/                builds for the packaged app, browser preview, landing page (with its visitor counts), icon and screenshot
test/                   node:test unit tests
```

### Original chat pictures

Sent image bytes are kept without re-encoding in `history/pictures/`, named by their SHA-256 and image type. History entries keep compact previews plus portable `picture:` references in `originals`, aligned by index. The read-only `picture:read` request resolves only those references, on demand, for the viewer, copying, downloading and resending. It accepts no filesystem paths. Archives and forks reuse the same bytes. Ownership records keep originals available through rewinds and drafts; deleting the last contact that owns one removes it. Removing individual messages or archives does not prune originals while that contact still exists.

The Browser screenshot editor keeps its full PNG separately when it creates a smaller provider payload. The existing provider size limit and encoding choices are unchanged. Old histories with only previews need no migration; the viewer labels them Preview only. Agent tool-result images use the bytes the provider supplied, and Markdown images still use their file source.
