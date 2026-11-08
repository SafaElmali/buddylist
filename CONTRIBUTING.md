# Contributing

Thanks for helping with buddylist. Bugs and ideas are welcome as issues, or through **Help → Send feedback...** in the app. For a security problem, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## Run it

You need macOS, Windows or Linux, [Node.js](https://nodejs.org) 22.13 or newer (CI uses 22) and Git. The lockfile is npm's, so use npm:

```bash
npm ci
npm start      # the app, from src/ as it is
npm run demo   # the app with scripted contacts: no agent, no login
```

Nothing else is needed: no account of the project's, no key and no secret. A run from the source never reports errors or counts what it is used for, and neither does a build you make yourself (see [Error reports](docs/error-reports.md) and [Analytics](docs/analytics.md)).

## Check it

```bash
npm test       # every test, with Node's own runner
npm run lint   # ESLint and Prettier
```

Run a single file with `node --test test/<name>.test.js`. Please keep both green, and add a test for what you change: most of the code is plain modules that the tests drive without Electron.

`npm run build:app` bundles the app as it ships, and `npm run dist` (or `dist:win`, `dist:linux`) packs an installer for the computer you're on. [Build the app](docs/building.md) says what each does, and which checks CI runs on the installers.

## Find your way

- [How the code is organized](docs/architecture.md): providers, session events and the windows.
- [Adding a provider](docs/adding-a-provider.md): a new kind of agent.
- `src/main` is Electron's main process, `src/renderer` the windows, `src/shared` what both use, and `src/providers` one folder per kind of agent. The guides in `docs/` are also the site's [docs](https://buddylist.dev/docs).

Write code like the code around it: plain modules, a comment that says what something is for, and a guide in `docs/` updated when what people see changes.

## Send a change

- One change per pull request, with what it does and how you checked it.
- For anything on screen, add screenshots of each screen it changes, in both looks (Professional and Messenger) where they differ.
- Code copied from elsewhere keeps its license at the top of its file, and goes in `VENDORED` in [`scripts/notices.js`](scripts/notices.js), so the builds' third-party notices name it. A new package needs a license that allows that too.
- Don't add media you don't have the rights to. The MSN Messenger sounds and Winks and the Claude marks already in the app are not covered by the project's license (see [License and credits](README.md#license-and-credits)).

By sending a pull request, you agree that your contribution is under the project's [MIT License](LICENSE).

## Releases of your own

A fork's builds work as they are, without the project's services. To publish your own releases, change `build.publish` in `package.json`, or installed copies will look for updates in this repository's releases, and see [Releases and updates](docs/releases.md) for the variables and secrets the workflows read.
