// Display pictures: built-in art per provider, the default "you" picture,
// pictures from the user's pack, and the framed picture element every
// window uses.
import { PACK_AVATAR, packUrl } from '../../shared/pack.js';
import { escapeHtml } from './dom.js';
import { toolbarIcon } from './icons.js';

let counter = 0;
const uid = () => `p${++counter}`;

// Claude's spark and the Claude Code mascot, as published by Simple Icons
// (https://simpleicons.org, CC0). The marks themselves are Anthropic's.
const CLAUDE_SPARK =
  'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z';
const CLAUDE_CODE_MASCOT =
  'M21 10.5h3v3h-3v3h-1.5v3H18v-3h-1.5v3H15v-3H9v3H7.5v-3H6v3H4.5v-3H3v-3H0v-3h3v-6h18Zm-15 0h1.5v-3H6Zm10.5 0H18v-3h-1.5z';
const CLAUDE_ORANGE = '#D97757';

const avatars = {
  // Claude's spark on cream, like the Claude app icon.
  claude: () =>
    `<svg viewBox="0 0 96 96" aria-hidden="true"><rect width="96" height="96" fill="#F0EEE6"/>` +
    `<path transform="translate(14 14) scale(2.8333)" d="${CLAUDE_SPARK}" fill="${CLAUDE_ORANGE}"/></svg>`,
  // The Claude Code mascot on a terminal-dark tile.
  'claude-code': () =>
    `<svg viewBox="0 0 96 96" aria-hidden="true"><rect width="96" height="96" fill="#262624"/>` +
    `<path transform="translate(12 12) scale(3)" d="${CLAUDE_CODE_MASCOT}" fill="${CLAUDE_ORANGE}"/></svg>`,
  // Codex: a terminal prompt on a dark tile. Original art, not OpenAI's mark.
  codex: () =>
    `<svg viewBox="0 0 96 96" aria-hidden="true"><rect width="96" height="96" fill="#0d0d0d"/>` +
    `<path d="M26 32l20 16-20 16M54 66h18" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  // Gemini: the twins it is named after, as their zodiac sign, on a night-sky tile. Original art, not Google's mark.
  gemini: () =>
    `<svg viewBox="0 0 96 96" aria-hidden="true"><rect width="96" height="96" fill="#131a35"/>` +
    `<path d="M26 26q22 10 44 0M26 70q22-10 44 0M38 30v36M58 30v36" fill="none" stroke="#8ab4f8" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  // OpenCode: square brackets around a block cursor on a paper tile. Original art, not the opencode logo.
  opencode: () =>
    `<svg viewBox="0 0 96 96" aria-hidden="true"><rect width="96" height="96" fill="#f1ecec"/>` +
    `<path d="M38 26H26v44h12M58 26h12v44H58" fill="none" stroke="#211e1e" stroke-width="8"/><rect x="42" y="40" width="12" height="16" fill="#211e1e"/></svg>`,
  // Hermes: the messenger god's wing, in gold on a violet tile. Original art, not the Hermes Agent logo.
  hermes: () =>
    `<svg viewBox="0 0 96 96" aria-hidden="true"><rect width="96" height="96" fill="#2a1f4a"/>` +
    `<path d="M18 71C24 47 48 31 80 27C74 37 68 41 60 43C70 45 74 47 76 49C64 55 56 57 50 57C58 61 62 63 62 65C48 71 32 73 18 71Z" fill="#f2c14e"/></svg>`,
  // Background pull-request updates have no agent as their speaker.
  'pull-request': () => toolbarIcon.pullRequest(),
  // You, by default: the classic buddy on a sky tile.
  default: () => {
    const sky = uid();
    const body = uid();
    return `<svg viewBox="0 0 96 96" aria-hidden="true"><defs>
      <linearGradient id="${sky}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9f0ff"/><stop offset=".6" stop-color="#8cc7f2"/><stop offset="1" stop-color="#4f9ad8"/></linearGradient>
      <linearGradient id="${body}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bff49f"/><stop offset=".55" stop-color="#55c13c"/><stop offset="1" stop-color="#22801a"/></linearGradient></defs>
      <rect width="96" height="96" fill="url(#${sky})"/>
      <ellipse cx="22" cy="20" rx="16" ry="7" fill="#fff" opacity=".8"/><ellipse cx="74" cy="30" rx="12" ry="5" fill="#fff" opacity=".6"/>
      <circle cx="48" cy="36" r="16" fill="url(#${body})" stroke="#1f6c17" stroke-width="2"/>
      <path d="M18 98c0-24 13-38 30-38s30 14 30 38z" fill="url(#${body})" stroke="#1f6c17" stroke-width="2"/>
      <ellipse cx="43" cy="29" rx="6" ry="3.6" fill="#fff" opacity=".7"/></svg>`;
  },
};

// A pack picture that has since been deleted falls back to the default art. Only in a window:
// the tests load what draws the conversation without one.
globalThis.document?.addEventListener(
  'error',
  ({ target }) => {
    if (target instanceof HTMLImageElement && target.src.startsWith('pack:') && target.closest('.dp-inner')) {
      target.outerHTML = avatarSvg('default');
    }
  },
  true
);

/** @param {string} id  an avatar id ("claude", "claude-code", "codex", "gemini", "opencode", "hermes"), or "default" for you */
export function avatarSvg(id) {
  return (avatars[id] || avatars.default)();
}

const image = (url) => `<img src="${escapeHtml(url)}" alt="">`;

/**
 * A display picture without its frame, such as for a list to choose one from.
 * @param {string} avatar  built-in art, or "pack:<file>" for a picture from the pack
 */
export const pictureArt = (avatar) =>
  avatar.startsWith(PACK_AVATAR) ? image(packUrl('pictures', avatar.slice(PACK_AVATAR.length))) : avatarSvg(avatar);

/**
 * A framed display picture: `src` if given, otherwise the avatar, which is
 * built-in art or "pack:<file>" for a picture from the pack.
 * @param {{ src?: string | null, avatar?: string, size?: 'tiny' | 'small' | 'medium' | 'large', menu?: boolean, title?: string }} opts
 */
export function pictureHtml({ src, avatar = 'default', size = 'large', menu = false, title = '' }) {
  const inner = src ? image(src) : pictureArt(avatar);
  return `<div class="dp dp-${size}" title="${escapeHtml(title)}"><div class="dp-inner">${inner}</div>${
    menu ? '<button class="dp-menu" type="button" tabindex="-1" aria-label="Picture options">▾</button>' : ''
  }</div>`;
}
