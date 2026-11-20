// What a right-click on a link in the conversation offers, by where the link leads. A click opens it as openLink in
// main.js does: a web page in your browser or beside the conversation, a file of this computer in a tab beside it or
// in its app. An e-mail address opens nothing, so its menu only copies it.
import { isWebAddress } from '../../shared/browser.js';
import { linkedFile, mailAddress } from '../../shared/links.js';

/**
 * @param {{ url: string, href: string | null }} link  `url`: the address the page made of it. `href`: as it was written
 * @param {object} on
 * @param {(url: string) => import('../lib/menu.js').MenuItem[]} on.web  what a link to a web page offers (see linkMenu
 *   in browser.js)
 * @param {((file: string) => import('../lib/menu.js').MenuItem[]) | null} on.file  what a link to a file offers (see
 *   Files.linkMenu). Null where the files aren't this computer's, as in the web preview
 * @param {(text: string) => void} on.copy
 * @returns {import('../lib/menu.js').MenuItem[]}  nothing for a link that leads nowhere to copy, as "#top"
 */
export function messageLinkItems({ url, href }, { web, file, copy }) {
  const path = file && linkedFile(href);
  if (path) return file(path);
  if (isWebAddress(url)) return web(url);
  const address = mailAddress(href);
  return address ? [{ label: 'Copy email address', action: () => copy(address) }] : [];
}
