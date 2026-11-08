# Security

buddylist runs coding agents on your Mac with your login and your files, so a hole in it can matter. If you find one, please report it privately rather than in an issue.

## Reporting a vulnerability

Use **[Report a vulnerability](https://github.com/SafaElmali/buddylist/security/advisories/new)** on the repository's Security tab. Say what you found, how to reproduce it, and which version of the app you used (**Help > About buddylist**).

You'll get a reply within a week. Please give a fix time to ship before you talk about the issue in public.

## Versions

Only the latest release is fixed. Installed apps update themselves from v0.2.8 on, so a fix reaches everyone through an ordinary release.

## What counts

- **Getting out of a window.** A web page in the [browser tab](docs/browser-tab.md), a message, a file in a project or anything an agent reads running code in the app itself. Every window is sandboxed, with context isolation and no Node.
- **Acting without you.** An agent changing files or running a command without the invitation you accept, when its contact is set to ask first.
- **Updates.** Making the app install an update that isn't a signed build from buddylist's [releases](https://github.com/SafaElmali/buddylist/releases).
- **Leaks.** Something leaving your Mac that shouldn't, such as an [error report](docs/error-reports.md) carrying what it is meant to leave out.
- **buddylist.dev**, its feedback form included.

## What doesn't

- What an agent does after you accept it, choose **Always allow**, or pick a mode that doesn't ask.
- A bug in Claude Code, Codex, Gemini, OpenCode or Hermes themselves. Please report those to the people who make them.
- Files you put in your own [pack folder](docs/custom-pack.md).
