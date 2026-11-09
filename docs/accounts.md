# Accounts

A Claude contact answers in your Claude login, the same one as `claude` in your terminal. You can add more accounts, such as a personal one beside your work one. When the account in use reaches its session or weekly limit, a conversation can go on in the next one.

## Adding an account

**Tools > Settings... > Accounts** lists your accounts. **Terminal login** is always first: it is the login Claude Code uses in your terminal. Its row shows the email and organization when known, with a one-line explanation underneath.

1. Pick how to sign in, if there is a choice, and press **Add account...**.
2. Your browser opens on Claude's sign-in page. Choose the account or organization you want to add. A personal account and a team account can use the same email address.
3. The account is listed with its email address once you are back, with its organization and plan when Claude reports them. Those details also appear when you switch accounts and in the usage meter. Claude Code calls both Max plans "max": the app tells them apart by the rate-limit tier Claude Code keeps with the login in its `.claude.json` (only that field, the email and the organization are read, and nothing is written), and calls Max 20x **Ultra** and Max 5x **Max**, as Anthropic has named them since 30 October 2026. Where the tier can't be read the plan stays **Max**. An account whose sign-in can't be confirmed is not added: add it again.

The same account in the same organization is not added twice. If it is already listed, choose another account or organization in your browser.

Your terminal login can still become one you added, for example after `claude /login` in a terminal to that account. The Accounts page then marks the added one **same account as terminal login**. Both signed-in rows share the newest successful usage reading when their organization IDs match. The added copy has no **Use** of its own, and **Switch account...** lists that login once. **Remove** takes the copy away. If it was in use, the terminal login is in use from then on.

## Quota dashboard

Open **Account settings** from a conversation’s usage popover to go straight to this page, even while its reading is loading. In the conversation, a session or weekly reading above 100% says **over limit** and keeps the reported percentage visible; the bar stays inside its track. A reading just below 100% is not rounded up to an exhausted allowance, and a missing reading says **Unknown**. These displays do not change account switching or spending rules.

**Settings > Accounts** shows each login’s session, weekly and reported model-specific windows. Figures say **used** and **remaining**, with each reset time, sign-in state and refresh age. Missing readings are **unknown**, never zero. Once a reset passes, its old reading is no longer treated as available allowance.

**Refresh** checks the accounts without sending a prompt or starting a model turn. Open Accounts pages refresh once a minute while visible. All windows share a main-process cache: at most two probes run together, requests for the same account coalesce, and repeated refreshes wait at least 30 seconds. Failed checks back off from one minute to five minutes, or longer when Claude supplies a retry delay. A failed check keeps only safe display details from the selected Claude config, never credentials. Saved details alone do not confirm sign-in or qualify automatic switching. Sign-out, an unreadable Keychain, a missing Claude Code, a timeout and usage-check rate limits have separate explanations. A reading older than one minute is stale; unknown, failed and stale readings cannot qualify a switch.

## Switching before a limit

**Switch accounts before a usage limit** is a separate, explicit opt-in, **off by default**. Its starting threshold is **90% used**, configurable on the Accounts page. Before a new ordinary Claude turn, if a known window reaches that threshold, buddylist looks for another signed-in subscription account in the existing account order. Every reported window must have a fresh reading, a future reset, and usage at least ten percentage points below the threshold. This conservatively checks all reported models, including ones the next turn might use. Same-login copies, unknown or exhausted allowances, and API-key logins do not qualify.

The choice is coordinated across Claude conversations. An active turn, permission question, helper, background command, watcher or check-in defers rotation; none is stopped for it. Pending sends share a single decision and recheck identity, subscription sign-in and allowance before dispatch. If either account changes to an API key, loses its subscription or cannot confirm its sign-in method, the current account stays in use even when its email and organization are unchanged. A check gets up to eight seconds before the message continues with the current choice. If no account qualifies, it stays in use and the Accounts page explains why. A successful switch leaves a line in the conversation. Five minutes must pass between choices, including a manual **Use**, to avoid switching back and forth. Turning the option off or changing/removing a login while a check waits cancels that decision.

Conversation history, worktree, permissions and session resume stay as they are. Account-pinned fallback continuations keep their selected account and their existing spending checks. A project with explicit provider credentials is not rotated. Switching is not permission for paid usage: a usage reading is a snapshot, not a spending cap, and provider billing settings and **Fallbacks** spending rules still apply. This option does not select API-key billing. Your terminal login is unchanged.

**Automatically switch accounts at usage limits** remains independent: it controls the existing retry after Claude rejects a turn. Enabling either option does not enable the other.

## Disconnecting an account

**Remove** signs an added account out and forgets it. **Disconnect** on **Terminal login** signs it out of both buddylist and Claude Code in your terminal. It keeps your Claude settings and conversations, and the row stays in the list as **signed out**.

If the terminal login was in use, buddylist selects the first added account that is still signed in, when there is one. An added account already in use stays selected. A signed-out account, the terminal login or an added one, is skipped when a conversation offers to switch after a usage limit.

## Switching

**Use** on the Accounts page, or **Switch account...** under the usage meter at the end of a conversation's status bar, puts another account in use. That holds for every Claude contact. Each conversation moves to it with its next message, or right away when the meter asks it how full it is.

Every window shows the account now in use straight away, wherever you switched, also after a switch when a limit is reached. The Session and Weekly meters in each status bar show what that account used the last time you were in it, and a moment later what Claude says it has used now. The Session tab and the Accounts page mark it as the one in use.

A conversation in the middle of a turn finishes that turn in the account it started in, and says so:

> Switched to work@example.com from the next turn. This one finishes in me@example.com.

A message you send it before the turn is over is part of that turn. The next one is in the account now in use.

**Switch account...** asks each login whether it is still signed in before it lists them. One that is not says **signed out** and can't be chosen, there or on the Accounts page. To sign an added account in again, remove it and add it once more.

The status bar and the usage popover over it show the same account: the one the conversation's agent answers in. The popover names it as **Switch account...** does, with its organization and plan, such as `me@example.com (Acme · Team)`, so two accounts with the same email are told apart. Put another account in use while the popover is open and it asks again, of that one. When Claude reports no plan usage for the login, the popover says it is unavailable and the status bar keeps what it last knew: check that login's sign-in on the Accounts page.

Under the limits, **Usage credits** says what the account spent this month once a limit was used up, such as $12.40 of $50, with a bar, or why they are off for the account, such as no credits left or your organization having turned them off. Once a session or weekly limit is used up, it says whether usage credits take over until the limit resets. **See detailed breakdown** adds what is left of the month's cap and when it starts over, on the 1st. Usage credits are set up on claude.ai, by you or your organization's admin.

## Stopping at the plan limit

A Claude account on a team or paid plan can have **usage credits**: once its session or weekly limit is used up, Claude goes on and the credits pay for it, up to a monthly cap. A team member often can't turn them off. **Stop at the plan limit (don’t use usage credits)**, under each Claude account in **Settings → Accounts** beside its **Usage credits**, keeps buddylist's conversations from using them. It is **on by default**, for every account, and holds for every Claude conversation, worker and manager in that account.

- **Before a turn**, buddylist asks Claude how much of the plan is used, as `/usage` does, unless a conversation in the same account heard from Claude in the last minute that the plan still had room. If the session or weekly limit is used up and usage credits aren't known to be off, the turn doesn't start. When Claude can't be asked, the turn goes by the last word on that account: it is stopped only if that was usage credits and the limit hasn't reset since.
- **During a turn**, Claude says with the first request it serves from usage credits that it is doing so. The turn is stopped right then, as **Stop** would, helpers with it. That one request is already paid for: nothing can tell beforehand that it will cross the limit. A turn Claude starts on its own, such as a check-in, in an account stopped at its limit, is stopped as it starts.

The conversation then says why and when the limit resets:

> Stopped at the session limit so usage credits aren’t used. Resets in 2 hr. **Use credits for this turn** **Switch account**

- **Use credits for this turn** asks first, then sends the stopped message again and lets that one turn use usage credits. The next turn stops at the limit again. Nothing changes the account's setting.
- **Switch account** opens the account menu. Putting another account in use sends the stopped message again there, in every conversation stopped in the account you left, after a fresh check of the new one.
- With **Automatically switch accounts at usage limits** on, the conversation goes on in the next account by itself, as it does when a limit turns a message away, and the next account is checked before its turn starts. With **Fallbacks** on, recovery starts as for a reached session or weekly limit, and each fallback entry's own **Paid usage** rule decides; a fallback turn pinned to an account goes by that rule, not by this setting.
- Messages that waited for the stopped turn wait on. A new message of your own, or **Send now**, tries again with a fresh check. A [project manager](project-managers.md)'s notes to a stopped conversation, and its rounds, never start it again: they wait until you write to it, let it use credits or switch account. The manager is told once that the account is at its plan limit.
- On a [phone](remote-access.md), the stopped line has the same choices with full access; **Switch account** there puts the next signed-in account in use. With less access, it says to choose on your computer.

Turn the setting off for an account to let its turns go on in usage credits as before, with no checks. Claude accounts without a plan, such as an API key, have no plan limit to stop at.

## When a limit is reached

When Claude Code turns your message away because the account in use reached a limit, the conversation shows Claude Code's own message, and then an invitation:

> **Claude would like to switch to me@example.com.**
> work@example.com reached its weekly limit. Resets Wed 2:00 AM. Your message is sent again from there.

- **Accept (⌥C)** puts the next account in use and sends your message again from it. The conversation picks up where it was, with everything said so far. This accepts only this switch; the next limit asks again.
- **Decline (⌥D)** stays in the account you were in.

Automatic switching is off by default. To opt in, turn on **Automatically switch accounts at usage limits** in **Settings > Accounts**. From then on, the app switches and resends your message without asking, and a line in the conversation says so. This applies to every conversation with that service. Turn it off there to ask before switching again; accepting an invitation never turns it on.

The next account is the one after the one in use, then round from the top. An account that is the same login as the one that reached its limit is skipped. A message that every account turned away is not sent round again: the conversation says that every one of your accounts has reached a limit. A new message of your own tries again.

Good to know:

- Switching starts Claude Code again in the other account. A helper still at work and what Claude set itself to check back on end with it. The first reply after a switch can take a little longer.
- An account added here shares everything you set up for Claude Code: your settings, `CLAUDE.md`, skills, agents, commands, hooks, output styles and plugins. It shares the conversations too, with each one's to-do list, which is how one is picked up in another account with its checklist still up to date. An account added before to-do lists were shared has its own moved into your `~/.claude/tasks` when buddylist starts.
- What your organization sets for an account, its policies and managed settings, stays with that account.
- The MCP servers you added for yourself are copied to an account when it is added. One you add later, add with `claude mcp add` in that account too, or add it to the project instead.

## Continuing with another provider

For several workers under one manager, right-click the **manager** and choose **Continue workers with...**. The same action is in its **Team** menu. Select stopped or usage-limited workers, choose a service, model and effort, then **Continue**. Working, completed and archived conversations are listed with a reason and cannot be selected. The dialog checks each worker again before dispatch and reports **Continued**, **Skipped**, or **Failed** separately; **Retry failed** retries only failures.

Each selected conversation keeps its folder, branch, uncommitted changes, history and manager. A compatible general agent is reused or invited in place, with permissions no broader than the stopped agent's. The stopped agent is paused so later messages and manager notes reach its replacement. The handoff uses the local conversation recap, unfinished checklist, latest instructions and saved pictures; it does not ask the exhausted provider to write a summary. The manager and **New workers use** preference do not change. Each target must have its CLI and sign-in ready. This is an explicit invitation, not an automatic fallback spending rule; the target service's normal billing applies. **Continued** means the request was sent—watch the conversation for its progress or any later provider error.

For a **project manager**, use **Switch manager service...** on the limit message, or **Settings → your project → Manager → Service → Switch service**. Claude, Codex, Gemini, OpenCode and Hermes can each run the manager. Its brief, sources and assigned conversations stay. See [Project managers](project-managers.md).

When an agent reports a usage limit, **Invite another agent** in the conversation opens the invitation picker. Choose an agent from another provider, such as Codex alongside Claude. It joins the same folder and gets a recap of the conversation on its first turn; its own login and usage limits apply.

For automatic recovery, open **Settings → Fallbacks**. Turn on **Use fallbacks**, add up to ten targets, and use **Move up / Move down** to choose their order. Each entry selects a service, a model, and (for Claude) an account. **Account currently in use** resolves when recovery starts; a selected account is pinned for that continuation without changing the shared login. Only continuations are pinned: with fallbacks on, every other conversation still moves to the account you put in use. The status bar of a pinned agent shows its pinned account's limits, and its usage popover says a fallback keeps it in that account, not the one in use. A project can inherit this list, override it, or disable it under **Settings → your project → Fallbacks**.

These spending rules apply to turns started through fallback recovery. Ordinary Claude conversations and new workers are kept from usage credits by **Stop at the plan limit** (see [Stopping at the plan limit](#stopping-at-the-plan-limit)), which is on by default. Neither turns off paid usage in your provider account: to prevent charges there, use the provider’s own billing controls.

Each entry has independent conditions:

- **Use after:** Session limit, Weekly limit, or Service unavailable. Claude and Codex provide confirmed failure signals. An unscoped quota error requires both limit types to be enabled. Unavailable requires two confirmed server failures within ten minutes; a successful turn clears that count. A server failure is one the service answered with, such as overloaded or a 5xx error. A request that got no answer at all, because the service's address didn't resolve or the connection was refused, reset or timed out (ENOTFOUND, ECONNREFUSED, ECONNRESET, ETIMEDOUT and the like), is not an outage: it usually means this computer is offline, and no other service would answer either. That turn stops with the service's own error and "Your internet connection looks down", and nothing is handed to a fallback. Authentication, billing, invalid-model, context-window, tool and permission errors do not count as outages.
- **Paid usage:** **Never use paid usage** is the default. It skips exhausted or unknown allowance, even when credits exist, and requires provider protection against charges throughout the turn. **Current live integrations cannot guarantee that protection, so Never entries are skipped.** A usage snapshot, disabled extra-usage indicator or current credit balance is not a spending lock. **Ask before possible charges** asks for one turn, including when included allowance remains but could run out mid-turn. **Allow paid usage** explicitly permits credits or API charges for that entry.
- **Minimum allowance remaining:** checks every reported window, including model-specific windows, before starting each turn. It is a starting condition, not a cap on how much that turn can consume. Neither paid-use approval nor Allow overrides it.
- **When allowance is unknown:** skip the entry or ask. Unknown allowance still cannot satisfy Never or a positive minimum. Asking for unknown usage is separate from permission to switch automatically.
- **Always ask before this fallback:** adds a confirmation even when the other conditions pass. **Switch without asking** controls switching consent globally, never spending consent.

The app checks targets in order without sending task content to them. Skipped entries say why in the chat. Declining stops recovery, and an exhausted list stops instead of cycling. An agent on its own is not paused when recovery stops without a fallback: your next message reaches it as before. Every service/account/model combination is tried at most once until your next message. Stop, a new message, closing or archiving the conversation cancel pending recovery; changing its rules invalidates a pending approval. Older service-only fallback settings adopt the same Never default.

A worker fallback reuses a suitable general participant or invites one in the same folder. It gets a conversation recap, unfinished checklist and the pictures from the interrupted turn, and is asked to inspect existing changes before continuing. The failed agent is paused once the fallback is in the conversation, and stays paused. A fallback already at work finishes its turn before receiving the continuation. Specialists, custom agents and slash commands are not replaced automatically. A solo project manager keeps its identity, brief, sources, assigned workers, recent conversation and waiting notes; a manager with guests, or acting as a guest elsewhere, still switches manually.

**Permissions never get broader.** Plan or Read only stays read-only, and Asks first stays ask-first or becomes read-only. File-edit and workspace grants may become ask-first when another service cannot preserve their restrictions. An existing guest must have an equally restrictive conversation mode. Hermes has no mode strict enough to replace an ask-first agent. Entries with no safe mode are skipped.

Allowance is checked again immediately before dispatch, including after a confirmation has waited. Each later turn on the fallback gets a fresh check and, where needed, a fresh confirmation. Fallback sessions disconnect at the end of a turn so provider check-ins or background helpers cannot start another model turn outside that check; their saved conversation can resume. Suggested-reply calls are suppressed for fallback managers. Enabling these rules also disables the competing implicit Claude account-retry flow in the affected conversation. The normal group turn limit still applies.

If the stopped agent has unfinished to-dos, use **Continue with...** on its checklist after inviting the other agent. Choose who should receive the remaining items, including any that were in progress. The new agent is asked to inspect existing changes and verify what is already complete. See [Conversations](conversations.md) and [Group conversations](group-conversations.md).

## Where they are kept

Each account added here gets a folder of its own under the app's data, in `accounts/claude/`. Claude Code is started with that folder as its `CLAUDE_CONFIG_DIR`, so it keeps the login apart: on a Mac in a keychain entry of its own. The folder links to what it shares in your own `~/.claude`, and removing the account removes only those links.

Switching accounts in buddylist leaves `claude` in a terminal using the terminal login; **Disconnect** signs that login out in both places. To use an added account in your terminal, set `CLAUDE_CONFIG_DIR` to its folder under [the app's data folder](getting-started.md#where-your-data-lives). For example, on a Mac:

```bash
CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/buddylist/accounts/claude/<id>" claude
```
