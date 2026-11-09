// Help menu dialogs and items shared by every window.
import { el, html, raw } from './dom.js';
import { infoDialog } from './dialog.js';
import { appIcon } from './icons.js';
import { CHANGELOG_URL } from '../../shared/release-notes.js';
import { shortcutKeys, shortcutLabel, systemOf } from '../../shared/shortcuts.js';
import { findKeyLabel } from '../../shared/terminal.js';
import { voiceSettings } from '../../shared/voice-settings.js';
import { COFFEE_URL, DOCS_URL } from '../../shared/web-pages.js';

const IS_MAC = navigator.platform.toLowerCase().includes('mac');
const SYSTEM = systemOf(navigator.platform);

/**
 * Help > Help topics, as MSN Messenger had it: the docs, in the browser.
 * @param {(url: string) => unknown} open  opens a web address in the browser (api.app.openExternal)
 */
export const docsItem = (open) => ({ label: 'Help topics', action: () => open(DOCS_URL) });

/**
 * Help > What's new: every version and what is new in it, on the website's changelog. The
 * browser preview opens it in a tab of its own, beside the page it is on.
 * @param {(url: string) => unknown} open  opens a web address in the browser (api.app.openExternal)
 */
export const whatsNewItem = (open) => ({ label: "What's new", action: () => open(CHANGELOG_URL) });

/**
 * Help > Buy me a coffee: the page to buy one on, in the browser.
 * @param {(url: string) => unknown} open  opens a web address in the browser (api.app.openExternal)
 */
export const coffeeItem = (open) => ({ label: 'Buy me a coffee', action: () => open(COFFEE_URL) });

/**
 * Help > About buddylist, with the version this copy is.
 * @param {() => Promise<string>} version  asks which version that is (api.app.version)
 */
export const aboutItem = (version) => ({ label: 'About buddylist', action: () => showAbout(version) });

/** @param {() => Promise<string>} askVersion */
async function showAbout(askVersion) {
  // As its package says; nothing when the app can't be asked.
  const version = await Promise.resolve()
    .then(askVersion)
    .catch(() => '');
  return infoDialog(
    'About buddylist',
    el(
      html`<div class="about">
        <div class="about-mark">${raw(appIcon(48))}</div>
        <div>
          <p><b>buddylist</b> ${version}</p>
          <p>
            Chat with AI coding agents in a classic messenger window.<br />Each conversation is a real Claude Code,
            Codex, Gemini, OpenCode or Hermes session.
          </p>
        </div>
      </div>`
    )
  );
}

/**
 * Help > Keyboard shortcuts: every one, with the keys you chose under Settings > Shortcuts.
 * @param {object} [settings]  the app's settings, for the shortcuts you can change
 * @param {{ web?: boolean }} [opts]  `web`: this is the browser preview, which has no browser of its own
 */
export function showShortcuts(settings, { web = false } = {}) {
  const keys = shortcutKeys(settings, SYSTEM);
  const label = (id) => shortcutLabel(keys[id], IS_MAC);
  const { voiceMode } = voiceSettings(settings);
  const rows = [
    ...(!web
      ? [
          [label('contacts'), 'From any app: open the contact list'],
          [label('quickSend'), 'From any app: quick-send to the last-viewed contact'],
          [label('settings'), 'Settings: what the app does, and what each project is set up with'],
        ]
      : []),
    ['Enter', 'Send'],
    ['Shift+Enter', 'New line'],
    ['↑ / ↓', 'Step through the messages you sent, from the first or last line of the message box'],
    ['Esc twice', 'Nudge: stop what your contact is doing'],
    [
      voiceMode === 'press' ? label('voice') : `Hold ${label('voice')}`,
      'Voice clip: say your message instead of typing it',
    ],
    [label('accept'), 'Accept the latest invitation'],
    [label('decline'), 'Decline the latest invitation'],
    [label('newTab'), 'Another chat in the same folder, in a tab of its own'],
    [label('contactsPane'), 'Contacts: your contacts beside the conversation, and away'],
    [label('changes'), 'Changes: what has changed in the working folder'],
    [label('helpers'), 'Subagents: what your contact’s subagents are doing'],
    [label('background'), 'Background: what your contact left running there'],
    ['@', 'With several contacts in a conversation: pick who should answer'],
    [label('terminal'), 'Terminal: your own shell in the working folder, and back'],
    [label('newTerminal'), 'Another terminal, in a tab of its own'],
    [findKeyLabel(IS_MAC, false), 'Find in the conversation'],
    [findKeyLabel(IS_MAC, true), 'In a terminal: find in what it printed'],
    ...(web ? [] : [[label('browser'), 'Browser: a web page beside the conversation']]),
    [label('palette'), 'Jump to a contact, a past conversation, a file or anything in the menus'],
    ['↑ / ↓, Enter', 'Pick a contact and open a conversation'],
    ['A letter', 'In a contact’s menu: choose the item with that letter at its end'],
    // A browser keeps this one for its own windows.
    ...(web ? [] : [[label('addContact'), 'In the contact list: add a contact like the last one']]),
  ];
  return infoDialog(
    'Keyboard Shortcuts',
    el(
      html`<div>
        <table class="shortcuts">
          ${rows.map(
            ([key, what]) =>
              html`<tr>
                <td><kbd>${key}</kbd></td>
                <td>${what}</td>
              </tr>`
          )}
        </table>
        ${web ? '' : html`<p class="hint">Change them in Settings, under Shortcuts.</p>`}
      </div>`
    )
  );
}
