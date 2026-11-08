// The Output style menu: which styles a contact can be switched to, and what
// each is called.

/**
 * What the menu reads from the window's shared state.
 * @typedef {Object} OutputStyleState
 * @property {import('../../providers/contract.js').ProviderDescriptor} provider
 * @property {string[]} outputStyles      the styles the session offers; empty until it has said
 * @property {string | null} outputStyle  the style the contact answers in, when that is known
 */

/**
 * A style's name in the menu: the provider's label for one it has built in,
 * the style's own name for any other.
 * @param {OutputStyleState} ctx
 * @param {string} id
 */
export function outputStyleLabel(ctx, id) {
  return (ctx.provider.outputStyles || []).find((style) => style.id === id)?.label || id;
}

/**
 * The styles to choose from, with the current one checked. Empty when the
 * contact's provider has no output styles.
 * @param {OutputStyleState} ctx
 * @param {(id: string) => void} choose
 * @returns {import('../lib/menu.js').MenuItem[]}
 */
export function outputStyleItems(ctx, choose) {
  // Until the session has said what it offers, only the provider's built-in styles are known.
  const known = ctx.outputStyles.length > 0;
  const ids = known ? [...ctx.outputStyles] : (ctx.provider.outputStyles || []).map((style) => style.id);
  if (!ids.length) return [];
  // The current style can be one of the user's own, which isn't built in.
  if (ctx.outputStyle && !ids.includes(ctx.outputStyle)) ids.push(ctx.outputStyle);
  return [
    ...ids.map((id) => ({
      label: outputStyleLabel(ctx, id),
      checked: id === ctx.outputStyle,
      action: () => choose(id),
    })),
    ...(known
      ? []
      : [{ separator: true }, { label: 'Your own styles appear after your first message', disabled: true }]),
  ];
}
