/**
 * The contract every AI provider implements (Claude, Codex, Gemini, OpenCode
 * and Hermes today).
 *
 * A provider has two parts:
 *  1. `descriptor`: plain, serializable data the windows use to show choices
 *     that depend on the provider (permission modes, model suggestions,
 *     login hints).
 *  2. `createSession()`: returns an {@link AgentSession} bound to one contact.
 *
 * A session reaches the rest of the app only through `emit(event)`, using the
 * {@link SessionEvent} shapes below. A provider's native message format and
 * tool names never leave `src/providers/<id>/`. Tool calls are translated into
 * provider-neutral {@link Activity} objects.
 *
 * To add a provider, see "Adding a provider" in the README.
 */

/** @typedef {'offline' | 'connecting' | 'idle' | 'working' | 'waiting'} SessionState */

/**
 * Something the agent is doing, described without provider-specific tool names.
 * @typedef {Object} Activity
 * @property {'command' | 'read' | 'write' | 'edit' | 'search' | 'web' | 'delegate' | 'todo' | 'plan' | 'question' | 'skill' | 'schedule' | 'app' | 'account' | 'tool'} kind
 *   `account`: going on in another of the user's accounts, after the one in use reached a limit
 * @property {string} [command]      shell command (`command`), or the one typed into the terminals the app opened (`app`)
 * @property {true} [background]     the command goes on in the background once the call is over (`command`): a
 *   {@link BackgroundTask}, which names the call as its `toolId`
 * @property {string} [description]  why, in the agent's words
 * @property {string} [path]         file path (`read`, `write`, `edit`)
 * @property {{ before: string, after: string }[]} [changes]  file changes (`write`, `edit`), made with
 *   `fileChange` from shared/activity-text.js so that only their first lines are kept
 * @property {string} [query]        search text or pattern (`search`, `web`)
 * @property {string} [url]          (`web`)
 * @property {Todo[]} [todos]       the agent's whole to-do list, as it is now (`todo`)
 * @property {true} [stale]          the agent couldn't change the list any more, as its tool lost track of it: what
 *   it shows may be out of date (`todo`)
 * @property {string} [label]        free-form name: a skill, a helper task, a tool, the account to go on in, which
 *   of its project's instructions the agent read or saved, or the conversation a manager messaged, looked at or
 *   invited an agent into (`app`)
 * @property {string} [agent]        the kind of helper that was asked, as its provider names it (`delegate`), or the
 *   service and model of the agent a manager invites, such as "Claude (opus)" (`app`, `invite`)
 * @property {string} [role]         what the agent a manager invites joins as, such as "Reviewer" (`app`, `invite`)
 * @property {string} [prompt]       what the helper was asked, in the agent's words (`delegate`), what the agent
 *   is to be sent when a check-in it set is due (`schedule`), or the first message of a conversation it starts,
 *   the project's instructions it saves, a manager's message, what an agent it invites is to do first, or the brief
 *   it saves (`app`)
 * @property {string} [source]       where a generic tool comes from, e.g. an MCP server
 * @property {'fallback' | 'terminals' | 'conversation' | 'read-instructions' | 'save-instructions' | 'message' | 'invite' | 'look' | 'teams' | 'read-brief' | 'save-brief' | 'read-sources' | 'save-sources' | 'set' | 'cancel' | 'list'} [action]
 *   what the app itself was asked for (`app`, see shared/app-tools.js), or what the agent did about its check-ins
 *   (`schedule`, see shared/check-ins.js)
 * @property {string} [schedule]     when a check-in is due, as a cron expression (`schedule`)
 * @property {boolean} [recurring]   whether it is due again and again (`schedule`)
 * @property {number} [delaySeconds] how long after it was set a check-in that is due once is (`schedule`)
 * @property {number} [count]        how many of them (`app`)
 * @property {boolean} [urgent]      a manager message requests Send now (`app`, `message`)
 * @property {string} [job]          the conversation whose job a project manager hands on with its message (`app`,
 *   `message`)
 * @property {string[]} [names]      what they are to be called, as far as that was said (`app`)
 * @property {boolean} [started]     a conversation the user asked for, so it started at once: one the agent thought
 *   of waits for the user to send it its first message (`app`)
 */

/**
 * One item of an agent's to-do list.
 * @typedef {Object} Todo
 * @property {string} text
 * @property {'pending' | 'in_progress' | 'completed'} status
 * @property {string} [activeForm]  what doing it is called while it is in progress, e.g. "Running the tests"
 * @property {string} [id]          the agent's own id for it, where it changes items one at a time by id
 */

/**
 * Something an agent left running beside the conversation: a command it started in the
 * background, or a watcher that tells it when something happens. Its helpers are not among them.
 * @typedef {Object} BackgroundTask
 * @property {string} id         the provider's own id for it
 * @property {'command' | 'watcher'} kind
 * @property {string} label      what it is for, in the agent's words, or else what it runs
 * @property {string} [command]  what it runs, where that is known
 * @property {string} [toolId]   the call that started it, where there was one
 * @property {'running' | 'done' | 'failed' | 'stopped'} status
 * @property {number} started    when it started
 * @property {number | null} ended  when it ended, once it has
 * @property {string} [summary]  how it went, in the provider's words, once it has ended
 */

/**
 * The end of what a {@link BackgroundTask} printed, as plain text.
 * @typedef {Object} BackgroundOutput
 * @property {string} output
 * @property {boolean} truncated  it is only the end of a longer output
 */

/**
 * @typedef {Object} Question
 * @property {string} question
 * @property {string} [header]
 * @property {{ label: string, description?: string }[]} options
 * @property {boolean} multiSelect
 */

/**
 * A project's instructions an agent wants to save (see main/app-tools.js), for the user to read as a
 * change, and to save, edit first, or not.
 * @typedef {Object} InstructionsChange
 * @property {string} project  the project's name
 * @property {string} part     which of its instructions, as Settings calls them: "Every conversation"
 * @property {string} before   what they are now; '' for none
 * @property {string} after    what the agent wants them to be; '' to take them out
 */

/**
 * What a session asks the user. `kind` picks the UI: an Accept/Decline
 * invitation, a set of questions, a plan to approve, or project instructions to save.
 * @typedef {Object} PermissionRequest
 * @property {'tool' | 'question' | 'plan' | 'instructions'} kind
 * @property {Activity} activity
 * @property {string | null} [title]   a full sentence from the provider, when it has one
 * @property {string | null} [reason]
 * @property {string} [detail]        plain-text details to review before accepting
 * @property {boolean} [canAlways]     whether "Always allow" is offered
 * @property {string} [alwaysLabel]    what "Always allow" says instead, where it covers less: "Allow Computer Use in
 *   TikTok LIVE Studio for this conversation"
 * @property {'conversation'} [alwaysScope]  how long that covers: the rest of the conversation, as its session lasts
 * @property {Question[]} [questions]  (`question`)
 * @property {string} [plan]           Markdown (`plan`)
 * @property {InstructionsChange} [instructions]  (`instructions`)
 */

/**
 * The user's answer to a {@link PermissionRequest}.
 *  - `allow` / `always`: go ahead (and don't ask again for this, if `always`)
 *  - `deny`: stop and wait for the user's next message (like "No" in a terminal)
 *  - `feedback`: don't do it, but carry on using `message`
 *  - `answer`: replies to questions, keyed by question text
 *  - `skip`: no answer to the questions, but carry on with the agent's own best judgment
 *  - `approve-plan`: start working, in permission mode `mode`
 *  - `edit`: go ahead with `text`, the user's own version of what was asked (`instructions`)
 *  - `cancelled`: the prompt went away (interrupt, session closed)
 * @typedef {Object} PermissionResponse
 * @property {'allow' | 'always' | 'deny' | 'feedback' | 'answer' | 'skip' | 'approve-plan' | 'edit' | 'cancelled'} decision
 * @property {string} [message]
 * @property {Record<string, string>} [answers]
 * @property {string} [mode]
 * @property {string} [text]
 */

/**
 * Everything a session can tell the app.
 *
 * `result.costUsd` is the session's running total in US dollars, not the price
 * of that turn; 0 when the provider doesn't say. src/shared/cost.js turns two
 * totals into what a turn cost.
 *
 * `ready.outputStyles` names the output styles the session can answer in, and
 * `ready.outputStyle` the one it is answering in. A provider without output
 * styles leaves both out.
 *
 * `ready.model` is the model the session is answering with, by the id its
 * provider's list of models has for it. `ready.models` is that list, from a
 * provider that can only say so in a conversation: one with `listModels`
 * leaves it out. `ready.effort` is the effort level the session is answering
 * with, from one that can tell. `models` is that list again, from a session whose
 * provider's list changed while it ran, say because a model came out.
 *
 * `ready.fastMode` says whether the session answers in fast mode, from a provider
 * whose models have one: on, off, or paused for a while after a rate limit, and
 * why it is off where something keeps it from coming on.
 *
 * A `delegate` call starts a helper: an agent of the session's own, which works on
 * its own beside it. What the helper does comes as `tool` events with `sub`, each
 * naming in `helper` the `toolId` of the call that started it. That call's
 * `tool-result` is the helper's: it comes when the helper has ended, with its
 * report as `output`, how long it worked as `durationMs` where the provider says,
 * and `stopped` when it was stopped before it was done. A helper can still be at
 * work after the `result` of the turn it was asked in.
 *
 * While helpers work on after that `result`, the session is `idle`: it is not
 * answering. One of them asking for something makes it `waiting`, and `idle` again
 * once the user has answered. A session whose agent then answers on its own, say
 * because a helper reported, says `working` without having been sent anything,
 * and ends that turn with a `result` like any other.
 *
 * `context` says how full the session's context window is: after a turn at the latest, as its
 * agent goes where it can tell, and whenever it was asked for its {@link Usage}. A provider whose
 * sessions can't tell says none.
 *
 * `limits` says how much of the plan's limits its login has used, whenever the session hears: as
 * its agent goes, and whenever it was asked for its {@link Usage}. Those it heard of, which may be
 * fewer than `Usage` lists; an empty list for a login without a plan. `account` says which of the
 * user's logins they are of, by its id (see {@link Account}); left out for the user's own, as by a
 * provider with one login. A provider whose sessions can't tell says none.
 *
 * `drafting` says which tool call the agent is writing out, before its `tool` event comes with
 * the whole of it: a long file, command or plan takes a while. `activity` is as much of the call as
 * is known yet, a file's path once it is there, and the event comes again as that grows. Its
 * `toolId` is the one the call's `tool` event will have. A provider that can't tell says none.
 *
 * `check-ins` lists what the agent has set itself to be woken for later, whenever that
 * changes: all of them, an empty list once none are left. They go with its session. One
 * that is due starts a turn nobody sent anything for, and the session says so first with a
 * `notice`. A provider whose agents can't set any says none.
 *
 * `background` lists what the agent left running in the background, and what ran there and has
 * ended since the session started: all of it, whenever any of it changes. What is still running
 * when the session's agent is gone ends with it, as `stopped`. A provider whose agents leave
 * nothing running says none.
 *
 * `waiting` says how many of the messages the session was sent wait for the turn going on before
 * its agent reads them, whenever that changes: 0 once it has read them all, or they are gone with
 * its agent. A provider whose agents read a message as soon as it is sent says none.
 *
 * `tool-result.pictures` are what a call handed the agent to look at, such as a screenshot or a
 * picture file it read, as data: URLs, for the user to see too. A provider that can't tell says none.
 *
 * `result.failureKind` says why a turn failed, where the provider can tell, for the app to act on. `unavailable`:
 * the provider answered that it can't take the request (overloaded, a 5xx), and twice in ten minutes starts a
 * fallback that takes over after outages. `offline`: no answer came back at all (the provider's name didn't
 * resolve, or the connection was refused or cut), as when the internet is down. No other service would get an
 * answer either, so no fallback takes over, and `errorText` says the internet looks down (see offline.js).
 * @typedef {(
 *   { type: 'state', state: SessionState } |
 *   { type: 'ready', sessionId: string, model: string, permissionMode: string, commands: string[], outputStyles?: string[], outputStyle?: string | null, models?: ModelOption[], effort?: string | null, fastMode?: FastModeStatus } |
 *   { type: 'models', models: ModelOption[] } |
 *   { type: 'mode', mode: string } |
 *   { type: 'text-start', key: string } |
 *   { type: 'text-delta', key: string, text: string } |
 *   { type: 'text-end', key: string, text: string } |
 *   { type: 'drafting', toolId: string, activity: Activity } |
 *   { type: 'tool', toolId: string, activity: Activity, sub: boolean, helper?: string } |
 *   { type: 'tool-result', toolId: string, isError: boolean, declined: boolean, output: string, pictures?: string[], stopped?: true, skipped?: true, durationMs?: number } |
 *   ({ type: 'permission', requestId: string } & PermissionRequest) |
 *   { type: 'permission-resolved', requestId: string, decision: PermissionResponse['decision'], answers?: Record<string, string> } |
 *   { type: 'result', isError: boolean, stopped: boolean, errorText: string, usageLimited?: true, limitKind?: 'session' | 'weekly', failureKind?: 'unavailable' | 'offline', durationMs: number, costUsd: number } |
 *   { type: 'session-reset' } |
 *   { type: 'context', used: number, size: number } |
 *   { type: 'limits', limits: UsageLimit[], account?: string } |
 *   { type: 'check-ins', checkIns: import('../shared/check-ins.js').CheckIn[] } |
 *   { type: 'background', tasks: BackgroundTask[] } |
 *   { type: 'waiting', count: number } |
 *   { type: 'notice', text: string } |
 *   { type: 'error', message: string }
 * )} SessionEvent
 */

/**
 * Someone answering in a conversation: the contact it belongs to, its host, or a
 * contact invited in as a guest. Each has a session of its own there.
 * @typedef {Object} Participant
 * @property {string} id               the contact's id
 * @property {string} name
 * @property {string} avatar           display picture id
 * @property {ProviderDescriptor} provider
 * @property {string} permissionMode   its mode in this conversation
 * @property {string} model            the model it was given; '' for its provider's own default
 * @property {string | null} defaultModel  the model that default comes to, once a session has said
 * @property {ModelOption[]} models    the models its session said it has; empty from a provider that is asked itself
 * @property {string | null} effort    the effort level it answers with, when that is known
 * @property {true} [effortPicked]     that level was picked for it in this conversation, by an agent here
 * @property {boolean} fastMode        it answers in fast mode where its model has one: the contact's own choice
 * @property {true} [fastModeInherited] Codex's speed is still inherited from its settings; fastMode reflects its last report
 * @property {FastModeStatus | null} fastModeStatus  what its session last said of fast mode; null while none
 *   has said since it was switched, or since the model was
 * @property {SessionState} state
 * @property {boolean} host            the contact whose conversation, folder and window it is
 * @property {{ used: number, size: number } | null} [context]  its context in this conversation, when supported
 * @property {UsageLimit[]} [limits]   its current login's plan usage, when supported
 * @property {string} [account]        the id of that login, with the limits: the one a fallback pinned it to, or
 *   else the one in use. '' for the user's own
 * @property {true} [paused]           it sits out this conversation: only a mention from the user gives it a turn.
 *   Never a contact on its own, which answers whatever you say
 * @property {true} [unlisted]         a guest made for this conversation alone: it is on no contact list, and
 *   is deleted when it leaves
 * @property {true} [afterChanges]     its role has it answer once the others are done, when they changed files
 * @property {true} [readOnly]         its role, or a manager's conversation, keeps it from changing files,
 *   whatever its mode says
 * @property {true} [readOnlyHere]     a guest of a manager's conversation, which changes no files: it works
 *   read-only there, and its mode stays the one it does that in (see readOnlyPermissionMode in
 *   shared/limit-fallbacks.js)
 * @property {string} [agent]          the agent definition of the user's it runs as (see {@link CustomAgent})
 * @property {string} [invitedBy]      the project's manager that invited it into this worker's conversation, by name
 * @property {import('../shared/check-ins.js').CheckIn[]} [checkIns]  what its session has set itself to be
 *   woken for later. Left out while there is nothing
 * @property {BackgroundTask[]} [background]  what its session left running in the background, and what ran
 *   there and ended. Left out while there is nothing
 * @property {import('../shared/doing.js').Now} [doing]  what it is doing, while it is at work. Left out
 *   otherwise
 */

/**
 * What a conversation window is sent. A provider emits none of the additions here: a
 * session only knows about itself, and the app adds them on the way to the window.
 *  - Every {@link SessionEvent} says who it is from in `speaker`, a participant's
 *    contact id. A guest's `key`, `toolId` and `helper` start with that id too, so those of
 *    two sessions never collide in one window. A `state` event also carries `overall`: the
 *    state of the conversation as one, as in the snapshot the window opened with. An event that
 *    changes what its participant is doing carries `doing`: what that is now, or null once it
 *    is not at work. A `text-end` whose reply was kept carries `entryId`: the reply's entry in
 *    the conversation's history, by which it can be pinned.
 *  - `participants` follows whenever someone joins or leaves, or a participant's name,
 *    picture, mode or check-ins change, or one is paused or resumed.
 *  - A `notice` without a `speaker` is a line from the app itself ("Codex has been
 *    added to the conversation.").
 *  - `waiting` without a `speaker` counts the user's newest messages nobody here has read yet,
 *    whenever that changes: what waits in its sessions, and what waits for a turn. `inLine` says
 *    they wait for a turn, where any of them can be taken back. `moved`, once some of them are
 *    read: all that waited, by entry id, which the conversation's history has moved to its end. A
 *    `ids`, when available, is authoritative queue membership even before a new bubble has been
 *    drawn or received its history identity. `to`, with `ids` where guests are here: who each of them is for, by
 *    entry id, as participant ids. A session's own `waiting` is not passed on.
 *  - `limits` without a `speaker` is how much of the plan's limits the login the host is in has
 *    used, whenever a session in that login says so, in this conversation or another, and whenever
 *    another login is put in use. With a `speaker`, it describes that guest's login instead. `account` is the
 *    id of that login: the one a fallback pinned the participant to, or else the one in use.
 *    A session's own `limits` is not passed on.
 *  - `suggestions` follows a turn that ended with a reply: `nextMessage` is the message the user would most
 *    likely send next, as they would type it ("commit it and open a pr"), and to a reply that asked them
 *    something, `replies` are a few they might send to it ("Yes, commit it"), `nextMessage` the first of
 *    them. While they haven't said anything since.
 * @typedef {(
 *   (Exclude<SessionEvent, { type: 'waiting' | 'limits' }> & { speaker: string, overall?: SessionState, doing?: import('../shared/doing.js').Now | null, entryId?: string }) |
 *   { type: 'participants', participants: Participant[] } |
 *   { type: 'user-message', entry: import('../main/storage/history.js').HistoryEntry } |
 *   { type: 'notice', text: string } |
 *   { type: 'waiting', count: number, ids?: string[], inLine?: true, moved?: string[], to?: Record<string, string[]> } |
 *   { type: 'limits', limits: UsageLimit[], account: string, speaker?: string } |
 *   { type: 'suggestions', replies: string[], nextMessage: string }
 * )} WindowEvent
 */

/**
 * @typedef {Object} OutgoingMessage
 * @property {string} text
 * @property {{ mediaType: string, data: string }[]} [images]  base64 pictures
 * @property {string} [id]  the message's id in the conversation's history, a UUID: the message the user
 *   may edit or take back while queued. A session that can `rewind` or `cancelQueued` keeps it with the
 *   message. Left out of a message that does neither, as one that relays what other agents said
 * @property {string} [asked]  in a conversation with several agents, where `text` also relays what the
 *   others said: the user's newest message on its own. A provider sends `text`; only the scripted demo
 *   session reads this, to pick its script.
 * @property {{ name: string, levels: string[] }[]} [check]  an effort check, which `text` spells out: the
 *   agents to pick a level for, and the ones each takes, lowest first. Again only the demo session reads it.
 */

/**
 * An MCP server a session has, as that session sees it.
 * @typedef {Object} McpServer
 * @property {string} name     what its provider calls it: also how it is named to `mcpAct`
 * @property {'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled'} status
 * @property {string} [error]    why it failed
 * @property {string} [address]  its URL, or the command that starts it
 * @property {string} [origin]   where it is set up, in a few words: a plugin, the project, the user's own settings
 * @property {number} [tools]    how many tools it gives the agent, once connected
 */

/**
 * Something in a session's context window, or room in it that is set aside.
 * @typedef {Object} ContextPart
 * @property {string} name     as its provider calls it: "Messages", "System tools"
 * @property {number} tokens
 * @property {'used' | 'reserved'} kind  `reserved`: kept free, for tidying up the conversation when it fills
 */

/**
 * How full a session's context window is.
 * @typedef {Object} ContextUsage
 * @property {number} used     tokens in the window right now
 * @property {number} size     tokens the window holds. 0 while that is not known, as before a
 *   provider that only says after a request to its model has made one
 * @property {ContextPart[]} parts  what fills it, in its provider's order. What is left is free
 */

/**
 * One limit of the plan a session's login is on.
 * @typedef {Object} UsageLimit
 * @property {'session' | 'weekly' | 'model'} kind  the hours it is working in, the week, or the week for one model
 * @property {string} [model]  whose it is (`model`), as its provider names it
 * @property {number} percent  how much of it is used, 0-100
 * @property {number | null} resetsAt  when it starts over, in milliseconds since 1970
 */

/**
 * What the login spends once the plan's limits are reached, so its agents keep going: Claude's extra
 * usage, money spent against a monthly cap, or a balance of Codex's credits.
 * @typedef {Object} ExtraUsage
 * @property {boolean} on            it is spent once a limit is reached
 * @property {string} [reason]       why it is off, in Claude Code's words ('out_of_credits', 'org_level_disabled', ...)
 * @property {string} [currency]     what `used` and `limit` are in: 'USD'
 * @property {number | null} [used]  spent this month, in whole units of `currency` (12.4 is $12.40)
 * @property {number | null} [limit] the most that may be spent in a month. Null for no cap
 * @property {number} [percent]      how much of `limit` is spent, 0-100
 * @property {number} [credits]      what is left, where it is the service's own credits rather than money
 * @property {true} [unlimited]      there is no end to it
 */

/**
 * What `/context` and `/usage` show in a terminal.
 * @typedef {Object} Usage
 * @property {ContextUsage} context
 * @property {string | null} plan    the plan the limits are of, as its provider names it ("max")
 * @property {UsageLimit[]} limits   empty for a login without a plan: an API key, say
 * @property {true} [paidUsageBlocked] provider-enforced restriction for the whole turn, never inferred from a balance
 * @property {ExtraUsage} [extra]    what is spent past the limits. Left out where the provider says nothing of it
 * @property {string} [account]      whose login it is, as the provider names it: an email address, with its
 *   organization and plan where it says them ("me@example.com (Acme · Team)"). Left out where it doesn't say
 * @property {true} [pinned]           added by the app: a fallback keeps the participant in another of its provider's
 *   logins than the one in use, which these limits are of
 */

/**
 * How one of a provider's logins stands, as its CLI says.
 * @typedef {Object} AccountStatus
 * @property {boolean} [signedIn] absent when the sign-in check could not complete
 * @property {string} [error] safe explanation of a failed check, without raw provider diagnostics
 * @property {string} email  '' when the CLI doesn't say, as for an API key
 * @property {string | null} plan  the subscription it is on, as the provider names it ("max")
 * @property {boolean} [eligible] confirmed signed-in subscription authentication for proactive switching;
 *   missing or false never qualifies. Does not grant paid-usage consent or restrict manual selection
 * @property {string} [orgId]  the organization selected when signing in; one email can have several
 * @property {string} [orgName]  the selected organization's display name
 */

/**
 * What the app can do with a provider's logins. Each is kept in a folder of its own, and known by it:
 * '' is the user's own, the one the CLI uses in a terminal.
 * @typedef {Object} AccountOps
 * @property {(dir: string) => Promise<AccountStatus>} status  never rejects
 * @property {(dir: string, opts: { way: string, signal?: AbortSignal }) => Promise<import('./setup.js').SignInResult>} signIn
 *   signs a login in through the browser, as the provider's own `signIn` does. `way`: one of the descriptor's `signIn`
 * @property {(dir: string) => Promise<void>} signOut  forgets the login, where the CLI keeps it outside the folder too
 * @property {(dir: string) => void} prepare  makes a folder ready to be used, sharing what the user set up in their own
 * @property {(dir: string) => Promise<object>} [quota] read-only identity and quota snapshot, without sending a prompt
 * @property {(dir: string) => Promise<UsageLimit[] | null>} [limits]  how much of its plan's limits a login has used,
 *   asked of it: none where it has no plan, null where it couldn't be asked. Never rejects
 */

/**
 * One of the user's logins, as a session knows it.
 * @typedef {Object} Account
 * @property {string} id    '' for the user's own
 * @property {string} dir   its folder; '' for the user's own
 * @property {string} name  what the user knows it by: its email address, where that is known
 */

/**
 * The logins a provider's sessions can go on in, as the app keeps them. Every session starts in the one
 * in use. A session whose account reaches a limit offers to go on in another, and asks first unless the
 * user enabled automatic switching in Settings > Accounts. A fallback-managed session instead pins one account:
 * next returns null, automatic returns false, and use leaves the shared login unchanged.
 * @typedef {Object} AccountSwitch
 * @property {() => Account} current  the one in use
 * @property {(tried: Set<string>) => Account | null} next  another to go on in, none of the ones `tried`
 *   by id; null when there is none
 * @property {(id: string) => void} use  puts one in use, for every session from its next message on
 * @property {() => boolean} [proactive] whether to check at the next ordinary turn
 * @property {(session: object) => (() => void)} [watch] register an ordinary session for safe-boundary coordination
 * @property {(session: object, dispatch: () => void, valid: () => boolean) => void} [beforeTurn] optional proactive gate; absent for pinned fallbacks
 * @property {() => boolean} automatic  whether a session goes on in the next one without asking
 */

/**
 * One conversation with an agent working in `contact.cwd`.
 * @typedef {Object} AgentSession
 * @property {SessionState} state
 * @property {(message: OutgoingMessage) => void} send
 * @property {number} waiting  how many of the messages it was sent wait for the turn going on (see `waiting`
 *   in {@link SessionEvent})
 * @property {(id?: string, options?: { signal?: AbortSignal }) => Promise<void>} sendNow  stops the turn for the selected queued message; without
 *   an id, keeps FIFO. A stale id does nothing. Aborting the signal releases the retry guard without dropping queued messages
 * @property {string[]} [queuedIds]  identities of queued messages, in dispatch order
 * @property {(id: string) => Promise<boolean>} [cancel]  takes back the message sent with `id` while it waits: its
 *   agent never reads it, and the turn going on goes on. Whether it was taken back: not one the agent has read
 *   since. From a provider that says `rewind` or `cancelQueued`, whose messages are sent with an id
 * @property {(requestId: string, response: PermissionResponse) => void} respond
 * @property {() => Promise<void>} interrupt
 * @property {(toolId: string) => Promise<void>} stopHelper  stops one helper, named by the `toolId` of the call
 *   that started it. The turn it was asked in goes on
 * @property {(id: string) => Promise<void>} stopBackground  stops one of its {@link BackgroundTask}s. The agent
 *   is told, and goes on without it
 * @property {(id: string) => Promise<BackgroundOutput | null>} backgroundOutput  the end of what one of them
 *   printed. Null where that can't be read, as after its agent is gone
 * @property {(id: string) => Promise<void>} [rewind]  goes back to just before the message sent with `id`:
 *   its agent forgets that message and everything after it, and the next `send` goes on from there. Whatever
 *   the agent was doing stops, its helpers and what it left running in the background with it. Rejects,
 *   changing nothing, for a message it can't go back to. Only from a provider that says `rewind`
 * @property {(reply: { text: string, later: number }) => Promise<string>} [fork]  a copy of its conversation up to
 *   and including one of its agent's replies, for another contact to go on with apart from it: the id of the copy's
 *   session, which a session resumes. Its own conversation stays as it is. `reply`: what the reply says, and how
 *   many of the agent's replies after it say the same. Rejects for a reply it no longer has. Only from a provider
 *   that says `fork`
 * @property {(mode: string) => Promise<void>} setPermissionMode
 * @property {(model: string) => Promise<void>} setModel  '' goes back to the provider's own default
 * @property {(effort: string | null) => Promise<void>} setEffort  one of the model's `efforts`, or null to leave it to the model
 * @property {(style: string) => Promise<void>} setOutputStyle  one of `ready.outputStyles`
 * @property {(on: boolean) => Promise<void>} setFastMode  for a model with `fast`; the others answer as they always do
 * @property {() => Promise<McpServer[]>} mcpServers  its MCP servers right now. Asking starts the agent if it
 *   wasn't running, without sending it anything
 * @property {(name: string, action: import('../shared/mcp.js').McpAction) => Promise<{ url: string } | void>} mcpAct
 *   reconnects a server, turns it off or on, or starts signing in to it: `url` is then the page to finish on
 * @property {() => Promise<Usage | null>} usage  how full its context window is and with what, and how much of
 *   the plan's limits is used: of the login in use, also while the agent is still in another until its turn is
 *   over. Asking starts the agent, as `mcpServers` does. Null from a provider that can't tell
 * @property {() => void} [accountSwitched]  another of its provider's logins was put in use: one in the middle of a
 *   turn says it goes on in the one before until the turn is over. Only from a provider with `accounts`
 * @property {() => void} close
 */

/**
 * The parts of a contact a session uses. Sessions may update `sessionId`,
 * `permissionMode` and `model`, and forget an `outputStyle` that is gone; the
 * app persists them from events. Its `effort` is only read, as the level to
 * start with: `setEffort` changes the session's, not the contact's.
 * @typedef {Object} SessionContact
 * @property {string} [accountId] the account a fallback's continuation is pinned to (empty for the terminal login).
 *   Only with `fallbackManaged`; without one, the session is in the account in use
 * @property {boolean} [fallbackManaged] suppress provider-level automatic account retries
 * @property {string} cwd
 * @property {string} [model]
 * @property {string | null} [effort]    the effort level to answer with; the model's own if unset
 * @property {string} permissionMode
 * @property {string | null} sessionId   provider session to resume
 * @property {string | null} [outputStyle]  the output style to answer in; the user's own default if unset
 * @property {boolean} [fastMode]        fast where supported; Codex false explicitly clears its configured tier
 * @property {true} [readOnly]           it doesn't change files, as a role can say (see shared/teams.js), and as
 *   a project's manager and the guests of its conversation don't, whatever `permissionMode` says: Claude goes
 *   without the tools that write files, runs its commands in Claude Code's sandbox, which writes none of its folders,
 *   and is told no to the commands it asks about, Codex works in its read-only
 *   sandbox and is told no to every request to run a command with more access, and an agent over ACP is put in its
 *   `readOnlyMode`, where it has one, and is told no to the file changes and commands it asks for. No approval
 *   undoes it, in any mode
 * @property {string[]} [readDirs]       folders besides its own it reads in, as a project's manager reads in its
 *   workers' worktrees (see main/managers.js). Only a provider with the app's tools reads this
 * @property {string} [agent]            the agent definition of the user's it runs as, by name (see
 *   {@link CustomAgent}). Only a provider with `customAgents` reads this
 */

/**
 * An agent the user defined for a provider's agent to run as: for Claude Code, a custom agent in .claude/agents.
 * It is not a role (shared/teams.js), which is the app's: the provider keeps this one, with its own prompt, tools
 * and model, and the app only knows it by name.
 * @typedef {Object} CustomAgent
 * @property {string} provider       whose agent it is, by id
 * @property {string} name           what it is run by, and the nickname a guest made from it starts with
 * @property {string} description    when to use it, in the words of its definition
 * @property {string} [model]        the model its definition picks: an alias, a model's id, or 'inherit'
 * @property {'project' | 'personal'} source  defined in the project, or in the user's own config folder
 */

/**
 * @typedef {Object} PermissionModeOption
 * @property {string} id
 * @property {string} label    menu text
 * @property {string} short    badge text
 * @property {boolean} [danger]
 */

/**
 * @typedef {Object} OutputStyleOption
 * @property {string} id       the style's name, as sessions report it
 * @property {string} label    menu text
 */

/**
 * @typedef {Object} ModelOption
 * @property {string} id       the name the agent knows the model by; '' is the one its own settings choose
 * @property {string} label    its name in the list of models
 * @property {string} [hint]   a few words shown next to the name
 * @property {string[]} [efforts]  the effort levels it takes, lowest first, from a provider that says; left out
 *   by a model that takes none
 * @property {string} [defaultEffort]  the level it answers with when given none, from a provider that says
 * @property {boolean} [default]  the model the provider picks for a contact that was given none
 * @property {boolean} [fast] the provider reports Fast mode support and whether it is allowed
 * @property {string} [fastDescription] provider's speed/usage explanation, when available
 * @property {string} [fastUnavailable] why this provider/model cannot offer Fast mode
 */

/**
 * What a session says of fast mode.
 * @typedef {Object} FastModeStatus
 * @property {'on' | 'off' | 'cooldown'} state  cooldown: paused after a rate limit, until it comes back on by itself
 * @property {string} [reason]  why it is off where something keeps it from coming on, in the provider's words
 *   (Claude Code's: 'free', 'extra_usage_disabled', ...)
 */

/**
 * Serializable description of a provider, sent to the windows.
 * @typedef {Object} ProviderDescriptor
 * @property {string} id
 * @property {string} name                  e.g. "Claude"
 * @property {string} avatar                default picture id (the windows know how to draw it)
 * @property {{ id: string, label: string }[]} avatars  pictures a contact can pick from
 * @property {PermissionModeOption[]} permissionModes
 * @property {string} defaultPermissionMode
 * @property {string} [readOnlyMode]  its mode that changes no files, for an agent whose role says so. Without one,
 *   the session keeps that agent from changing files itself (see `readOnly` on SessionContact)
 * @property {true} [readOnlyEveryMode]  its sessions keep an agent that changes no files from changing them in any of
 *   its modes, Never ask included, in a sandbox that writes nothing (see `readOnly` on SessionContact): a role that
 *   changes no files can have it start in any (see roleMode in shared/teams.js). Left out by a provider whose agent
 *   is kept from it by its mode, which it then works in
 * @property {{ mode: string, label: string, primary?: boolean }[]} planApprovals
 * @property {string[]} commonCommands    slash commands to offer before a session reports its own
 * @property {boolean} [appTools]          its agent can be given the app's own tools (main/app-tools.js), such as
 *   opening terminals beside the conversation; left out by a provider that can't give its agent any
 * @property {boolean} [helpers]           its agent hands parts of a job to helpers, and its sessions say what
 *   each of them does (see {@link SessionEvent}); left out by a provider whose sessions don't
 * @property {boolean} [checkIns]          its agent sets itself check-ins, and its sessions list them (`check-ins`,
 *   see {@link SessionEvent}); left out by a provider whose agents can't
 * @property {boolean} [background]        its agent leaves commands and watchers running in the background, and its
 *   sessions list them (`background`, see {@link SessionEvent}); left out by a provider whose agents don't
 * @property {OutputStyleOption[]} [outputStyles]  output styles to offer before a session reports its own; left out by a provider that has none
 * @property {boolean} [mcp]               its sessions can say which MCP servers they have, and act on them: the
 *   app then answers `/mcp` itself, with a list. Left out by a provider whose `/mcp` is its agent's to answer
 * @property {boolean} [usage]             its sessions can say how full their context window is (see
 *   {@link Usage}): the window then has a meter for it, and answers `/context` and `/usage` itself
 * @property {boolean} [cancelQueued]      its sessions can take back messages kept in a local queue before sending them
 * @property {boolean} [rewind]            its sessions can go back to just before a message the user sent
 *   (see {@link AgentSession}'s `rewind`): the window then lets the user edit what they sent, or rewind to it. Left out by a
 *   provider whose sessions can't
 * @property {boolean} [fork]              its sessions can copy their conversation up to one of their agent's replies
 *   (see {@link AgentSession}'s `fork`): the window then offers to fork the chat from a reply, into a contact of its
 *   own. Left out by a provider whose sessions can't
 * @property {string} [customAgents]       its sessions can run as one of the user's own agent definitions (`agent`
 *   on SessionContact), which the provider lists (see {@link Provider}'s `listAgents`): Invite offers them under
 *   Your agents. What the program whose files they are is called, such as "Claude Code", which each is tagged
 *   with there. Left out by a provider that has none
 * @property {ModelOption[]} modelSuggestions  the default ('') first, then the models offered until the user
 *   chooses their own from the provider's full list; any other can be typed
 * @property {string} modelPlaceholder      shown in the box a model is searched for, or typed, in
 * @property {string[]} [efforts]           effort levels to offer while the provider hasn't said which each model
 *   takes; left out by a provider that has none
 * @property {boolean} [modelsByFolder]     which model and effort level its sessions answer with when given none
 *   can change from one folder to another, and from one moment to the next: its list (see {@link Provider}'s
 *   `listModels`) is asked for again in the folder a contact works in. Left out by a provider whose list is the
 *   same everywhere
 * @property {SignInWay[]} [signIn]        the ways to sign in that the app can start itself (see
 *   {@link Provider}'s `signIn`), the usual one first; left out by a provider that is signed in to in a terminal
 * @property {boolean} [accounts]           the app can sign it in to more than one account, and a conversation
 *   can go on in another when one reaches a limit (see {@link Provider}'s `accounts`); left out by a provider
 *   with one login
 * @property {string} loginHint             plain text, shown when sign-in fails
 */

/**
 * A way to sign in to a provider from the app, as the welcome wizard offers it.
 * @typedef {Object} SignInWay
 * @property {string} id
 * @property {string} label
 * @property {string} [hint]  a few words about who it is for
 */

/**
 * @typedef {Object} Provider
 * @property {ProviderDescriptor} descriptor
 * @property {(opts: { contact: SessionContact, emit: (event: SessionEvent) => void, conversation?: string, env?: Record<string, string>, instructions?: string, mainFolder?: string, todos?: Todo[] }) => AgentSession} createSession
 *   `conversation`: the contact whose conversation the session answers in. Its own, unless it is a guest there.
 *   `env`: variables its agent is started with on top of the app's own. `instructions`: what the project of
 *   its folder wants the agent told before anything is asked. `mainFolder`: for a folder in a worktree, the
 *   same folder in the project's main checkout. An agent that can be told so reads its settings for the
 *   project from there, not from the worktree, whose branch may be someone else's pull request. `todos`: its
 *   to-do list as the conversation last showed it, for an agent that goes on with the list it kept and only
 *   says what changed in it
 * @property {(entry: object) => object} [upgradeHistoryEntry]  migrates history saved by older versions
 * @property {(where?: { cwd: string, mainFolder?: string, env?: Record<string, string> }) => Promise<ModelOption[]>} [listModels]
 *   the models the agent itself says it has, without the default; left out by a provider that can only say so in
 *   a conversation. Until it answers, and when it fails, the descriptor's `modelSuggestions` stand in. `where`: a
 *   folder, for a provider with `modelsByFolder`, whose list then says which model and effort level a session
 *   there answers with when given none. `mainFolder` and `env` as for createSession
 * @property {(where: { cwd: string, mainFolder?: string }) => Promise<Omit<CustomAgent, 'provider'>[]>} [listAgents]
 *   the agents the user defined that a session in `cwd` can run as: the project's first, then the user's own.
 *   `mainFolder` as for createSession. Left out by a provider without `customAgents`
 * @property {(message: string) => Promise<string>} [nameTask]  a few words for the task a message asks for,
 *   from a quick model of its own, for a contact's branch to be named after (see main/branch-naming.js).
 *   Left out by a provider that has none to ask; the words of the message then stand in.
 * @property {(reply: string, opts?: { asks?: boolean, model?: string }) => Promise<string[]>} [suggestReplies]  what
 *   the user might send after a reply, from a quick model of its own (see suggest-replies.js). To one that `asks`
 *   them something, a few replies for the conversation to offer under it; to any other, the one message they would
 *   most likely send next, for the empty message box (see main/conversations.js). `model`: the conversation's, for
 *   a provider whose account may have no quick model to ask instead. None when the model sees nothing to say. Left
 *   out by a provider that has none to ask.
 * @property {() => Promise<import('./setup.js').Setup>} [checkSetup]  whether its CLI is on this computer and
 *   signed in, asked without starting a session (see setup.js). The welcome wizard lists the answer, with what
 *   to do about it; left out, the wizard says it could not be checked.
 * @property {(opts: { way: string, signal?: AbortSignal }) => Promise<import('./setup.js').SignInResult>} [signIn]
 *   signs its CLI in without a terminal: the CLI opens the browser, and this answers once the user is done
 *   there, or once `signal` calls it off (see setup.js). `way`: one of the descriptor's `signIn`. Left out by a
 *   provider whose CLI needs a terminal to sign in; the wizard then only says which command does it.
 * @property {Elsewhere} [elsewhere]  the conversations held with its agent outside the app; left out by a
 *   provider whose agent keeps none that can be read
 * @property {AccountOps} [accounts]  its logins, each in a folder of its own; left out by a provider with one
 *   login. Its sessions start in the one the app's {@link AccountSwitch} has in use
 */

/**
 * Where a provider's agent keeps the conversations it had outside the app, in a terminal say, and how they
 * are read. They stay the agent's own: the app lists them in a contact's message history, and changes nothing.
 * To go on with one, it makes a copy of its own.
 * @typedef {Object} Elsewhere
 * @property {string} name  what they were held in, as the windows name it: "Claude Code"
 * @property {(cwd: string) => Promise<HeldElsewhere[]>} list  the ones held in a folder, without the app's own
 * @property {() => Promise<HeldElsewhere[]>} [listAll]  the ones held in every folder, without the app's own: what
 *   every contact's message history lists under the agent's name, also of folders no contact works in
 * @property {(cwd: string, id: string) => Promise<{ id: string, cwd: string, entries: import('../main/storage/history.js').HistoryEntry[] } | null>} read
 *   one of them, whole, as the entries a conversation window is drawn from; null for one that is not that folder's.
 *   Rejects for one that is there but can't be read
 * @property {(cwd: string, id: string) => Promise<string>} fork  a copy of one of them held in that folder, for the
 *   app to go on with: the id of the copy's session, which a session resumes. Rejects for one it can't copy
 */

/**
 * @typedef {Object} HeldElsewhere
 * @property {string} id
 * @property {string} cwd        the folder it was held in
 * @property {number} startedAt
 * @property {number} endedAt
 * @property {string} preview    its first message, on one line
 * @property {string} [title]    what it was named, when that says more than its first message
 * @property {string} [branch]   the git branch it ended on
 */

export {};
