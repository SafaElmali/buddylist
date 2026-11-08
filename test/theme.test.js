import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/main/storage/store.js';
import { MemoryStore } from '../preview/memory-storage.js';
import {
  appearanceItems,
  cleanLook,
  cleanTheme,
  DEFAULT_LOOK,
  DEFAULT_PALETTE,
  DEFAULT_THEME,
  FIRST_LOOK,
  FIRST_THEME,
  LOOKS,
  lookOf,
  PALETTES,
  paletteNamed,
  paletteOf,
  schemeOf,
  THEMES,
  themeIn,
  themeOf,
} from '../src/shared/theme.js';
import { listIcon, smallIcon, toolbarIcon } from '../src/renderer/lib/icons.js';
import { OUTPUT, PALETTES as TURNS, palettesCss } from '../scripts/build-palettes.js';
import { tempDir } from './fixtures/temp-dir.js';

const tmp = () => tempDir('cm-theme-');
const defaults = { defaultProvider: 'claude' };

// ---- the setting -------------------------------------------------------------------------------

test('Tools > Theme offers Luna by day, at night and as the system is, and each other palette by day and at night', () => {
  assert.deepEqual(
    THEMES.map((theme) => theme.id),
    [
      'light',
      'dark',
      'system',
      'olive',
      'olive-dark',
      'silver',
      'silver-dark',
      'royale',
      'royale-noir',
      'pink',
      'pink-dark',
    ]
  );
  assert.equal(new Set(THEMES.map((theme) => theme.label)).size, THEMES.length, 'no two are called the same');
  for (const { id, label, palette, scheme } of THEMES) {
    assert.ok(label);
    assert.ok(PALETTES.includes(palette), `${id} is drawn in a palette there is`);
    // Each is shown in a colour scheme Electron can show the windows in.
    assert.match(scheme, /^(light|dark|system)$/);
  }
  assert.deepEqual(PALETTES, ['blue', 'olive', 'silver', 'royale', 'pink']);
  const of = (palette) => THEMES.filter((theme) => theme.palette === palette).map((theme) => theme.scheme);
  assert.deepEqual(of('blue'), ['light', 'dark', 'system']);
  for (const palette of PALETTES.slice(1)) assert.deepEqual(of(palette), ['light', 'dark'], palette);
});

test('a theme says which palette the windows are drawn in, and which colour scheme they are shown in', () => {
  assert.equal(paletteOf('light'), 'blue');
  assert.equal(schemeOf('light'), 'light');
  assert.equal(paletteOf('system'), 'blue');
  assert.equal(schemeOf('system'), 'system');
  assert.equal(paletteOf('olive-dark'), 'olive');
  assert.equal(schemeOf('olive-dark'), 'dark');
  assert.equal(paletteOf('royale'), 'royale');
  assert.equal(schemeOf('royale'), 'light');
  assert.equal(paletteOf('royale-noir'), 'royale');
  assert.equal(schemeOf('royale-noir'), 'dark');
  for (const theme of [undefined, null, '', 'teal', 'Pink', 3]) {
    assert.equal(paletteOf(theme), 'blue');
    assert.equal(schemeOf(theme), 'system');
  }
});

test('Day, Night and Match system keep the palette that has them, and only Luna follows the computer', () => {
  assert.equal(themeIn('light', 'dark'), 'dark');
  assert.equal(themeIn('dark', 'system'), 'system');
  assert.equal(themeIn('system', 'light'), 'light');
  assert.equal(themeIn('olive', 'dark'), 'olive-dark');
  assert.equal(themeIn('royale-noir', 'light'), 'royale');
  assert.equal(themeIn('pink-dark', 'system'), 'system');
  assert.equal(themeIn('teal', 'dark'), 'dark');
});

test('a window is drawn in a palette there is, Luna’s blue for any other', () => {
  assert.equal(DEFAULT_PALETTE, 'blue');
  for (const palette of PALETTES) assert.equal(paletteNamed(palette), palette);
  for (const palette of [undefined, null, '', 'olive-dark', 'light', 'Olive', 1])
    assert.equal(paletteNamed(palette), 'blue');
});

test('a new install follows the computer by day and at night, and the preview is Luna by day as it always was', () => {
  assert.equal(DEFAULT_THEME, 'system');
  assert.equal(FIRST_THEME, 'light');
  assert.equal(new Store(tmp(), defaults).settings.theme, 'system');
  assert.equal(new MemoryStore().settings.theme, 'light');
});

test('settings saved before there were themes get the look they had', () => {
  const dir = tmp();
  const store = new Store(dir, defaults);
  store.updateSettings({ sounds: false });
  const file = path.join(dir, 'messenger.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete saved.settings.theme;
  fs.writeFileSync(file, JSON.stringify(saved));

  const reloaded = new Store(dir, defaults);
  assert.equal(reloaded.settings.theme, 'light');
  assert.equal(reloaded.settings.sounds, false);
});

test('a picked theme is kept across restarts', () => {
  const dir = tmp();
  new Store(dir, defaults).updateSettings(cleanTheme({ theme: 'dark' }));
  assert.equal(new Store(dir, defaults).settings.theme, 'dark');
});

test('only a theme there is can be picked', () => {
  for (const { id } of THEMES) assert.deepEqual(cleanTheme({ theme: id }), { theme: id });
  for (const patch of [
    null,
    undefined,
    {},
    { sounds: false },
    { theme: 'teal' },
    { theme: 'Olive' },
    { theme: '' },
    { theme: null },
    { theme: 1 },
  ]) {
    assert.deepEqual(cleanTheme(patch), {});
  }
});

test('a theme that is not one of them is shown as the default', () => {
  for (const { id } of THEMES) assert.equal(themeOf(id), id);
  for (const theme of [undefined, null, '', 'teal', 'Dark', 'olive green', 3, {}])
    assert.equal(themeOf(theme), 'system');
});

// ---- the look -----------------------------------------------------------------------------------

test('Tools > Look offers the messenger and the professional look', () => {
  assert.deepEqual(
    LOOKS.map((look) => look.id),
    ['messenger', 'professional']
  );
  for (const { label } of LOOKS) assert.ok(label);
});

test('a new install and the preview are the professional look, and settings from before there were looks the messenger', () => {
  assert.equal(DEFAULT_LOOK, 'professional');
  assert.equal(FIRST_LOOK, 'messenger');
  assert.equal(new Store(tmp(), defaults).settings.look, 'professional');
  assert.equal(new MemoryStore().settings.look, 'professional');

  const dir = tmp();
  new Store(dir, defaults).updateSettings({ theme: 'dark' });
  const file = path.join(dir, 'messenger.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete saved.settings.look;
  fs.writeFileSync(file, JSON.stringify(saved));
  const reloaded = new Store(dir, defaults);
  assert.equal(reloaded.settings.look, 'messenger');
  assert.equal(reloaded.settings.theme, 'dark');
});

test('a picked look is kept across restarts, and goes with any theme', () => {
  const dir = tmp();
  new Store(dir, defaults).updateSettings({
    ...cleanLook({ look: 'professional' }),
    ...cleanTheme({ theme: 'system' }),
  });
  const { settings } = new Store(dir, defaults);
  assert.equal(settings.look, 'professional');
  assert.equal(settings.theme, 'system');
});

test('only a look there is can be picked, and one that is not is shown as the professional look', () => {
  for (const { id } of LOOKS) {
    assert.deepEqual(cleanLook({ look: id }), { look: id });
    assert.equal(lookOf(id), id);
  }
  for (const patch of [null, undefined, {}, { theme: 'dark' }, { look: 'msn' }, { look: '' }, { look: 1 }]) {
    assert.deepEqual(cleanLook(patch), {});
  }
  for (const look of [undefined, null, '', 'Professional', 'pro', 2, {}]) assert.equal(lookOf(look), 'professional');
  // A theme and a look are each their own setting.
  assert.deepEqual(cleanTheme({ look: 'professional' }), {});
  assert.deepEqual(cleanLook({ theme: 'dark' }), {});
});

// ---- the menu ----------------------------------------------------------------------------------

// A line between a palette's themes and the next one's is shown as a dash.
const labels = (items) => items.map((item) => (item.separator ? '-' : item.label));
const ticked = (items) => items.filter((item) => item.checked).map((item) => item.label);
const choose = (items, label) => items.find((item) => item.label === label).action();

test('Tools > Look and Tools > Theme list every look and theme, in their order', () => {
  const [look, theme] = appearanceItems({ look: 'messenger', theme: 'light' }, () => {});
  assert.equal(look.label, 'Look');
  assert.deepEqual(
    labels(look.submenu),
    LOOKS.map((l) => l.label)
  );
  assert.equal(theme.label, 'Theme');
  // Each palette's themes together, Luna's blue first.
  assert.deepEqual(labels(theme.submenu), [
    'Light',
    'Dark',
    'Match system',
    '-',
    'Olive Green',
    'Olive Green Dark',
    '-',
    'Silver',
    'Silver Dark',
    '-',
    'Royale',
    'Royale Noir',
    '-',
    'Pink',
    'Pink Dark',
  ]);
  assert.deepEqual(
    labels(theme.submenu).filter((label) => label !== '-'),
    THEMES.map((t) => t.label)
  );
});

test('the look and the theme the settings have are the ones ticked', () => {
  const [look, theme] = appearanceItems({ look: 'professional', theme: 'system' }, () => {});
  assert.deepEqual(ticked(look.submenu), ['Professional']);
  assert.deepEqual(ticked(theme.submenu), ['Match system']);
});

test('settings without a look or a theme, or with one there is not, tick the defaults', () => {
  for (const settings of [{}, { look: 'msn', theme: 'night' }, { look: null, theme: 1 }]) {
    const [look, theme] = appearanceItems(settings, () => {});
    assert.deepEqual(ticked(look.submenu), ['Professional']);
    assert.deepEqual(ticked(theme.submenu), ['Match system']);
  }
});

test('picking a look or a theme changes that setting alone, as the settings take it', () => {
  const patches = [];
  const [look, theme] = appearanceItems({ look: 'messenger', theme: 'light' }, (patch) => patches.push(patch));
  choose(look.submenu, 'Professional');
  choose(theme.submenu, 'Match system');
  choose(theme.submenu, 'Light');
  assert.deepEqual(patches, [{ look: 'professional' }, { theme: 'system' }, { theme: 'light' }]);
  // Each is a change the settings take as it is.
  for (const patch of patches) assert.deepEqual({ ...cleanLook(patch), ...cleanTheme(patch) }, patch);
});

// ---- the colours -------------------------------------------------------------------------------

const STYLES = new URL('../src/renderer/styles/', import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, STYLES), 'utf8');
// The professional look's two, and the palettes, are checked on their own further down: the rest
// is the messenger.
const PRO = ['pro-theme.css', 'pro.css'];
const APART = [...PRO, 'palettes.css'];
const sheets = fs
  .readdirSync(STYLES)
  .filter((file) => file.endsWith('.css'))
  .filter((file) => !APART.includes(file));
const theme = read('theme.css');
const NIGHT = '@media (prefers-color-scheme: dark)';
const [day, night] = theme.split(NIGHT);
const declared = (css) => new Set([...css.matchAll(/^\s*(--[\w-]+):/gm)].map(([, name]) => name));
const dayTokens = declared(day);
const nightTokens = declared(night);

const RENDERER = new URL('../src/renderer/', import.meta.url);
const scripts = fs
  .readdirSync(RENDERER, { recursive: true })
  .filter((file) => file.endsWith('.js'))
  .map((file) => fs.readFileSync(new URL(file, RENDERER), 'utf8'));

/** Every var() of the stylesheets and of the markup the code draws: its name, and whether it has a default of its own. */
const uses = [...sheets.map(read), ...scripts].flatMap((source) =>
  [...source.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)].map(([, name, comma]) => ({ name, defaulted: Boolean(comma) }))
);
/** What is no colour of the theme: a property a stylesheet keeps to itself, or one the code sets on an element. */
const own = new Set([
  ...sheets.filter((file) => file !== 'theme.css').flatMap((file) => [...declared(read(file))]),
  ...scripts.flatMap((source) => [...source.matchAll(/setProperty\('(--[\w-]+)'/g)].map(([, name]) => name)),
]);

test('the night has its colours in one place, under the one rule the windows are switched by', () => {
  assert.equal(theme.split(NIGHT).length, 2, 'theme.css has one block for the night');
  assert.match(night, /color-scheme: dark;/);
  // preview/bridge.js switches every rule of this kind on and off: there is none for the day.
  for (const file of sheets) assert.doesNotMatch(read(file), /prefers-color-scheme:\s*light/);
});

test('every role a stylesheet names has a colour for the night', () => {
  const roles = new Set(uses.filter((use) => use.defaulted).map((use) => use.name));
  assert.ok(roles.size > 40, 'the stylesheets name their roles');
  for (const role of roles) {
    if (own.has(role)) continue;
    assert.ok(nightTokens.has(role), `${role} has a default by day and no colour at night`);
    assert.ok(!dayTokens.has(role), `${role} is a token by day: its default is never used`);
  }
});

test('a colour used without a default is a token by day', () => {
  for (const { name, defaulted } of uses) {
    if (defaulted || own.has(name)) continue;
    assert.ok(dayTokens.has(name), `${name} is used with no default and has no value by day`);
  }
});

test('the night names no colour that nothing uses', () => {
  const used = new Set(uses.map((use) => use.name));
  for (const token of nightTokens) assert.ok(used.has(token), `${token} is given a night colour and used nowhere`);
});

// ---- the professional look's colours --------------------------------------------------------------

const proTheme = read('pro-theme.css');
const pro = read('pro.css');

test('managers are marked by their buddy star, without manager-specific row highlights in either look', () => {
  for (const file of [...sheets, ...PRO, 'palettes.css']) {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(css, /\.lead\b/, `${file}: manager status must not style the row as selected or current`);
  }
});

const [proDayCss, proNightCss] = proTheme.split(NIGHT);
const proDay = declared(proDayCss);
const proNight = declared(proNightCss);
/** Every colour the messenger's stylesheets are drawn in: its tokens by day, and the roles named with a default. */
const colours = new Set([
  ...dayTokens,
  ...uses.filter((use) => use.defaulted && !own.has(use.name)).map((use) => use.name),
]);
const isFont = (name) => name.startsWith('--font-');

/** The selectors a stylesheet's rules start from, outside every block. */
function outermost(css) {
  const selectors = [];
  let depth = 0;
  let start = 0;
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) selectors.push(text.slice(start, i).trim());
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0) start = i + 1;
    }
  }
  return selectors;
}

test('the professional look is only ever drawn in a window marked for it', () => {
  const ROOT = ":root[data-look='professional']";
  for (const selector of outermost(pro)) assert.equal(selector, ROOT);
  assert.deepEqual(outermost(proTheme), [ROOT, NIGHT]);
  assert.match(proNightCss, new RegExp(`^\\s*\\{\\s*${ROOT.replace(/[[\]()]/g, '\\$&')}\\s*\\{`));
});

test('the professional look has its colours in one place, by day and under the one rule for the night', () => {
  assert.equal(proTheme.split(NIGHT).length, 2, 'pro-theme.css has one block for the night');
  assert.match(proDayCss, /color-scheme: light;/);
  assert.match(proNightCss, /color-scheme: dark;/);
  // pro.css draws with those: it has no night of its own, nor colours of the theme.
  assert.doesNotMatch(pro, /prefers-color-scheme/);
  for (const token of declared(pro))
    assert.ok(!colours.has(token), `pro.css gives ${token} a colour: it is pro-theme.css's`);
});

test('every colour of the messenger has one in the professional look, by day and at night', () => {
  assert.ok(colours.size > 100, 'the messenger has its colours');
  for (const colour of colours) {
    assert.ok(proDay.has(colour), `${colour} shows the messenger's colour in the professional look by day`);
    if (!isFont(colour)) assert.ok(proNight.has(colour), `${colour} shows the colour by day at night`);
  }
  for (const token of [...proDay, ...proNight]) assert.ok(colours.has(token), `${token} is no colour of the messenger`);
});

test('what pro.css draws with is a colour of the professional look, or a value of its own', () => {
  const ownTokens = declared(pro);
  for (const [, name, comma] of pro.matchAll(/var\(\s*(--[\w-]+)\s*(,)?/g)) {
    assert.ok(proDay.has(name) || ownTokens.has(name), `pro.css draws with ${name}, which it has no value for`);
    assert.ok(!comma, `${name} needs no default: the professional look has them all`);
  }
});

test('every icon has a line drawing in the professional look', () => {
  const drawn = new Set([...pro.matchAll(/\[data-icon='([\w-]+)'\]/g)].map(([, name]) => name));
  const icons = [toolbarIcon, smallIcon, listIcon].flatMap((set) => Object.values(set).map((draw) => draw()));
  assert.ok(icons.length > 50, 'the icons are named');
  for (const icon of icons) {
    const [, name] = icon.match(/^<svg data-icon="([\w-]+)"/) || [];
    assert.ok(name, `an icon has no name: ${icon.slice(0, 60)}`);
    assert.ok(drawn.has(name), `${name} has no line drawing in pro.css`);
  }
  // Each drawing an icon points at is there.
  const drawings = declared(pro);
  for (const [, name] of pro.matchAll(/--icon: var\((--draw-[\w-]+)\)/g))
    assert.ok(drawings.has(name), `${name} is not drawn`);
});

test('Background is drawn as something left running, not as Reload or the terminal', () => {
  const drawingOf = (icon) =>
    pro.match(new RegExp(`\\[data-icon='${icon}'\\] \\{\\s*--icon: var\\((--draw-[\\w-]+)\\)`))?.[1];
  const others = ['sm-reload', 'tb-terminal', 'sm-terminal'].map(drawingOf);
  assert.ok(others.every(Boolean), 'Reload and the terminal are drawn');
  for (const icon of ['tb-background', 'sm-background']) {
    const name = drawingOf(icon);
    assert.ok(name, `${icon} is drawn`);
    assert.ok(!others.includes(name), `${icon} is drawn as ${name}, which Reload or the terminal wears`);
    // On the set's grid, with its lines.
    const [, drawing] = pro.match(new RegExp(`${name}: url\\("(.+?)"\\);`)) || [];
    assert.match(drawing, /viewBox='0 0 16 16'.*stroke-width='1\.4' stroke-linecap='round' stroke-linejoin='round'/);
  }
});

// ---- the palettes ----------------------------------------------------------------------------------

const palettes = read('palettes.css');
const [palettesDay, palettesNight] = palettes.split(NIGHT);
const MESSENGER = (palette) => `:root:not([data-look='professional'])[data-palette='${palette}']`;
const PROFESSIONAL = (palette) => `:root[data-look='professional'][data-palette='${palette}']`;
const others = PALETTES.filter((palette) => palette !== DEFAULT_PALETTE);

/** The one block of `css` that starts with `selector`, as written: none if it has no such block. */
function blockAt(css, selector) {
  const start = css.indexOf(`${selector} {`);
  return start < 0 ? '' : css.slice(start, css.indexOf('}', start));
}

/** The custom properties of the one block of `css` that starts with `selector`. */
const blockOf = (css, selector) => declared(blockAt(css, selector));

test('palettes.css is what scripts/build-palettes.js makes of Luna’s colours', async () => {
  assert.equal(palettes, await palettesCss(), 'run node scripts/build-palettes.js');
  assert.equal(fs.readFileSync(OUTPUT, 'utf8'), palettes);
});

test('each palette besides Luna’s blue is turned, and only in a window drawn in it', () => {
  assert.deepEqual(Object.keys(TURNS), others);
  assert.equal(palettes.split(NIGHT).length, 2, 'palettes.css has one block for the night');
  const looks = (palette) => [MESSENGER(palette), PROFESSIONAL(palette)];
  assert.deepEqual(outermost(palettes), [...others.flatMap(looks), NIGHT]);
  assert.deepEqual(outermost(palettesNight.slice(palettesNight.indexOf('{') + 1)), others.flatMap(looks));
  for (const page of fs.readdirSync(RENDERER).filter((file) => file.endsWith('.html'))) {
    const html = fs.readFileSync(new URL(page, RENDERER), 'utf8');
    const order = ['theme.css', 'pro-theme.css', 'palettes.css'].map((file) => html.indexOf(`styles/${file}`));
    assert.ok(
      order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])),
      `${page} loads the palettes after the looks`
    );
  }
});

test('a palette gives colours of Luna’s only, and keeps the ones that say what something is', () => {
  for (const palette of others) {
    const tokens = [...blockOf(palettesDay, MESSENGER(palette)), ...blockOf(palettesNight, MESSENGER(palette))];
    assert.ok(tokens.length > 100, `${palette} turns the messenger`);
    for (const token of tokens)
      assert.ok(colours.has(token), `${palette} gives ${token}, which is no colour of the messenger`);
    for (const kept of ['--link', '--online', '--busy', '--away', '--offline', '--violet'])
      assert.ok(!tokens.includes(kept), `${palette} changes ${kept}`);
    for (const token of [
      ...blockOf(palettesDay, PROFESSIONAL(palette)),
      ...blockOf(palettesNight, PROFESSIONAL(palette)),
    ])
      assert.ok(
        proDay.has(token) && proNight.has(token),
        `${palette} gives ${token}, which is no colour of the professional look`
      );
  }
});

test('at night nothing of a palette’s day shows that Luna gives a colour for the night', () => {
  for (const palette of others) {
    for (const [selector, lunaNight] of [
      [MESSENGER(palette), nightTokens],
      [PROFESSIONAL(palette), proNight],
    ]) {
      const byDay = blockOf(palettesDay, selector);
      const atNight = blockOf(palettesNight, selector);
      for (const token of byDay)
        if (lunaNight.has(token)) assert.ok(atNight.has(token), `${palette} shows its ${token} of the day at night`);
    }
  }
});

test('every palette has its own frame, title bar, selection and terminal, in the messenger and the professional look', () => {
  for (const palette of others) {
    const byDay = blockOf(palettesDay, MESSENGER(palette));
    for (const token of ['--frame', '--titlebar-bg', '--wc-bg', '--select', '--body-bg', '--terminal-bg'])
      assert.ok(byDay.has(token), `${palette} has no ${token}`);
    // The professional look's one colour, and its slate and ink in the palette's hue.
    const proByDay = blockOf(palettesDay, PROFESSIONAL(palette));
    const proAtNight = blockOf(palettesNight, PROFESSIONAL(palette));
    for (const token of ['--accent', '--select', '--send-bg', '--focus-border', '--frame', '--titlebar-bg', '--text'])
      assert.ok(proByDay.has(token), `${palette} has no ${token} in the professional look`);
    for (const token of ['--accent', '--select', '--frame', '--body-bg', '--pane', '--text', '--terminal-bg'])
      assert.ok(proAtNight.has(token), `${palette} has no ${token} in the professional look at night`);
    for (const kept of ['--link', '--online', '--busy', '--away', '--offline', '--violet'])
      assert.ok(!proByDay.has(kept) && !proAtNight.has(kept), `${palette} changes ${kept} in the professional look`);
  }
});

// ---- the palettes' text at night --------------------------------------------------------------------

/** How bright a #rrggbb colour is to the eye: WCAG's relative luminance. */
const luminance = (colour) => {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(colour.slice(at, at + 2), 16) / 255);
  const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
};

/** WCAG's contrast of two colours: 1 for the same, 21 for black on white. */
const contrast = (one, other) => {
  const [light, dark] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
};

/** A custom property's value in the first of `sheets` that gives it one. */
const valueOf = (sheets, name) => {
  for (const css of sheets) {
    const [, value] = css.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm')) ?? [];
    if (value) return value.trim();
  }
};

test('at night a palette’s text reads on its panes and menus, in the messenger and the professional look', () => {
  // Require WCAG AA for normal-sized text, including secondary text.
  const least = {
    '--text': 4.5,
    '--text-strong': 4.5,
    '--text-soft': 4.5,
    '--text-mid': 4.5,
    '--text-dim': 4.5,
    '--muted': 4.5,
    '--heading': 4.5,
    '--code-text': 4.5,
  };
  for (const palette of PALETTES) {
    // What a window drawn in the palette shows at night: its own night, its day, then the look's.
    const looks = {
      messenger: [blockAt(palettesNight, MESSENGER(palette)), blockAt(palettesDay, MESSENGER(palette)), night, day],
      professional: [
        blockAt(palettesNight, PROFESSIONAL(palette)),
        blockAt(palettesDay, PROFESSIONAL(palette)),
        proNightCss,
        proDayCss,
      ],
    };
    for (const [look, sheets] of Object.entries(looks)) {
      for (const ground of ['--menu-bg', '--pane', '--xp-face']) {
        const behind = valueOf(sheets, ground);
        assert.match(behind, /^#[0-9a-f]{6}$/i, `${palette} ${look} has a colour for ${ground} at night`);
        // Royale Noir's faint text carries information too. Keep the other palettes' existing
        // faint colours outside this fix while guarding their body and secondary text above.
        const thresholds = palette === 'royale' && look === 'messenger' ? { ...least, '--text-faint': 4.5 } : least;
        for (const [text, enough] of Object.entries(thresholds)) {
          const colour = valueOf(sheets, text);
          assert.match(colour, /^#[0-9a-f]{6}$/i, `${palette} ${look} has a colour for ${text} at night`);
          const ratio = contrast(colour, behind);
          assert.ok(
            ratio >= enough,
            `${palette} ${look} at night: ${text} ${colour} on ${ground} ${behind} is ${ratio.toFixed(2)}:1, under ${enough}:1`
          );
        }
      }
    }
  }
});

test('Royale Noir’s inactive window title stays readable on every stop of its black gradient', () => {
  const sheets = [blockAt(palettesNight, MESSENGER('royale'))];
  const colour = valueOf(sheets, '--titlebar-inactive-text');
  const background = valueOf(sheets, '--titlebar-inactive-bg');
  assert.match(colour, /^#[0-9a-f]{6}$/i);
  const stops = background.match(/#[0-9a-f]{6}/gi);
  assert.ok(stops?.length, 'the inactive title bar has gradient stops');
  for (const stop of stops) {
    const ratio = contrast(colour, stop);
    assert.ok(ratio >= 4.5, `inactive title ${colour} on ${stop} is ${ratio.toFixed(2)}:1, under 4.5:1`);
  }
});
