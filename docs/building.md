# Build the app

```bash
npm run dist        # macOS, on a Mac
npm run dist:win    # Windows x64, on Windows
npm run dist:linux  # Linux x64, on Linux
```

The Mac command builds a `.dmg` and `.zip` for your Mac's architecture. Windows produces `dist/buddylist-win-x64.exe`; Linux produces `dist/buddylist-linux-x86_64.AppImage` and `dist/buddylist-linux-amd64.deb`. Build on the target OS so the bundled Claude binary and native terminal match it. Windows and Linux use node-pty's shipped native prebuilds.

CI runs `node scripts/check-package.js` on each native runner to check installers, update feeds, the bundled Claude executable and a real terminal started by the packaged Electron.

Windows and Linux builds also install the packages and run `scripts/check-package-ui.js`. It opens the contact list, sends a demo message through the real chat window and opens the terminal pane, using a temporary profile and no agent credentials. Windows tests the installed NSIS app; Linux tests the installed Debian package and the AppImage under Xvfb. Screenshots and logs are saved in the run's `smoke-*` artifacts; a pull request keeps them only when a check failed. These checks do not cover real account sign-in or an update from an older release.

For unattended Electron tests, set `BUDDYLIST_TEST=1` and point `BUDDYLIST_USER_DATA` at a temporary profile. Together they skip the native confirmation when quitting or restarting with busy contacts, so Playwright's `app.close()` can finish. Dev servers, terminals and conversations still receive normal shutdown cleanup. The UI checks and video recorder set both. Demo mode alone keeps the confirmation; omit `BUDDYLIST_TEST` when testing the dialog itself.

`node scripts/check-send-now-ui.js` builds the renderer, preload and assets as shipped, with a minified main-process fixture that supplies a controllable Claude stream. In isolated profiles it checks selected Send now, timeout and retry, mixed user/manager queues, cancellation, targeted setup requests whose queue events precede their bubbles (the dispatch path toolbar requests share), lost interrupt acknowledgements and reloads. It covers Professional and Messenger in light/dark, with screenshots, recordings and delivery logs under `~/buddylist-media/send-now-stuck/` (or its first argument). No real agent process runs. Provider and group-turn regression tests cover the other interruption races.

`npm run build:app` followed by `node scripts/check-archive-window-ui.js` checks archiving through the bundled Electron app with temporary profiles and demo agents. It covers current and other contacts, chat tabs, manager/worker windows, pending turns, drafts, history, Restore and explicit Close in both looks and light/dark. Screenshots, recordings and results go to `~/buddylist-media/archive-window/`, or its first argument. It never opens the user's profile or calls real agents.

`node scripts/check-file-find-ui.js` opens this checkout's files through real Electron file IPC with an isolated profile and no agent turns. It checks Find in file, conversation routing, the menu and palette, and the composer in both looks and light/dark themes. Screenshots and results go to `~/buddylist-media/find-in-file/`, or its first argument.

`node scripts/check-codex-fast-mode-ui.js` checks Codex Fast mode in both Professional and Messenger using real Electron windows, an isolated profile and a synthetic app-server. It covers managers, ordinary contacts, guests, on/off payloads, reloads, restarts and unsupported models without paid turns. Screenshots and request logs go to `~/buddylist-media/codex-fast-mode/`, or the directory passed as its first argument.

`node scripts/check-worker-handover-ui.js` checks **Continue workers with...** through real Electron windows and IPC, with isolated demo profiles and Git worktrees. It covers both looks in light/dark, selection, keyboard access, partial failure and retry, all three menu entry points, no eligible workers, preserved changes and manager settings. It never opens the user's profile or calls a real agent. Proof goes to `~/buddylist-media/bulk-worker-handover/`, or its first argument. Main-process regression tests cover permission boundaries, stale selections, duplicates, images and manager-note routing.

`node scripts/check-merged-pr-badge-ui.js` checks merged badges in both looks using isolated demo profiles and synthetic PR snapshots. It covers the contact list, selected dark sidebar at 150–360px, Team, reload/reopen/restart, and clearing the badge for new work. Evidence goes to `~/buddylist-media/merged-badge-continuity/`, or its first argument. It makes no GitHub or paid agent calls; real Git association, persistence and Continue transitions are covered by the pull-request tests.

A pull request gets these builds only when it changes what goes into the installers or checks them: the package files, `build/`, the build and check scripts, the workflow, and the few files only a packaged app or a Windows runner exercises. [`scripts/packaging-changes.js`](../scripts/packaging-changes.js) lists them. To build them for any other pull request, add the `build-installers` label before a push: labels are read at each push, so the label takes effect from the next one.

`npm run dist` first runs `npm run build:app`, which bundles and minifies the code into `dist/app/` to keep installers small: one script for the main process, one for the preload and one per window, next to the pages, styles, pictures and sounds, and Mermaid's own build, which draws [diagrams in replies](conversations.md). That folder is what gets packed. The original source is available in the repository.

`npm start` still runs `src/` as it is.

The recording audio worklet (`renderer/chat/voice-worklet.js`) is a separate build entry: the audio engine loads it by URL, outside the chat window's imports. Omitting it breaks recording in the packaged app even when the microphone is allowed.

To check recording without touching a physical microphone, run `npm run build:app` and `node scripts/check-microphone.js /tmp/buddylist-microphone-evidence`. This opens an isolated demo Electron profile with Chromium's fake audio input, exercises both looks and hold/press controls, and verifies PCM capture, cleanup, permission refusal, error recovery and preservation of the draft and a generated attachment. It uses a test transcription response after checking the real missing-model error; it does not run a user's Whisper installation. The profile is removed on exit; only screenshots and diagnostic logs remain in the evidence folder. This does not verify a physical microphone or a macOS privacy prompt.

`node scripts/check-microphone-browser.js` checks the same capture code in an isolated, headless Chrome with fake audio, including recovery from a missing worklet. It requires Chrome to be installed. The browser preview itself continues to use a sample sentence, without requesting a microphone.

## What makes the download as big as it is

Nearly all of it is two programs the app can't run without: Electron (about 285 MB on disk) and the Claude Code binary that comes with the Agent SDK (about 220 MB). The build keeps the rest small:

- **The `.dmg` is packed with lzma.** electron-builder's own formats stop at bzip2, so [`scripts/compress-dmg.js`](../scripts/compress-dmg.js) packs the finished image again with `hdiutil`. That alone makes it about a quarter smaller. The `.zip` can only use zip's own compression and stays larger.
- **Packages only the windows use are left out.** Their code is already inside each window's script, so `files` in `package.json` drops them from the packed `node_modules`. A terminal's stylesheet is the one file a page still loads from there.
- **Mermaid is its built files alone.** As a package, with what it depends on, it is some 200 MB. The build copies its minified script and the pieces it loads for each kind of diagram, about 5 MB, next to the windows' scripts (`src/renderer/mermaid/` in the app). A window loads it the first time a reply has a diagram, so it is no part of a window's script, and the package is a dev dependency, which nothing packs.
- **What reports errors is inside the main script.** Packed as a package, the SDK behind [error reports](error-reports.md) and what it depends on are over 100 MB, most of it for servers. The build puts the parts the app uses into the main process's script instead: about 0.6 MB.
- **The bundled Winks are WebP and AAC.** See [their README](../src/pack/README.md).

CI Mac builds are signed with a Developer ID and notarized ([Signing and notarization](releases.md#signing-and-notarization)), so they open like any other downloaded app. A local build is ad-hoc signed and not notarized. It opens on the Mac that built it, but a copy sent to another Mac needs **System Settings → Privacy & Security → Open Anyway** there. See [Apple's first-launch guide](https://support.apple.com/en-us/102445).

Pull requests and pushes to `main` run lint, tests and the app bundle build on Linux. Pull requests that change packaging also build and open Windows and Linux installers on their native runners. Manual builds and releases additionally package Mac. Build-only downloads are in the run's **Artifacts** for one day.

## Release a download

Follow [Releases and updates](releases.md) for publishing a release, version numbering, credentials, recovery from failures and updating existing installations.

`npm run release` publishes a new version of the Mac, Windows and Linux installers and their update feeds from `main` as a release of the public [SafaElmali/buddylist](https://github.com/SafaElmali/buddylist/releases), where the website's permanent download link picks them up. Pushes to `main` and pull requests run checks without publishing a release. Build-only artifacts are visible to people who can read the repository. Mac, Windows and AppImage installations download a newer version in the background and offer **Restart** to install it; the website is deployed separately.
