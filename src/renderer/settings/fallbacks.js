import { api } from '../lib/api.js';
import { modelPicker, servicePicker } from '../contacts/model-picker.js';
import { askModels } from '../contacts/models.js';
import { el, html } from '../lib/dom.js';
import { fallbackPolicy, cleanFallbackPolicy } from '../../shared/fallback-policy.js';
import {
  button,
  choice,
  field,
  fields,
  foldList,
  group,
  groupWithButton,
  pickerField,
  row,
  toggle,
} from './controls.js';

/** The same ordered rules editor is used globally and for a project's override. */
export function fallbacksPage(ctx) {
  const project = ctx.project;
  let inherit = Boolean(project && project.settings.fallbacks == null);
  let policy = fallbackPolicy(ctx.settings, project?.settings.fallbacks);
  let saved = structuredClone({ policy, inherit });
  let saving = Promise.resolve();
  const root = el('<div class="st-fallbacks"></div>');
  const write = async () => {
    const patch = { fallbacks: project && inherit ? null : cleanFallbackPolicy(policy) };
    const pending = structuredClone({ policy, inherit });
    saving = saving.then(async () => {
      const ok = await (project ? ctx.saveProject(patch) : ctx.save(patch));
      if (ok) saved = pending;
      else {
        ({ policy, inherit } = structuredClone(saved));
        draw();
      }
      return ok;
    });
    return saving;
  };
  const name = (entry) => ctx.providers.find((provider) => provider.id === entry.provider)?.name || entry.provider;
  const paidLabels = { never: 'Never use paid usage', ask: 'Ask before possible charges', allow: 'Allow paid usage' };
  const triggerNames = { session: 'Session limit', weekly: 'Weekly limit', unavailable: 'Service unavailable' };
  const accountNames = new Map();
  const accountRequests = new Map();
  let refreshSummaries = () => {};
  const accountLine = (entry) => {
    const provider = ctx.providers.find((one) => one.id === entry.provider);
    if (!provider?.accounts) return 'Uses this service’s CLI login';
    if (entry.account === 'current') return 'Account in use when the fallback starts';
    if (!accountNames.has(entry.provider)) return 'Checking selected account...';
    const accounts = accountNames.get(entry.provider);
    if (!accounts) return 'Selected account could not be checked';
    const account = accounts.find((one) => one.id === entry.account);
    if (!account) return 'Selected account unavailable';
    return `${account.name || account.email || 'Terminal login'}${account.signedIn === false ? ' (signed out)' : ''}`;
  };
  const summary = (entry) =>
    [
      `${entry.triggers.map((trigger) => triggerNames[trigger]).join(', ') || 'No triggers selected'} · ${accountLine(entry)}`,
      `${paidLabels[entry.paid]}${entry.paid === 'never' ? ' (currently skipped)' : ''}${entry.minRemaining ? ` · At least ${entry.minRemaining}% remaining` : ''}${entry.ask ? ' · Always asks' : ''}`,
    ].join('\n');
  // Read saved account names for the overview without refreshing usage or changing the selected account.
  const readAccounts = (provider) => {
    if (!accountRequests.has(provider.id)) {
      accountRequests.set(
        provider.id,
        api.accounts.list(provider.id, false).then(
          (accounts) => {
            accountNames.set(provider.id, accounts);
            refreshSummaries();
          },
          () => {
            accountNames.set(provider.id, null);
            refreshSummaries();
          }
        )
      );
    }
  };
  const spendingNote = () =>
    el(
      html`<p class="st-hint">
        <strong>“Never use paid usage” rules are currently skipped.</strong> Live integrations cannot guarantee a
        spending lock for the whole turn. Remaining allowance is not a spending lock. Other paid-use choices may allow
        charges.
      </p>`
    );
  function draw() {
    root.replaceChildren();
    refreshSummaries = () => {};
    if (project)
      root.append(
        field(
          'Fallback rules for this project',
          choice({
            value: inherit ? 'inherit' : 'own',
            label: 'Fallback rules for this project',
            options: [
              { value: 'inherit', label: 'Use global fallback rules' },
              { value: 'own', label: 'Use this project’s rules' },
            ],
            onSave: async (value) => {
              inherit = value === 'inherit';
              if (await write()) draw();
            },
          })
        )
      );
    if (inherit) {
      const destinations = el('<ol class="st-fallback-inherited"></ol>');
      const lines = policy.entries.map((entry) => {
        const line = el(
          html`<li><strong>${name(entry)} · ${entry.model || 'Default model'}</strong><span></span></li>`
        );
        destinations.append(line);
        return { entry, text: line.querySelector('span') };
      });
      refreshSummaries = () => {
        for (const { entry, text } of lines) text.textContent = summary(entry);
      };
      refreshSummaries();
      root.append(
        groupWithButton(
          `Global fallbacks are ${policy.enabled ? 'on' : 'off'}`,
          `This project follows the global rules below. ${policy.automatic ? 'Eligible rules can switch automatically; spending consent and “Always ask” still apply.' : 'Each switch asks first.'} Choose this project’s rules above to change them only here.`,
          button('Edit global fallbacks', () => ctx.go('fallbacks')),
          policy.entries.length ? destinations : el('<p class="st-hint">No backup services are configured.</p>'),
          policy.entries.some((entry) => entry.paid === 'never') && spendingNote()
        )
      );
      return;
    }
    const options = el('<div class="st-fallback-options"></div>');
    options.append(
      toggle({
        label: 'Use backup services',
        checked: policy.enabled,
        hint: 'Try these rules in order after a matching interruption.',
        onChange: async (enabled) => {
          policy.enabled = enabled;
          await write();
        },
      }),
      toggle({
        label: 'Switch automatically after checks',
        checked: policy.automatic,
        hint: 'Ask before switching when off. Spending consent and “Always ask” still apply to each turn.',
        onChange: async (automatic) => {
          policy.automatic = automatic;
          await write();
        },
      })
    );
    root.append(options);
    const list = foldList({
      items: () => policy.entries,
      name: (entry) => `${policy.entries.indexOf(entry) + 1}. ${name(entry)} · ${entry.model || 'Default model'}`,
      summary,
      empty: 'No backup services yet. Add a fallback to choose which service may continue and when.',
      settings: (entry, { label, redraw }) => {
        const provider = ctx.providers.find((one) => one.id === entry.provider);
        const change = async (patch) => {
          Object.assign(entry, patch);
          label();
          return write();
        };
        // Picked as Add a Contact picks one, with any other typed in, and "Default" saying which model it comes to.
        const model = pickerField('Model', {
          value: entry.model,
          kind: 'model',
          make: (combo, input) => modelPicker(combo, input, () => provider),
          onSave: (id) => change({ model: id }),
        });
        // The models the service says it has now arrive a moment later. One that can't say keeps its built-in ones.
        askModels(provider).then(model.show, () => {});
        const accounts = choice({
          value: entry.account,
          label: `${name(entry)} fallback account`,
          options: [{ value: 'current', label: 'Account currently in use' }],
          onSave: (account) => change({ account }),
        });
        if (provider.accounts) {
          api.accounts
            .list(provider.id, true)
            .then((all) => {
              accountNames.set(provider.id, all);
              refreshSummaries();
              accounts.replaceChildren(new Option('Account currently in use', 'current'));
              for (const account of all) {
                const option = new Option(account.name || account.email || 'Terminal login', account.id);
                option.disabled = account.signedIn === false;
                accounts.append(option);
              }
              if (![...accounts.options].some((option) => option.value === entry.account))
                accounts.append(new Option('Account unavailable — choose another', entry.account));
              accounts.value = entry.account;
            })
            .catch(() => ctx.said('Could not check accounts. Try the Accounts page.', true));
        }
        const triggers = el('<div class="st-fallback-triggers st-toggles"></div>');
        const checkRole = document.documentElement.dataset.look === 'professional' ? 'switch' : 'checkbox';
        for (const [value, words] of Object.entries(triggerNames)) {
          const control = el(
            html`<label class="st-toggle"><input type="checkbox" role="${checkRole}" /><span>${words}</span></label>`
          );
          const input = control.querySelector('input');
          input.checked = entry.triggers.includes(value);
          input.addEventListener('change', () =>
            change({
              triggers: input.checked ? [...entry.triggers, value] : entry.triggers.filter((one) => one !== value),
            })
          );
          triggers.append(control);
        }
        const move = (by) => {
          const i = policy.entries.indexOf(entry);
          [policy.entries[i], policy.entries[i + by]] = [policy.entries[i + by], entry];
          write().then(() => list.show(entry.id));
        };
        const up = button('Move up', () => move(-1));
        up.disabled = policy.entries[0] === entry;
        const down = button('Move down', () => move(1));
        down.disabled = policy.entries.at(-1) === entry;
        return [
          fields(
            pickerField('Service', {
              value: entry.provider,
              kind: 'service',
              make: (combo, input) => servicePicker(combo, input, ctx.providers),
              onSave: async (id) => {
                await change({ provider: id, model: '', account: id === 'claude' ? 'current' : '' });
                redraw();
              },
            }).node,
            model.node
          ),
          provider.accounts && field('Account', accounts),
          provider.accounts && row(button('Account settings', () => ctx.go('accounts'))),
          el(
            html`<p class="st-hint">
              ${
                provider.accounts
                  ? '“Account currently in use” is resolved when recovery starts. Choosing a named account keeps this rule tied to that account.'
                  : 'This service uses its CLI login. Manage that sign-in with the service’s own app or command-line tool.'
              }
            </p>`
          ),
          group(
            'Use after',
            'Session and weekly limits must be confirmed by the service. Unavailable means two confirmed server failures within ten minutes; one transient error does not switch services.',
            triggers
          ),
          field(
            'Paid usage',
            choice({
              value: entry.paid,
              label: `${name(entry)} paid usage`,
              options: Object.entries(paidLabels).map(([value, words]) => ({ value, label: words })),
              onSave: (paid) => change({ paid }),
            })
          ),
          el(
            html`<p class="st-hint">
              Never requires verified provider protection against charges throughout the turn. Current live integrations
              cannot guarantee this, so Never entries are skipped. A remaining balance alone is not protection.
            </p>`
          ),
          fields(
            field(
              'Minimum allowance remaining',
              choice({
                value: String(entry.minRemaining),
                label: 'Minimum allowance remaining',
                options: [...new Set([0, 5, 10, 20, 30, 50, entry.minRemaining])]
                  .sort((a, b) => a - b)
                  .map((n) => ({ value: String(n), label: n ? `${n}% in every reported window` : 'No reserve' })),
                onSave: (n) => change({ minRemaining: Number(n) }),
              })
            ),
            field(
              'When allowance is unknown',
              choice({
                value: entry.unknown,
                label: 'When allowance is unknown',
                options: [
                  { value: 'skip', label: 'Skip this entry' },
                  { value: 'ask', label: 'Ask before continuing' },
                ],
                onSave: (unknown) => change({ unknown }),
              })
            )
          ),
          el(
            html`<p class="st-hint">
              Never and minimum-allowance rules still skip unknown usage. “Ask” cannot override them. A minimum is
              checked before starting; a turn may consume more.
            </p>`
          ),
          toggle({ label: 'Always ask before this fallback', checked: entry.ask, onChange: (ask) => change({ ask }) }),
          row(
            up,
            down,
            button(
              'Remove fallback',
              async () => {
                policy.entries = policy.entries.filter((one) => one !== entry);
                if (await write()) list.draw();
              },
              { kind: 'danger' }
            )
          ),
        ];
      },
    });
    refreshSummaries = () => list.relabel();
    const add = button(
      'Add fallback',
      async () => {
        if (policy.entries.length >= 10) return ctx.said('You can keep up to 10 fallbacks.', true);
        const entry = cleanFallbackPolicy({
          entries: [{ id: crypto.randomUUID(), provider: ctx.providers[0].id, triggers: ['session', 'weekly'] }],
        }).entries[0];
        policy.entries.push(entry);
        if (await write()) list.show(entry.id);
      },
      { kind: 'primary' }
    );
    root.append(
      groupWithButton(
        'Backup order',
        'Each target is tried once per interrupted request. Declining a request stops recovery. Up to 10 rules.',
        add,
        list.node,
        spendingNote()
      ),
      group(
        'What continues',
        'The next eligible service gets the interrupted request and conversation context in the same folder. A manager keeps its identity when its service changes.',
        el(
          html`<p class="st-hint">
            Permissions stay the same or become narrower. Task content is sent only after eligibility and consent checks
            pass. Skipped rules say why in the conversation.
          </p>`
        )
      ),
      group(
        'When a backup cannot take over',
        'Automatic recovery does not apply to slash commands, custom agents, role agents, or managers with guests. Authentication and permission errors do not count as service failures.',
        el(
          html`<p class="st-hint">
            A minimum remaining allowance is checked before a turn starts; it does not cap what the turn can use.
            Unknown usage cannot pass a minimum-allowance or “Never use paid usage” rule. Review the conversation’s
            explanation if recovery stops.
          </p>`
        )
      )
    );
  }
  draw();
  for (const provider of ctx.providers)
    if (
      provider.accounts &&
      policy.entries.some((entry) => entry.provider === provider.id && entry.account !== 'current')
    )
      readAccounts(provider);
  return [root];
}
