# Check-ins

A Claude contact can **check back** later on its own: "keep an eye on CI and tell me when it's green", "look at the deploy again in 10 minutes", "every weekday at 9, triage the new issues". Claude Code calls these scheduled tasks. Claude sets one with its `CronCreate` or `ScheduleWakeup` tool, or you type `/loop`, and Claude is sent the prompt again whenever it is due.

**Asking for one.** Say it the way you would to a person. Claude picks how often, and says so:

- In the conversation, a line such as _"Claude will check back every 5 minutes: Check whether CI passed"_, with a clock.
- In the status bar, once nobody is typing: _"Claude will check back every 5 minutes."_, or how many it has when there are several.
- Under the contact's name while it has nothing else going on: _"Checking back every 5 minutes"_. That is at the top of the conversation, and in the contact list unless its row wears [pull request tags](contact-list.md), which are all a row with tags shows.

**When one is due**, the conversation says _Time to check back: "Check whether CI passed"_ and Claude answers it, without you sending anything. That is a turn like any other: the status bar says it is typing, a toast says what Claude said if you are elsewhere, and **Stop**, or Esc twice, stops it.

**Stopping them.** Ask Claude: "stop checking". The line _"Claude cancelled a check-in"_ says it did.

Good to know:

- **Check-ins last while buddylist is open.** They end when you quit the app, start a new chat (`/clear`), or archive or delete the contact. Claude is told that, so it can say so when you ask for something that should last longer.
- **One that repeats ends by itself after 7 days**, as Claude Code has it.
- In a [group conversation](group-conversations.md), each agent's check-ins are its own. The status bar says whose they are, and they go when that agent leaves.
- **Only Claude contacts have them.** Codex, Gemini, OpenCode and Hermes have nothing like it to set.
- **For something that should outlast the app**, such as a task every weekday at 9, use a [schedule](schedules.md) instead: you set it, any service can answer it, each run is a new contact, and it is kept when you quit, with a run you missed meanwhile run once when the app opens.
- In the [live demo](https://buddylist.dev/demo/) and in demo mode, a message with "check back" or "check in" in it has a scripted Claude set a check-in that is due a few seconds later.
