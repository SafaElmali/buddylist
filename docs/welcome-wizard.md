# The welcome wizard

The first time the app starts, a wizard opens in front of the contact list. It takes about a minute and ends in your first contact:

| Page                         | What it is for                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Welcome to buddylist**     | What a contact is: an AI agent working in one of your project folders, or on this computer with none.        |
| **Pick your look**           | The professional look or the messenger, and whether it is by day, at night or as your computer is.           |
| **Who can you talk to?**     | Which agents are on this computer and signed in, and what to do about one that is not.                       |
| **How a conversation works** | Worktrees, the invitations to accept or decline, the nudge, and the contact list as a status board.          |
| **What it can do**           | A picture each of several agents at once, group chats, project managers, and the Changes tab with Create PR. |
| **Add a project**            | The three ways to a project, or a contact on no project at all, each ending in **Add a Contact**.            |

**Back** and **Next** go through the pages, and **Skip** closes the wizard at any of them.

A new install starts with nobody on the contact list: the first contact is the one you add on the last page, on a project or on [This computer](contact-list.md#this-computer). There is no contact made up for your home folder. Until there is one, the list shows **This computer (0)**, with its **+**.

## Pick your look

The page shows a conversation drawn both ways, side by side:

- **Professional**, flat and quiet in your system's own type. A new install starts in it.
- **Messenger**, the 2005 buddy list: Luna blue, emoticons, winks, nudges and the sounds. See [The MSN look](msn-look.md).

Under them, **Colours** has **Day**, **Night** and **Match system**, which a new install starts with. With a theme in another palette, such as Olive Green, Day and Night keep that palette; only Luna's blue has Match system.

Each choice changes every window at once, the wizard too, and is kept. It is the same setting as **Look** and **Theme** under **Tools** in the contact list, and as **Settings > General**, so it can be changed there whenever you like. An install from before there was a choice keeps the look and theme it had.

## Who can you talk to?

The page lists every service, and the GitHub CLI, the way the contact list shows a contact:

| It says                     | Meaning                                                                  |
| --------------------------- | ------------------------------------------------------------------------ |
| 🟢 **Ready**                | Installed and signed in.                                                 |
| 🟠 **Not signed in**        | Installed, without a sign-in. The line says how to sign it in.           |
| ⚪ **Not installed**        | Its command-line program was not found. The line says how to install it. |
| ⚪ **Could not be checked** | It did not answer within a few seconds.                                  |

One agent that is ready is enough to start. **Check again** asks them all once more, after you installed one or signed in.

- **Claude** comes with the app, so it is only ever signed in or not, and it is [signed in from this page](#signing-in-to-claude). A sign-in from `claude` in a terminal counts too, and so does `ANTHROPIC_API_KEY`.
- **Codex** is asked with `codex login status`.
- **Gemini**, **OpenCode** and **Hermes** can't be asked whether they are signed in. They are ready once they are installed, and whether they are signed in shows with your first message.
- **The GitHub CLI** is optional. With it, a contact shows how its pull request stands, and you can pick one of your repositories to clone. One that is not signed in has a **Sign in...** button too: it opens the same **Connect to GitHub** dialog as [the contact list](contact-list.md), and the line turns to **Ready** once you are done in the browser.

Nothing is sent to an agent to find this out: each program is asked how it stands, and that is all. In demo mode nothing is asked either, and everyone is ready.

## Signing in to Claude

Claude Code is part of the app, so there is no `claude` to run in a terminal unless you installed it yourself. A Claude that is not signed in has a **Sign in...** button on its line instead, with three ways in:

| Way                      | For                                              |
| ------------------------ | ------------------------------------------------ |
| **Claude subscription**  | A Pro, Max, Ultra, Team or Enterprise plan.      |
| **Anthropic Console**    | An account that is billed for what the API uses. |
| **Single sign-on (SSO)** | An organization with a sign-in page of its own.  |

Your browser opens on Claude's sign-in page. Once you are done there the line turns to **Ready** by itself: nothing is copied or pasted, and no terminal is opened. It is the sign-in Claude Code keeps for itself, so `claude` in a terminal is signed in by it too.

While the browser is waiting, the line says so. **Cancel** calls the sign-in off, and so does closing the wizard. A sign-in that did not work says why next to the button, which is there to try again.

Outside the wizard, a message to a Claude that is not signed in is answered with where to find this page: **Help > Getting started**.

## What it can do

One picture at a time, with a few lines under it, of what buddylist does besides chat. The buttons under it go from one to the next:

| Button              | What the picture shows                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| **In parallel**     | The contact list with several contacts at work, each in its own worktree, and how each pull request stands.  |
| **Group chats**     | Claude, Codex and Gemini in one conversation: one builds, one reviews, one writes the tests.                 |
| **Managers**        | A [project manager](project-managers.md) and its **Team** tab, with how each conversation under it is doing. |
| **Changes and PRs** | The **Changes** tab with a file's diff. **Create PR** opens the pull request, and the list shows its checks. |

The pictures are of the look the windows are in, and in the professional look at night they are of the night. They are stills of the app in demo mode, in `src/renderer/onboarding/pictures/`. Short clips of each will take their place.

## Add a project

**Open project...**, **Open GitHub project...** and **Quick start...** are the three ways to a project that [the contact list](contact-list.md) has under **Add project**. **No project, just chat...** is for questions, research and writing: its contact is on [This computer](contact-list.md#this-computer), in an empty folder of its own. Each ends in **Add a Contact** with where it works filled in, and with a service that is ready picked for you. Its **Team** brings agents along, such as a reviewer for every change; with no team yet, **More options** has **Set up a team...**, which opens [Settings](settings.md#agents) at **Roles & teams**. Press **Enter**: the contact's conversation opens, and the wizard closes.

**Finish** closes the wizard without a project. **Contacts > Add a contact...** in the contact list adds one later.

## Seeing it again

**Help > Getting started** in the contact list opens the wizard again, whenever you like.

By itself it only ever opens for a new install: someone who already used the app is not shown it after an update. It counts as seen once its window was closed, at whichever page. Quitting the app while it is open is not that, and it opens again the next time.

The [live demo](https://buddylist.dev/demo/) has a welcome of its own and a tour, so the wizard is not part of it.
