# Schedules

A schedule is a prompt that starts a contact by itself, on a cadence you pick: "every weekday at 9, triage the new issues in shop", "every night at 2, update the dependencies and open a pull request", "every hour, check CI on main". Each run is a new contact, with the prompt sent at once, so you find its work in your contact list like any other conversation.

## Adding one

**Contacts > New schedule...**, or **New schedule...** on **Settings > Schedules**, opens the dialog. The [command palette](contact-list.md#command-palette) (**⌘K**) finds it by "cron", "recurring" or "routine" too.

- **Name** is what the schedule and its runs are called. Left empty, it is the prompt's first words.
- **Prompt** is what the agent is sent at the start of each run. It knows nothing else, so say everything it needs, as you would to a contact you just added.
- **Project** is where each run works: one of your projects, another folder, or [This computer](contact-list.md#this-computer).
- **Cadence** is how often it runs: **Every hour**, **Every day at a time**, **Weekdays at a time**, **Every week on a day**, or **Custom cron**. The box under it is the [cron](#the-cron) that comes to, and the line under that says it in words, with when it runs next: _"On weekdays at 9:00 AM. Next run: Tomorrow 9:00 AM"_. Picking a preset, a time or a day writes the cron. Type a cron of your own and the list says which preset it is, or **Custom cron**.
- **Max runs** is how many runs it has before it turns itself off. Left empty, it runs until you turn it off.
- **Service** is who answers each run. **More options** has its **Model**, **Effort** and **When it wants to do something**, which start out as [Settings > New contacts](settings.md#agents) has them for that service, and the line beside **More options** says what they are. **Never ask** can be picked, and says what it means under the form: a run in that mode changes files and runs commands with nobody there to ask.

**Create schedule** saves it, on. **Edit...** on its line in Settings opens the same dialog, with **Save**.

## Each run

- **A contact of its own**, named after the schedule and the time it started: _"Triage new issues (Oct 27, 9:00 AM)"_. Its conversation starts with _"The schedule Triage new issues started this conversation."_, and then the prompt, sent at once.
- **In a worktree of its own**, on a new branch named after the schedule, such as `triage-new-issues-1`, started from the project's main line, and the project's setup script gets it ready as for any new contact. In a folder that is no git repository, it works in the folder itself. On This computer, it gets a new, empty folder of its own.
- **Never shared.** Each run is a new conversation. A run still at work when the next one is due keeps going, and the next is a contact of its own.
- **An ordinary contact** in its project's section: you can open it, write to it, archive it or delete it. Deleting a schedule leaves the contacts its runs started.

## The cron

A cron has five fields, in your computer's local time: minute, hour, day of the month, month and day of the week.

| Cron                | When                                                  |
| ------------------- | ----------------------------------------------------- |
| `0 * * * *`         | every hour, on the hour                               |
| `*/15 * * * *`      | every 15 minutes                                      |
| `30 7 * * *`        | every day at 7:30 AM                                  |
| `0 9 * * 1-5`       | weekdays at 9:00 AM                                   |
| `0 8 * * mon`       | every Monday at 8:00 AM                               |
| `*/30 9-18 * * 1-5` | every 30 minutes from 9:00 AM to 6:30 PM, on weekdays |
| `0 9 1,15 * *`      | on the 1st and the 15th of every month at 9:00 AM     |

- Each field takes `*`, a number, a range such as `1-5`, a list such as `1,3,5`, and a step such as `*/15` or `9-17/2`.
- Months and days of the week take their names too: `jan`–`dec`, `sun`–`sat`. Sunday is `0` or `7`.
- As cron has it, a schedule with both a day of the month and a day of the week runs on either: `0 9 1 * 1` runs on the 1st and on every Monday.
- When the clocks go forward in the spring, a time they skip runs once they have moved past it: 2:30 runs at 3:30 that day. When they go back in the autumn, a time they pass twice runs once, the first time.
- One that would never run, such as `0 0 30 2 *` (February 30), is refused, and so is one that is no cron. The line under the box says why.

## Settings > Schedules

Under **Agents**, a line for each schedule: its name, when it runs and when next, such as _"On weekdays at 9:00 AM · Next: Tomorrow 9:00 AM"_, and the switch that turns it on or off, at the end of the line. A schedule that is off says so, and one that had all its runs says _"Off after 5 of 5 runs"_. One whose last run could not start says _"Last run failed"_.

Click a line, or press Enter on it, to open it:

- **Project**, **Service** with its model and mode, **Last run**, and **Runs**: how many it had, such as "3 of 10".
- **Last run failed**, where it could not start, and why, such as a project folder that is not there any more.
- **Run now** starts a run at once. **Edit...** opens its dialog. **Delete** asks first, and takes the schedule away, not the contacts its runs started.

## When runs happen

- **While buddylist is open.** A schedule runs on its own only while the app is open, also with every window closed.
- **Missed runs run once.** A run that fell due while the app was closed, or the computer was asleep, runs once when it opens or wakes, and the schedule goes on from there. Many that were missed are still one run.
- **Never twice.** A run is saved as started before its contact is made, so it never starts again: not when the app quits or crashes while it starts.
- **Max runs** counts the runs its cadence starts, and the missed ones run once on opening. When it is reached, the schedule turns itself off. Turned on again, it counts afresh. Given fewer runs than it already had, it turns off.
- **Run now** is a run besides its cadence: it is not one of its Max runs, and its next run stays when it was. It works on a schedule that is off too.
- **Turned off and on again**, or **given another cadence**, it goes on from then: what fell due while it was off, or under the old cadence, doesn't run.

## Schedules and check-ins

A [check-in](check-ins.md) is something a Claude contact sets itself, to be woken in the same conversation: "keep an eye on CI". A schedule is yours, and starts fresh contacts.

|                   | Check-ins                                      | Schedules                                       |
| ----------------- | ---------------------------------------------- | ----------------------------------------------- |
| Who sets it       | Claude, when you ask it in a conversation      | You, in the New schedule dialog                 |
| Services          | Claude only                                    | Claude, Codex, Gemini, OpenCode and Hermes      |
| Each time it runs | the same conversation is sent the prompt again | a new contact, in a worktree of its own         |
| Quitting the app  | ends it                                        | keeps it, and a missed run runs once on opening |
| How long it lasts | 7 days, or until `/clear`, archive or delete   | until you turn it off, or it reaches Max runs   |

## Good to know

- Schedules are kept with the app's settings on this computer. They are not shared between computers.
- The [live demo](https://buddylist.dev/demo/) has no schedules: they run in the app.
- The usage counts say a schedule was added, edited, turned on or off, removed or run, with only its preset, its service and how a run started. Never its name, its prompt, its project or its cron. **Settings > Privacy** turns them off.
