# Releases and updates

**Prepare the version in a pull request, then ask for the release.** After that PR is merged, run `npm run release`, or start [Build app](https://github.com/SafaElmali/buddylist/actions/workflows/build-app.yml) on `main` from the Actions page. GitHub Actions tests and packages the dispatched commit using its committed version, creates only its tag, and publishes the Mac, Windows and Linux installers and update feeds as a [release](https://github.com/SafaElmali/buddylist/releases). Its part of the [hand-written changelog](#whats-new) becomes **What's new**. The website lists the version only after publication.

A push or merge to `main` runs lint, tests and the app bundle build on Linux. It does not package a Mac installer. macOS runners are used only for a manual build or release, or a version tag, to keep Actions costs down. Everyone with the app is told about each release, so publish when there is something worth their update.

Installed copies [download a new version by themselves](#in-the-app-download-in-the-background-restart-to-install) and offer **Restart** to install it. Copies of v0.2.7 and earlier have no updater: they say that a newer version is out, and their users replace them by hand once. Publishing does not send announcements.

## Where everything lives

- **Source and workflow:** [SafaElmali/buddylist](https://github.com/SafaElmali/buddylist), public, with [Build app](../.github/workflows/build-app.yml) and its [release helper](../scripts/release.js).
- **Installers:** the releases of [SafaElmali/buddylist](https://github.com/SafaElmali/buddylist/releases), the same public repository as the source. The app downloads its updates from there. See [Where copies look](#where-copies-look-one-public-repository-under-two-names).
- **Older installers:** up to v0.2.14, releases were published to [SafaElmali/buddylist-releases](https://github.com/SafaElmali/buddylist-releases), and copies of those versions look for updates there. It is the same public repository under its old name: see [Where copies look](#where-copies-look-one-public-repository-under-two-names).
- **Public release description:** [What's new](#whats-new), the version's part of [site/changelog.md](../site/changelog.md), over [release-notes.md](release-notes.md), the installation text every release has.
- **Website:** [site/index.html](../site/index.html), deployed separately to [Cloudflare](landing-page.md#deploy-to-cloudflare).

The permanent download address is:

```text
https://github.com/SafaElmali/buddylist/releases/latest/download/buddylist-mac-arm64.dmg
```

## What to do for a normal update

1. Merge the changes that belong in the update. Nothing is published yet.
2. Start a release prep branch from public `origin/main` and prepare its version:

   ```bash
   git fetch --no-tags origin main
   git switch -c release/prep origin/main
   node scripts/release.js prepare auto
   ```

   `prepare` reads remote stable tag names and writes `package.json`, `package-lock.json` and the lockfile's root package version together. It creates no commit or tag. It uses an already higher package version, otherwise the next patch after the highest reserved stable tag. For a deliberate minor or major version, use `prepare 1.2.0` instead; it must be at least the next available version.

3. Write that version's notes in `site/changelog.md`. Commit the two manifests and notes, open the prep PR, and merge it after review and CI. A package version or tag alone does not put it on the website.
4. Ask for the release:

   ```bash
   npm run release
   ```

   This runs `gh workflow run build-app.yml --ref main`. **Run workflow** on the Actions page, selecting `main` and mode `release`, does the same.

5. Watch `test`, `mac` and `desktop`. After they pass, `release` tags the exact dispatched commit and publishes its installers. Check [the latest release](https://github.com/SafaElmali/buddylist/releases/latest) and the site deployment requested afterwards.

Actions never commits a version or pushes a branch. Every version change goes through the normal PR and required checks. A new dispatch at a commit whose version is already tagged elsewhere fails with **write the next version in a prep PR**. Rerun the original workflow to retry the same commit.

## What each action does

| Action                                             | Result                                                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Open or update a pull request                      | Lint, tests and bundle build; native checks when packaging changes.                                                  |
| Run `node scripts/release.js prepare auto`         | Write the next version into both manifests locally for the prep PR. No publication.                                  |
| Merge a prep PR to `main`                          | Check the committed version; the site keeps showing only published releases.                                         |
| Run `npm run release`, or mode `release` on `main` | Build the dispatched commit's version, create its tag if needed, and publish.                                        |
| Run mode `build`                                   | Package installers without publishing; artifacts last one day.                                                       |
| Push a matching `v` tag on a commit in `main`      | Test and publish that committed version; an existing tag is never moved.                                             |
| Publish the release                                | Update the permanent download links and dispatch the site deployment.                                                |
| Merge website changes                              | Deploy from main when all advertised installers are available; release metadata still comes from published releases. |

## Versions, commits and concurrent pushes

The package version must be a stable `MAJOR.MINOR.PATCH`, and both manifests and the lockfile root must agree. The prep command uses numeric version ordering and ignores prerelease tags. Release planning reads the committed version without incrementing or rewriting it. Packaging verifies that it is still using the tested version.

Only after tests and all three native builds pass does the release job create an annotated `v<version>` tag on the dispatched commit. Its annotation includes `Source-Commit`. The only push refspec is `refs/tags/v<version>:refs/tags/v<version>`; automatic extra tags and force updates are disabled. No branch push or main-protection bypass is needed.

A tag already pointing at that commit is a retry and is reused without a push. A tag on a different commit fails clearly: prepare a new version in a PR. If two tag creations race, the same-commit winner is accepted; a different-commit winner is left untouched and fails the run. A missing or rejected tag prevents publication.

For an explicit build or release, native runners upload their installers and update feeds as one-day Actions artifacts. The release job collects all three platforms before tagging or publishing. A failed upload prevents a release; build-only runs tolerate unavailable artifact storage.

New commits may merge while a release builds. They do not change the dispatched commit or the installer being built; that commit must still belong to main's history. Releases and retries run one at a time. Main checks use a separate concurrency group, so a new push cannot cancel a release.

Retries keep the same version and tag. Published assets are never overwritten. An incomplete draft can resume uploading; publishing an older version never replaces a newer stable version as the latest download. Later changes ship under a new prepared version. Do not move release tags or replace public assets by hand.

## Credentials and permissions

Publishing uses the source repository's built-in `GITHUB_TOKEN`, with **Contents: write** only on the release job. No personal release token, additional secret or ruleset bypass is needed. Forks cannot run the source repository's publishing job.

Source maps for [error reports](error-reports.md#reading-a-stack) need three more. Without them a release still ships, and its errors are read with minified stacks:

- Secret `SENTRY_AUTH_TOKEN`: an organization token from Sentry, which may upload source maps and nothing else.
- Variables `SENTRY_ORG` and `SENTRY_PROJECT`: the slugs of the organization and the project the app reports to.

Where an installed app reports its errors and counts its use needs two variables, which the build writes into the app. Without them a release ships, but reports and counts nothing:

- Variable `SENTRY_DSN`: the address of the app's project at Sentry ([error reports](error-reports.md#where-reports-go)).
- Variable `POSTHOG_KEY`: the token of the PostHog project, which [Deploy site](../.github/workflows/deploy-site.yml) gives the pages too ([analytics](analytics.md#setting-it-up)).

[Signing and notarization](#signing-and-notarization) needs four secrets and one variable. Without them build-only runs stay ad-hoc signed, but a release fails before packaging.

The `test` job has read-only repository permission. Checkout credentials are disabled. Only **Record release tag** supplies `GITHUB_TOKEN` to Git, and it pushes one tag; **Publish public release** supplies the token to `gh`. Main continues to require a PR and passing checks with no Actions exception. See [Repository maintenance](../.github/repository-maintenance.md) for tag protection.

The Sentry token is provided only to the build step, and only for a release: a pull request's build sends no source maps.

After publication, `changelog` has **Actions: write** only to dispatch [Deploy site](../.github/workflows/deploy-site.yml) on `main`. A tag pushed with `GITHUB_TOKEN` starts no separate workflow, so this dispatch is explicit.

Before deployment, `scripts/site-downloads.js` checks the latest public release's installers and exports `SITE_RELEASES`: the exact non-draft, stable versions and the current latest version. The site uses this snapshot for its changelog and structured-data version, never the prep PR's `package.json`. Drafts, untagged prepared versions and skipped versions stay absent. Missing installers keep the existing site live; publication requests deployment again.

Offline site builds work without credentials and omit release claims when `SITE_RELEASES` is absent. To preview the release display locally, provide a JSON fixture such as `SITE_RELEASES='{"versions":["1.2.3"],"latest":"1.2.3"}' npm run build:site`. Production metadata comes from the download-check step, not a hand-entered fixture.

No token is bundled into the app or website. Publishing rejects a private repository, since the app and the download link could not read its releases, and publishing in the source repository requires the existing version tag recorded by the release job.

## Signing and notarization

For the full enrollment, certificate, CI, and verification walkthrough, including reuse for another project, see [Apple signing and notarization](apple-signing.md).

The **Build .dmg** step signs the app with the Developer ID certificate under the hardened runtime and has Apple notarize it. The ticket is stapled to the app, so the DMG and ZIP open without **Open Anyway**. Every build of `main`, release and build-only run is signed and notarized this way, which adds a few minutes. Without the certificate, build-only runs fall back to ad-hoc signing and need **Open Anyway** again. Releases require both the certificate and its password, so missing migration secrets cannot silently produce an ad-hoc release. Releases up to v0.2.6 were ad-hoc signed.

To set it up for a new certificate or another repository:

1. Join the [Apple Developer Program](https://developer.apple.com/programs/) as an individual. Your team ID is under **Membership details**.
2. In Xcode, **Settings → Accounts → Manage Certificates → + → Developer ID Application**. Then export it from **Keychain Access** as a `.p12` with a password.
3. At [account.apple.com](https://account.apple.com), **Sign-In and Security → App-Specific Passwords**, make one for notarizing.
4. Under **Settings → Secrets and variables → Actions**:
   - Secret `MAC_CERTIFICATE`: the `.p12`, as `base64 -i certificate.p12 | pbcopy` copies it.
   - Secret `MAC_CERTIFICATE_PASSWORD`: the `.p12` password.
   - Secret `APPLE_ID`: the Apple Account email.
   - Secret `APPLE_APP_SPECIFIC_PASSWORD`: the password from step 3.
   - Variable `APPLE_TEAM_ID`: the team ID. It also picks the certificate.
5. Run a build-only run (**Run workflow**, mode `build`) and check that **Check installers** reports `source=Notarized Developer ID`.

The certificate without the three Apple values fails the build rather than ship a signed app that Gatekeeper still stops. The values are given only to the build step. **Check installers** also confirms that the Claude Code binary inside still carries Anthropic's own signature: the build leaves it unsigned by us (`signIgnore` in `package.json`), as Anthropic requires that binary to run as published. The app's [entitlements](../build/entitlements.mac.plist) are Electron's, plus the microphone for [voice clips](voice-clips.md).

## Keeping Actions costs down

Every push to main and every pull request runs lint, tests and the bundle build on Linux. This makes `test` a reliable required check, including for documentation-only changes. A pull request that changes packaging also builds and installs Windows and Linux packages and opens their UI on native runners. [`scripts/packaging-changes.js`](../scripts/packaging-changes.js) lists what counts, such as `package.json`, the lockfile, `build/`, the build and check scripts and this workflow; the `build-installers` label asks for the builds on any pull request, from its next push. A pull request that changes the phone app, what serves it or what a build makes of it (the same script lists those) also packs the app on Linux as a release is, with no installer, and runs [`scripts/check-remote-ui.js`](../scripts/check-remote-ui.js) against it: a phone-sized WebKit and Chromium pair with it through a stand-in for Tailscale and use the phone app, so a file the phone asks for that the package lacks fails the run. That phone job takes a few minutes on Linux; when it fails, its screenshots, videos and the app's log are kept for a day. Site checks have their own path filter; installer and phone checks still run only for relevant pull requests. The test job skips downloading Electron itself while keeping native addon installation and tests enabled; packaging jobs download it.

Only explicit builds and releases use a Mac runner. Each signed release includes Apple's notarization, so combine completed changes into a release when practical instead of releasing every merge. Keep signing and notarization enabled.

Build-only installers expire after one day. In a public repository, Actions artifacts and logs are visible to repository readers; use synthetic accounts in screenshots and never log credentials. This applies to new uploads; legacy artifacts retain their original expiry and must be removed separately. Public release assets are independent of Actions artifacts. Deleting private artifacts reduces future storage charges, but does not refund charges already accrued. Pull requests upload no installers, and their `smoke-*` screenshots and logs only when a check failed, so the artifact storage is left to builds and releases.

## Verification and failures

Windows and Linux packaging jobs verify the bundled Claude executable and a real terminal using packaged Electron. They then install the Windows NSIS and Linux Debian packages and launch each installed app, plus the Linux AppImage, to test contacts, a demo chat reply and the terminal pane. Their `smoke-*` artifacts contain screenshots and logs, including screenshots on failure; a pull request uploads them only when a check failed. This runs on explicit builds and releases, and on pull requests that change packaging. Real agent authentication and upgrading an older installation still need separate release testing.

CI collects and uploads all ten assets to a draft, then publishes it:

- Mac: `buddylist-mac-arm64.dmg`, `buddylist-mac-arm64.zip`, `buddylist-mac-arm64.zip.blockmap`, `latest-mac.yml`.
- Windows: `buddylist-win-x64.exe`, `buddylist-win-x64.exe.blockmap`, `latest.yml`.
- Linux: `buddylist-linux-x86_64.AppImage`, `buddylist-linux-amd64.deb`, `latest-linux.yml`.

After a release, confirm all ten assets and try the permanent installer links without signing in. Compare the downloaded file's SHA-256 with GitHub's asset digest and verify the disk image on a Mac:

```bash
shasum -a 256 buddylist-mac-arm64.dmg
hdiutil verify buddylist-mac-arm64.dmg
```

- **Tests or packaging fail:** the current public release stays available. Fix the code, push to `main` and ask for the release again. Transient failures can be rerun.
- **The version is already tagged on another commit:** prepare the next version in a new PR and merge it before dispatching again. To retry the original commit, rerun its original workflow.
- **No Mac to build on:** the `mac` job waits about 15 minutes and is cancelled with "The job was not acquired by Runner of type hosted even after multiple attempts" when GitHub has no Apple Silicon runner free. Nothing is published. Rerun the failed jobs later, or build on a Mac of your own: add it as a self-hosted runner of this repository (**Settings → Actions → Runners → New self-hosted runner**, macOS, ARM64) with a label such as `buddylist-mac` (`./config.sh --labels buddylist-mac`), start it with `./run.sh`, and set the repository variable `MAC_RUNNER` to that label. Only the `mac` job then runs there, with the signing secrets; the others stay on GitHub's runners. That Mac needs Xcode, for `notarytool` and `stapler`, and has to stay awake and online until the job is done. Delete the variable to go back to GitHub's Macs.
- **The tag push is rejected:** check the release job's **Contents: write** permission and tag rules. Creation must be allowed; updates and deletions should be blocked. A retry of a tag already on the same commit does not push it again. Do not add a main bypass or force-update the tag.
- **Publishing returns HTTP 403:** check that the `release` job still has **Contents: write**, and that **Settings → Actions → General** lets workflows write to the repository, then rerun failed jobs.
- **An upload fails:** the previous public release remains latest. Rerun failed jobs to reuse the tag and finish the draft upload. A new release may instead ship the fix under a later version.
- **Actions artifact storage is full:** release installer uploads fail, so the release cannot collect all platforms or publish. Restore available storage, then rerun the failed jobs while the successful artifacts are still available; they expire after one day. If they have expired, rerun all jobs from the same source. Build-only uploads may fail without failing the build. Never bypass collection or replace public assets by hand.
- **The release was already published:** the publisher leaves it unchanged and succeeds without re-uploading. Check its existing assets.

The package version is ahead of the public download between merging the prep PR and publishing. Finish a failed publish by rerunning its original workflow, or prepare a newer version in another PR. Keep [release-notes.md](release-notes.md) accurate as installation requirements change.

## Getting updates to existing users

### In the app: download in the background, Restart to install

Windows installations use electron-updater's NSIS updater and `latest.yml`; Linux AppImages use `latest-linux.yml` and update the file named by `APPIMAGE`. Both are ready after a verified download and install without another installer dialog. Debian packages only show the release notice and are replaced with the package manager. Windows releases are currently unsigned. The Mac-specific staging and signing checks below remain unchanged.

An installed copy asks SafaElmali/buddylist for its latest release when it starts, every hour after that, and when the Mac wakes from sleep. When that version is newer than its own, the copy downloads it in the background, and the contact list says nothing until it is ready. Then it shows **New update available** with **See changes** and **Restart**, and **When idle** while a restart would interrupt someone:

- **Restart** quits buddylist, puts the new version in its place and opens it. While a contact is working or waiting for you, it first asks, as quitting does: "Restarting to update will end 2 conversations." Quitting any other way installs the new version too.
- **When idle** is there only while a contact is working or waiting for you, and is then the default button. The card says who, such as "Claude is working." or "2 contacts are working.", and switches between the two as contacts start and finish. It is decided from the contacts the window already has, by the quit guard's own rule (`busyContacts` in [busy-contacts.js](../src/shared/busy-contacts.js)), and worded by `readyOffer` in [update-progress.js](../src/shared/update-progress.js). It restarts by itself later, once nobody would notice: no contact is working or waiting for you, and the computer has had no keyboard or mouse input for five minutes, as long as it takes to show you as Away. The card then says "It restarts by itself once you are away." and **Restart** still restarts at once. It is for that version only: a newer one found meanwhile asks again.
- **See changes** opens that version on [the changelog](landing-page.md#changelog), such as `https://buddylist.dev/changelog#v0.2.9`. **Help > What's new** opens the changelog in every copy.
- **×** hides the card for that version while the contact list is open. **Help > Check for updates...**, in the contact list or a conversation, asks at once and opens **Software Update**: a version that is not ready yet shows its download as it goes ("142 of 229 MB", then "Almost ready..." while macOS checks it), and the same dialog offers **Restart** once it is, with **When idle** first while contacts are busy, as the card does. **Hide** leaves it downloading. A download that failed is tried again right then, and one that fails while the dialog is open offers **Try again**.

The pieces:

- **The feed.** `build.publish` in `package.json` names SafaElmali/buddylist, so electron-builder writes `latest-mac.yml` next to the installers (the version, and the ZIP's name, size and SHA-512) and `Contents/Resources/app-update.yml` inside the app (where to find that file). It also writes `buddylist-mac-arm64.zip.blockmap`, with which a later update fetches only the parts of the ZIP that changed. CI publishes the three with the DMG, and **Check installers** fails without them. `--publish never` still writes them; electron-builder itself never publishes.
- **The download.** [updates.js](../src/main/updates.js) stays the one check. When it finds a newer version, [app-updater.js](../src/main/app-updater.js) has electron-updater read the feed. The feed must offer the same version, or nothing is downloaded. electron-updater fetches the ZIP and checks its SHA-512, and macOS's own updater (Squirrel) checks that the app inside is signed by the same Developer ID as the running one before it stages it. Only then is the version ready. One that fails, such as a feed that has not caught up with a new release yet, is tried again at the next check.
- **The install.** **Restart** marks the quit as answered, so the question is not asked twice, and electron-updater closes the windows and quits. Squirrel swaps the app and opens the new one. **When idle** does the same from [idle-restart.js](../src/main/idle-restart.js), which looks every five seconds, as auto-away does.

An installed Mac app opened from where it was installed, a Windows installation or a Linux AppImage downloads in the background ([app-updater.js](../src/main/app-updater.js) decides), and the update the contact list is told about says so (`inPlace`), so the window never has to guess. A copy run from the disk image or from where macOS moved it (App Translocation, for an app opened from Downloads before it was dragged into **Applications**), a run from source and a run with `BUDDYLIST_UPDATES_URL` can't, and the demo never checks. A copy that can, but whose download fails (offline, a release without the feed, or an app signed by someone else, such as an ad-hoc build of a fork), tries again at every check.

### When it can't: the update notice

A copy that can't update itself shows **Version x.y.z is available** at the top of the contact list, with **What's new** and **Update...**. **What's new** opens that version on the changelog. **Update...**, and **Help > Check for updates...** on such a copy, open the download page. On Mac, the dialog also explains that buddylist updates itself once it is in **Applications**, so quit it, drag it into Applications and open it from there. On Linux, install the new Debian package or use the AppImage for automatic updates. The dialog's **Download page** opens the download section of the landing page (`https://buddylist.dev/#download`), which always has the newest version. The app downloads no installer itself.

Copies of v0.2.7 and earlier have no updater and keep the notice they were built with; see [Copies without the updater](#copies-without-the-updater-announce-and-replace-the-app).

The check is in [updates.js](../src/main/updates.js). It reads the public release without a token. Nothing from the answer but its version reaches the windows. A failed check shows nothing by itself, and the demo and copies run from source do not check on their own.

To try the notice without publishing, serve a made-up answer and point a copy run from source at it:

```bash
BUDDYLIST_UPDATES_URL=http://localhost:8787/latest npm start
```

The answer needs a `tag_name`, as GitHub's [latest release](https://docs.github.com/en/rest/releases/releases#get-the-latest-release) has. A made-up release never downloads in the background, so it always shows the notice.

The notice and the feed only work while SafaElmali/buddylist is public: a private one answers 404 to the app, as it does to the website's download button.

### What's new

**What's new is written by hand** in [site/changelog.md](../site/changelog.md), for the people who use buddylist: each version under a `## v1.2.3 — 2026-10-12` heading, newest first, in Markdown. Write it in the prep PR under the version produced by `prepare`; the release uses that committed version unchanged.

Before publishing, the **Write release notes** step runs `node scripts/release.js notes`. It takes the release's part of the changelog as written, everything under its heading up to the next version, and writes `dist/release-notes.md`: that under **What's new**, over [release-notes.md](release-notes.md). Publishing uses that file. A version the changelog has nothing for is still released, with release-notes.md alone and a warning in the run; write it afterwards, and the changelog page shows it once the site deploys. Its GitHub description stays as published, and can be edited there. A retry of a published release changes nothing, its description included.

The changelog page lists only published stable releases, using the deployment's `SITE_RELEASES` snapshot. A merged prep PR alone does not list its version (see [the changelog](landing-page.md#changelog)).

### Where copies look: one public repository under two names

Every copy asks a repository by its name for updates, and the name is in the copy for good:

```
copies v0.2.8–v0.2.14    ask SafaElmali/buddylist-releases ─┐ GitHub's redirect
copies v0.2.15 and later ask SafaElmali/buddylist ──────────┴→ SafaElmali/buddylist (public source + releases)
```

Up to v0.2.14, releases were published to SafaElmali/buddylist-releases while the source was private. From v0.2.15 to v0.2.20 the source was public as SafaElmali/buddylist and published its own releases. On 2026-10-17 the source went private again: it was renamed to SafaElmali/buddylist-app, and buddylist-releases was renamed to SafaElmali/buddylist, with the releases from v0.2.16 to v0.2.20 copied into it. So every name a copy asks for is that public repository, the old one by GitHub's redirect for a renamed repository, and the website's download link never changed.

Two things keep it that way:

- **Never create a repository named buddylist-releases.** It would take the old name and end the redirect that copies up to v0.2.14 follow.
- **Never push private history or archival media refs to the public repository.** Public development starts with the reviewed source snapshot on the existing public history. Keep old private branches and `pr-media/*` refs in the private repository; do not merge them into a public branch or push all tags.

### Copies without the updater: announce and replace the app

Copies of v0.2.7 and earlier have no updater. They say a newer version is available, and their users replace them by hand once. Share the permanent download link through the channels where people follow the project. The release workflow does not send announcements. Copies older than the update notice say nothing at all.

Users quit buddylist, download the new DMG, and drag its app into **Applications**, replacing the previous copy. Their contacts and history are stored separately in `~/Library/Application Support/buddylist/`; replacing the application bundle does not remove that directory.

The app was called Agent Messenger up to 0.2.4. Someone who updates from one of those drags **buddylist** into **Applications** next to the old copy and deletes that one by hand. The first time buddylist opens it moves `~/Library/Application Support/Agent Messenger/` to `~/Library/Application Support/buddylist/` ([renamed.js](../src/main/renamed.js)), so their contacts and history are there. Their update notice finds no installer under the name it looks for, and links to the release's page instead.

The public installer is **Apple Silicon only**, signed and notarized, so it opens without **Open Anyway**. Releases up to v0.2.6 were ad-hoc signed and still need **System Settings → Privacy & Security → Open Anyway**. Keep the Apple Silicon limit in release notes and on the download page.
