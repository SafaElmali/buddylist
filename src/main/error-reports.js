// Error reports: what goes wrong in the app, sent to Sentry so that it can be fixed. An error
// nothing caught in this process, one a window hands over, and a process that crashed.
// docs/error-reports.md says what a report holds and how to turn them off.
import os from 'node:os';
import path from 'node:path';
import { cleanErrorReport, releaseName, scrubber } from '../shared/error-reports.js';

/**
 * Where an installed app sends its reports: the app's project at Sentry, which the build of a
 * release writes in (see services() in scripts/build-app.js). The key in it only lets a report in,
 * so it is no secret. Without an address, nothing is reported: a build of anyone else's reports
 * nowhere.
 */
export const SENTRY_DSN = process.env.SENTRY_DSN ?? '';

// What the SDK would gather by itself and a report does without. The first three keep a trail of
// what led up to an error, out of what this process wrote to its console and the addresses it
// asked for: in an app that sits beside someone's code, that is theirs. The last puts a script
// of the SDK's into every window, for an SDK there. The windows have none: see fromWindow.
const LEFT_OUT = ['Console', 'NodeFetch', 'ElectronNet', 'PreloadInjection'];

/** The page a window shows, as a report names it: "chat" for chat.html. */
function pageOf(address) {
  try {
    return path.basename(new URL(address).pathname, '.html');
  } catch {
    return '';
  }
}

/**
 * @typedef {Object} ErrorReports
 * @property {(on: boolean) => void} setEnabled  turns reporting on or off, from now on
 * @property {(report: unknown, address: string) => void} fromWindow  reports an error nothing caught
 *   in a window, which shows the page at this address
 */

/** @type {ErrorReports} */
const NOT_REPORTING = Object.freeze({ setEnabled() {}, fromWindow() {} });

/**
 * Starts reporting errors, for as long as the app runs. Call it before the app is ready: what
 * goes wrong while it starts is reported too, and so is the crash that ended the last run.
 * @param {object} to
 * @param {typeof import('@sentry/electron/main') | null} to.sentry  the SDK; not needed without an address
 * @param {string} to.dsn  where reports go; '' for nowhere
 * @param {string} to.version  the app's
 * @param {boolean} to.enabled  whether the user has reports on
 * @param {string} [to.home]  the home folder, which a report never spells out
 * @returns {ErrorReports}
 */
export function startErrorReports({ sentry, dsn, version, enabled, home = os.homedir() }) {
  if (!dsn) return NOT_REPORTING;
  const scrub = scrubber(home);
  // An app that starts with reports off starts nothing of the SDK's, until they are turned on.
  let started = false;
  const start = () => {
    started = true;
    sentry.init({
      dsn,
      release: releaseName(version),
      // Neither the user's address on the network nor anything else about who they are.
      sendDefaultPii: false,
      dataCollection: { userInfo: false },
      integrations: (gathered) => gathered.filter(({ name }) => !LEFT_OUT.includes(name)),
      // The SDK's other way to hear from a window registers a scheme of its own, which would
      // take the place of the app's (pack://): only one list of schemes can be registered.
      ipcMode: sentry.IPCMode.Classic,
      beforeSend(report) {
        // The language and the time zone someone works in say nothing about an error.
        delete report.contexts?.culture;
        return scrub(report);
      },
      beforeBreadcrumb: scrub,
    });
  };
  if (enabled) start();
  return {
    setEnabled(on) {
      if (!started && on) start();
      // Read by the SDK for everything it is about to send, a crash's dump included.
      else if (started) sentry.getClient().getOptions().enabled = on;
    },
    fromWindow(report, address) {
      const said = started && cleanErrorReport(report);
      if (!said) return;
      // A built script says which source map reads its stacks, and the SDK looks that up here
      // for whatever it reports: this process's own script, and now the window's too.
      globalThis._sentryDebugIds = Object.assign(globalThis._sentryDebugIds ?? {}, said.debugIds);
      const error = new Error(said.message);
      error.name = said.name;
      error.stack = said.stack || `${said.name}: ${said.message}`;
      sentry.captureException(error, {
        captureContext: { tags: { window: pageOf(address) } },
        data: { mechanism: { handled: false, type: 'window' } },
      });
    },
  };
}
