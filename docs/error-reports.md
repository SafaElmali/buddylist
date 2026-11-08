# Error reports

When something goes wrong that the app did not expect, an installed app sends a report of it to [Sentry](https://sentry.io), so that it can be fixed. Three things are reported:

- **An error nothing caught in the main process**, a rejected promise nobody handled included.
- **An error nothing caught in a window**: the contact list, a conversation, the message history, the welcome wizard, Settings or a toast.
- **A process that crashed**: a window's, the GPU's or the app's own. The report comes with the crash dump the system wrote. The crash of the app itself is reported the next time it starts.

An error the app handles, such as a `git` command that fails or an agent that can't be reached, is not reported. Neither is anything from `npm start`, `npm run demo` or the browser demo.

## What a report holds

- The kind of error, its message, and the stack: the places in the app's code that led to it.
- The app's version, the versions of Electron, Chrome and Node in it, and the operating system version.
- The computer's chip, graphics card, memory and screen size, how much memory was free, and when the computer and the app were started.
- A trail of what the app's windows did before the error: opened, shown, focused, closed. Each with the name of its page, such as `chat.html`.
- Which window an error came from.
- Once per run, that the app started and whether it ended in a crash.

## What it leaves out

- **Who you are.** A report has no name, no email address and no computer name, and Sentry is told not to keep the address it came from.
- **Your home folder.** Wherever a path in a report starts with it, it is written as `~`, so `/Users/ada/work/shop` arrives as `~/work/shop`.
- **Web addresses.** Each is written as `[link]`: it is a page you had open in the [browser tab](browser-tab.md), or a repository of yours.
- **What a window was opened with**: which contact, or the words of a toast.
- **Your conversations.** What you and an agent say is never part of a report.
- **What the app wrote to its console and the addresses it asked for.** The SDK would keep a trail of both, and is told not to.
- **Your language and time zone.**

The message of an error is otherwise sent as it is. A path outside your home folder, or a branch name, that an error mentions is in the report.

A crash dump is the one part the app can't read: it is the memory of the process that crashed, at the moment it did. A window's dump can hold what that window was showing.

## Turning them off

**Tools → Send error reports** in the contact list, or the switch of the same name in **Settings**. It is on when the app is first installed.

Unticking it stops reports at once, the dump of a crash that already happened included. Ticking it again starts them without a restart.

An app that starts with reports off starts nothing of Sentry's at all. When they are then turned on, a crash of a window that was already open is only reported from the next start on.

## Where reports go

To the app's project at Sentry, whose address only the build of a release is given: the repository variable `SENTRY_DSN`, which the build writes into the main script (`services()` in [`scripts/build-app.js`](../scripts/build-app.js), read as `SENTRY_DSN` in [`src/main/error-reports.js`](../src/main/error-reports.js)). The key in it only lets a report in, so it can be read by anyone who has the app. A build without it, a contributor's or a fork's, reports nothing.

Only the main process talks to Sentry. A window hands its errors over the app's own bridge ([`src/renderer/lib/error-reports.js`](../src/renderer/lib/error-reports.js)), at most ten of them, so a window that fails over and over says so only so often. That keeps the windows as they were: they reach nothing but the main process, and no script of Sentry's runs in them.

What a report leaves out is decided in one place, `scrubber` in [`src/shared/error-reports.js`](../src/shared/error-reports.js), which every report and every step of the trail goes through before it is sent.

## Reading a stack

The app's scripts are minified, so a stack names places like `main.js:1:3276`. Sentry turns them back into the files and lines of `src/` with the source maps of that build.

The build of a release sends them: `npm run build:app` does when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` are set, as they are for a release built by GitHub Actions (see [Releases and updates](releases.md#credentials-and-permissions)). The maps are deleted again before the app is packed, so a download still doesn't hand out the source. A build without the token has no source maps and reports under the same version name, `buddylist@<version>`; its stacks stay minified.

If Sentry can't be reached, the build says so and goes on: a release is not held up by it.

## Trying it on this computer

Give the app an address to report to, and it reports from `npm start` and `npm run demo` too:

```bash
BUDDYLIST_SENTRY_DSN=https://<key>@<host>/<project> npm run demo
```

Use a project of your own for this, not the app's. An error to try it with, from a window's developer tools:

```js
setTimeout(() => {
  throw new Error('trying error reports');
});
```
