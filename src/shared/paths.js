// Paths as the computer they come from reads them. A Windows path names the same
// file in any letter case and with either slash. A macOS or Linux path is taken as
// it is written: Linux tells letter case apart, and a backslash is a letter there.

/** Whether a path is written the Windows way: from a drive letter, as C:\Users does, or a \\server\share. */
const isWindowsPath = (p) => /^(?:[A-Za-z]:[\\/]|\\\\)/.test(p);

/** A path as it compares with another: a Windows one in lower case, with forward slashes. */
export const comparablePath = (p) => (isWindowsPath(p) ? p.replaceAll('\\', '/').toLowerCase() : p);

/**
 * What follows the folder `base` in `p`, written as `p` writes it, when `p` is inside that folder.
 * Only as much of `p` as `base` is long is compared, so a letter lower case writes longer can't move the cut.
 * @param {string} p
 * @param {string} base
 * @returns {string | null}  null for a path somewhere else
 */
export function pathInside(p, base) {
  const root = comparablePath(base).endsWith('/') ? base : `${base}/`;
  return comparablePath(p.slice(0, root.length)) === comparablePath(root) ? p.slice(root.length) : null;
}
