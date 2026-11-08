// Bundled and local emoticon, wink and display-picture files (see src/main/pack.js).
// These are the names both sides use.

/** The pack's folders, one per kind of file. */
export const PACK_KINDS = Object.freeze(['emoticons', 'winks', 'pictures']);

/** A contact whose avatar is "pack:<file>" shows that file from the pictures folder. */
export const PACK_AVATAR = 'pack:';

/** Where a window loads a pack file from. */
export const packUrl = (kind, file) =>
  `${globalThis.__BUDDYLIST_PACK_BASE__ || 'pack://'}${kind}/${encodeURIComponent(file)}`;

/** "Heart.GIF" -> "heart": what a file is called, whatever format it is in. */
export const fileStem = (file) => file.replace(/\.[^.]+$/, '').toLowerCase();

/** "knock_knock.gif" -> "Knock knock" */
export function fileTitle(file) {
  const words = file
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
