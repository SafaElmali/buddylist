import { fallbacksPage } from './fallbacks.js';
// The Settings pages that are about the app as a whole: how it looks, what a
// conversation shows, what it sends, its shortcuts, where each service's program
// is, the accounts its agents answer in, the models it offers, what a new contact starts out with, the agents that
// join a new contact, the prompts that start one by themselves, the branches, variables and instructions every project
// shares, and the instructions kept for any project.
import { api } from '../lib/api.js';
import { el, errorText, html } from '../lib/dom.js';
import { voiceDialog } from '../lib/voice-dialog.js';
import { modelsDialog } from '../contacts/models-dialog.js';
import { askModels, modelsOf } from '../contacts/models.js';
import { BRANCH_PREFIX_MAX, branchPrefix, prefixed } from '../../shared/branch-names.js';
import { APP_SETTINGS } from '../../shared/settings-pages.js';
import { LOOKS, lookOf, THEMES, themeOf } from '../../shared/theme.js';
import { accountsPage } from './accounts.js';
import {
  button,
  field,
  foldList,
  group,
  listEditor,
  pageLinks,
  pictureChoice,
  row,
  textBox,
  toggle,
} from './controls.js';
import { environmentGroups } from './environment.js';
import { instructionGroups } from './instructions.js';
import { newContactsPage } from './new-contacts.js';
import { remotePage } from './remote.js';
import { schedulesPage } from './schedules.js';
import { modelsLine, serviceLine } from './service-lines.js';
import { shortcutsPage } from './shortcuts.js';
import { teamsPage } from './teams.js';

/** @typedef {import('./main.js').PageContext} PageContext */

// Close-ups of a conversation, at about half its size, so their colours read at a glance. A look's is the
// corner of the window, by day and at night. scripts/make-theme-pictures.js takes them.
export const lookPicture = (look) => html`<img src="settings/pictures/look-${look}.webp" alt="" />`;

// A theme's is in each look: the messenger's title bar and toolbar, or the professional look's Accept
// button. The one of the look in use is shown, so a change of look changes them too.
export const themePicture = (theme) =>
  LOOKS.map(
    ({ id }) => html`<img src="settings/pictures/${id}-${theme}.webp" data-look="${id}" alt="" loading="lazy" />`
  );

// A branch as the first message would name it, to show the prefix on.
const EXAMPLE = 'fix-login';

/** @param {PageContext} ctx */
function general(ctx) {
  const { settings, platform, save } = ctx;
  const web = platform === 'web';
  return [
    group(
      'Look',
      'The messenger, or a quiet professional look. Either one comes in the theme below.',
      pictureChoice({
        value: lookOf(settings.look),
        label: 'Look',
        options: LOOKS.map(({ id, label }) => ({ value: id, label, picture: lookPicture(id) })),
        onSave: (look) => save({ look }),
      })
    ),
    group(
      'Theme',
      'Light, dark, or whichever your system is showing, in Luna’s blue. Or Olive Green, Silver, Royale or Pink, by day or at night.',
      pictureChoice({
        value: themeOf(settings.theme),
        label: 'Theme',
        options: THEMES.map(({ id, label }) => ({ value: id, label, picture: themePicture(id) })),
        onSave: (theme) => save({ theme }),
      })
    ),
    toggle({
      label: 'Sounds',
      hint: 'Play a sound when a contact signs in, sends a message or nudges you.',
      checked: settings.sounds,
      onChange: (sounds) => save({ sounds }),
    }),
    // A browser can't tell that the computer is idle.
    !web &&
      toggle({
        label: 'Show me as Away when I’m not here',
        hint: 'While the computer sits idle. Your contacts keep working.',
        checked: settings.autoAway,
        onChange: (autoAway) => save({ autoAway }),
      }),
    group(
      'Voice clips',
      'Which keys record one, and whether what you said is sent at once.',
      row(button('Voice clips...', () => voiceDialog(ctx.settings)))
    ),
  ];
}

/** @param {PageContext} ctx */
function conversations({ settings, platform, save }) {
  const web = platform === 'web';
  return [
    !web &&
      toggle({
        label: 'Open windows maximized',
        hint: 'New conversation windows fill the screen’s work area. Restore brings them back to their usual size. Windows already open keep their size.',
        checked: settings.openWindowsMaximized === true,
        onChange: (openWindowsMaximized) => save({ openWindowsMaximized }),
      }),
    toggle({
      label: 'Show what contacts do',
      hint: 'A line in the conversation for each thing an agent does, such as “Claude ran npm test”.',
      checked: settings.showActivity,
      onChange: (showActivity) => save({ showActivity }),
    }),
    toggle({
      label: 'Suggest replies',
      hint: 'After a reply, the message you would most likely send next, grey in the empty box for Tab to write in. When an agent asks you something, a few answers under it to send with a click too. Its quickest model writes them.',
      checked: settings.suggestReplies !== false,
      onChange: (suggestReplies) => save({ suggestReplies }),
    }),
    // The browser preview has no browser beside a conversation (docs/browser-tab.md).
    !web &&
      toggle({
        label: 'Open links beside the conversation',
        hint: 'A click on a link in a conversation opens it in the browser there, not in your own. A right-click offers both.',
        checked: settings.linksBeside === true,
        onChange: (linksBeside) => save({ linksBeside }),
      }),
    toggle({
      label: 'Start the conversations Claude adds',
      hint: 'Claude can add a conversation for a side task it comes across. It gets to work at once, as one you ask for does, instead of waiting in your list for you to send its first message.',
      warning:
        'It works in the mode of the conversation that added it, so in one that asks nothing first it changes files on its own.',
      checked: settings.startConversations === true,
      onChange: (startConversations) => save({ startConversations }),
    }),
  ];
}

/** @param {PageContext} ctx */
function privacy({ settings, platform, save }) {
  // Only the app counts what it is used for and reports its errors (docs/analytics.md, docs/error-reports.md).
  if (platform === 'web')
    return [group('Nothing is sent', 'The preview in a browser counts nothing and reports no errors.')];
  return [
    toggle({
      label: 'Share anonymous usage counts',
      hint: 'Which features are used, counted. Never what you type, your folders, or what your contacts do.',
      checked: settings.shareUsage,
      onChange: (shareUsage) => save({ shareUsage }),
    }),
    toggle({
      label: 'Send error reports',
      hint: 'An error the app did not expect, and a crash. Never your conversations, your name or your home folder.',
      checked: settings.errorReports !== false,
      onChange: (errorReports) => save({ errorReports }),
    }),
  ];
}

/** @param {PageContext} ctx */
function quickMessages({ settings, save }) {
  return [
    group(
      'Messages',
      'The name is what the list calls one. Left empty, it is the message’s first words.',
      listEditor({
        items: settings.quickMessages ?? [],
        fields: [
          { key: 'name', placeholder: 'Name', label: 'Name' },
          { key: 'text', placeholder: 'What goes in the message box', kind: 'prose', label: 'Message' },
        ],
        add: 'Add quick message',
        empty: 'No quick messages yet.',
        onChange: (items) => save({ quickMessages: items }),
      })
    ),
  ];
}

/** @param {PageContext} ctx */
function everyProjectInstructions(ctx) {
  return [
    pageLinks([
      {
        label: 'Instruction presets',
        value: 'Manage reusable text for these boxes and any project’s Instructions',
        go: () => ctx.go('instruction-presets'),
      },
    ]),
    ...instructionGroups(ctx, {
      told: () => ctx.settings.instructions,
      save: (instructions) => ctx.save({ instructions }),
      every: true,
    }),
  ];
}

/** @param {PageContext} ctx */
function instructionPresets({ settings, save, go }) {
  return [
    row(button('Back to Instructions', () => go('every-project-instructions'))),
    group(
      'Presets',
      'The name is what the Presets list calls one. Left empty, it is the instructions’ first words. Adding one to a box of Instructions copies its words there, so changing it here leaves the boxes that have it as they are.',
      listEditor({
        items: settings.instructionPresets ?? [],
        fields: [
          { key: 'name', placeholder: 'Name', label: 'Name' },
          { key: 'text', placeholder: 'What a project’s agents are told', kind: 'prose', label: 'Instructions' },
        ],
        add: 'Add preset',
        empty: 'No presets yet.',
        onChange: (items) => save({ instructionPresets: items }),
      })
    ),
  ];
}

/** @param {PageContext} ctx */
function models({ providers }) {
  const list = foldList({
    items: () => providers,
    name: (provider) => provider.name,
    summary: (provider) => modelsLine(modelsOf(provider)),
    settings: (provider) => [
      el(html`<p class="st-hint">The models to choose from for a ${provider.name} contact. Default is always one.</p>`),
      row(
        button(
          'Choose models...',
          async () => {
            await modelsDialog(provider);
            list.relabel();
          },
          { kind: 'primary' }
        )
      ),
    ],
    empty: '',
  });
  // What a service calls its models arrives a moment later. One that can't say keeps the names known so far.
  for (const provider of providers) askModels(provider).then(list.relabel, () => {});
  return [list.node];
}

/** @param {PageContext} ctx */
function git({ settings, save }) {
  const example = el('<p class="st-hint"></p>');
  // What is typed is kept the way a branch can carry it: the example shows what comes of it.
  const showExample = (value) => {
    example.textContent = `A new branch is called ${prefixed(branchPrefix(value), EXAMPLE)}.`;
  };
  showExample(settings.branchPrefix);
  return [
    group(
      'Branch prefix',
      'What goes in front of the branches made for contacts, so that they sit with your other branches.',
      row(
        textBox({
          value: settings.branchPrefix,
          placeholder: 'Nothing',
          label: 'Branch prefix',
          mono: true,
          maxlength: BRANCH_PREFIX_MAX,
          onSave: (value) => save({ branchPrefix: value }),
          onInput: showExample,
        })
      ),
      example
    ),
    toggle({
      label: 'Name a branch after the work',
      hint: 'A new contact’s branch starts out with a made-up name, such as shop-2. The first thing you ask the contact for names it: Claude puts it in a few words.',
      checked: settings.renameBranches,
      onChange: (renameBranches) => save({ renameBranches }),
    }),
    toggle({
      label: 'Remove worktrees with contacts',
      hint: 'Whether “remove its worktree” starts out ticked when you delete a contact. Deleting still asks.',
      checked: settings.removeWorktrees,
      onChange: (removeWorktrees) => save({ removeWorktrees }),
    }),
    toggle({
      label: 'Delete the branch with its worktree',
      hint: 'When a contact’s worktree is removed, its branch is deleted on this computer too. What was pushed stays on the remote.',
      warning: 'Commits that were only on that branch can’t be brought back.',
      checked: settings.deleteBranches,
      onChange: (deleteBranches) => save({ deleteBranches }),
    }),
    toggle({
      label: 'Archive contacts once their pull request is merged',
      hint: 'As Archive next to the Merged tag does. One that is working finishes first. Its conversation and its folder are kept. Archive once merged, in the ▼ of View PR, says otherwise for one contact.',
      checked: settings.archiveMerged,
      onChange: (archiveMerged) => save({ archiveMerged }),
    }),
  ];
}

/** @param {PageContext} ctx */
function agents(ctx) {
  const { providers, save } = ctx;
  /** How each service's program stands, by service, once it has said. */
  const setups = new Map();
  /** What to do about one that is not ready, in the words the welcome wizard has for it, by service. */
  const notes = new Map();
  const checks = new Map();
  const refreshes = new Map();
  // As they are now: a path that was just saved is the one its line names.
  const pathOf = (provider) => ctx.settings.agents?.[provider.id]?.path ?? '';
  const sayNote = (provider) => {
    const note = notes.get(provider.id);
    if (!note) return;
    const setup = setups.get(provider.id);
    note.textContent = [setup?.path && `Executable: ${setup.path}`, setup?.note].filter(Boolean).join('\n');
    note.hidden = !note.textContent;
  };
  const check = async (provider) => {
    const token = {};
    checks.set(provider.id, token);
    setups.delete(provider.id);
    list.relabel();
    sayNote(provider);
    refreshes.get(provider.id)?.();
    let setup;
    try {
      setup = await api.providers.status(provider.id);
    } catch (err) {
      setup = { state: 'unknown', note: errorText(err) || 'The check failed. Try Check again.' };
    }
    // A path saved while a check was running gets its own answer, never the old path's.
    if (checks.get(provider.id) !== token) return;
    checks.delete(provider.id);
    setups.set(provider.id, setup);
    list.relabel();
    sayNote(provider);
    refreshes.get(provider.id)?.();
  };
  const list = foldList({
    items: () => providers,
    name: (provider) => provider.name,
    summary: (provider) => serviceLine(setups.get(provider.id), pathOf(provider)),
    settings: (provider, { label }) => {
      // An empty box uses automatic detection.
      const use = async (path) => {
        box.value = path;
        if (await save({ agents: { [provider.id]: { path } } })) {
          label();
          check(provider);
        } else {
          box.value = pathOf(provider);
          paint();
        }
      };
      const box = textBox({
        value: pathOf(provider),
        placeholder: 'Leave empty to detect automatically',
        label: `${provider.name} custom executable path`,
        mono: true,
        onSave: (path) => use(path),
      });
      const reset = button('Use default', () => use(''));
      const retry = button('Check again', () => check(provider));
      const paint = () => {
        reset.disabled = !pathOf(provider);
        retry.disabled = checks.has(provider.id);
      };
      refreshes.set(provider.id, paint);
      paint();
      notes.set(provider.id, el('<p class="st-hint st-service-note" role="status" hidden></p>'));
      sayNote(provider);
      const advanced = el(
        '<details class="st-service-advanced"><summary>Use a different installation</summary></details>'
      );
      advanced.open = Boolean(pathOf(provider));
      advanced.append(
        el(
          '<p class="st-hint">Only choose a program here to override automatic detection. Leave the path empty to use the default installation.</p>'
        ),
        field('Custom executable path (optional)', box),
        row(
          button('Choose executable...', async () => {
            const path = await api.app.pickFile('program', box.value);
            if (path) use(path);
          }),
          reset
        )
      );
      return [
        row(
          retry,
          button('Setup guide', () => api.app.openExternal('https://buddylist.dev/docs/welcome-wizard.html')),
          provider.accounts && button('Account settings', () => ctx.go('accounts'))
        ),
        notes.get(provider.id),
        advanced,
      ];
    },
    empty: '',
  });
  for (const provider of providers) check(provider);
  return [list.node];
}

/** @param {PageContext} ctx */
function environment({ settings, save }) {
  return environmentGroups({ env: settings.env ?? [], envFiles: settings.envFiles ?? [], save });
}

/**
 * What each page about the app says under its title, and what is on it, by its id. Their names, and the
 * order the window lists them in, are in shared/settings-pages.js, where the palette (⌘K) finds them too.
 * @type {Record<string, Pick<import('./main.js').Page, 'lead' | 'render'>>}
 */
const CONTENT = {
  fallbacks: {
    lead: 'Backup services that can continue an interrupted request after a confirmed usage limit or repeated service failures.',
    render: fallbacksPage,
  },
  general: { lead: 'How buddylist looks and sounds, and when it says you are away.', render: general },
  conversations: {
    lead: 'How conversation windows open, what they show, where links open, and the conversations Claude adds.',
    render: conversations,
  },
  privacy: { lead: 'What buddylist sends about how it is used, and never what you type.', render: privacy },
  remote: {
    lead: 'Answer your agents from your phone, wherever you are: the ones waiting for you, the ones at work, and any conversation.',
    render: remotePage,
  },
  shortcuts: {
    lead: 'The keys for what buddylist does. Click a box, then press the keys you want to use.',
    render: shortcutsPage,
  },
  'quick-messages': {
    lead: 'Messages you put in the message box with a click, from the quick messages button under every conversation.',
    render: quickMessages,
  },
  teams: {
    lead: 'Agents that join a new contact’s conversation with it, such as a reviewer that looks over every change, and how many turns they take.',
    render: teamsPage,
  },
  models: { lead: 'Which models “Add a Contact” offers for each service.', render: models },
  schedules: {
    lead: 'Prompts that start a contact by themselves, on a cadence you pick, while buddylist is open.',
    render: schedulesPage,
  },
  'new-contacts': {
    lead: 'What “Add a Contact” starts out with for each service: its model, effort level and mode. You can still change them there.',
    render: newContactsPage,
  },
  git: { lead: 'The branches and worktrees made for your contacts.', render: git },
  agents: {
    lead: 'Each service uses a command-line app, such as Claude Code or Codex CLI, to run your agents. buddylist finds it automatically; Claude Code comes bundled. Set a path only to use a different install. Changes apply to new conversations.',
    render: agents,
  },
  accounts: {
    lead: 'The accounts your contacts answer in, their usage limits and reset times. Choose an account or let buddylist switch before a new turn.',
    render: accountsPage,
  },
  environment: {
    lead: 'Variables the scripts, terminals and agents of every project are started with. A project’s own win over these.',
    render: environment,
  },
  'every-project-instructions': {
    lead: 'What the contacts of every project are told on top of what you type, before their project’s own Instructions. Only you change these: an agent can change its project’s, not these.',
    render: everyProjectInstructions,
  },
  'instruction-presets': {
    lead: 'Instructions you keep for any project, such as how to show that a change works. Presets, beside each box of Instructions, here under Every project or a project’s, adds one with a click.',
    render: instructionPresets,
  },
};

/**
 * The pages about the app, in the order the window lists them.
 * @type {import('./main.js').Page[]}
 */
export const APP_PAGES = APP_SETTINGS.map((page) => ({ ...page, ...CONTENT[page.id] }));
