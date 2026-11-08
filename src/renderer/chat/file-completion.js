import { fileMention } from '../../shared/file-mentions.js';

/** The @path being typed, including an unfinished quoted path with spaces. */
export function fileAt(text, caret) {
  const at = text.lastIndexOf('@', caret - 1);
  if (!caret || at < 0 || (at > 0 && !/[\s([{'"]/.test(text[at - 1]))) return null;
  const typed = text.slice(at + 1, caret);
  const quoted = typed.startsWith('"');
  const query = quoted ? typed.slice(1) : typed;
  if ((quoted ? /["\r\n]/ : /[\s"]/).test(query)) return null;
  return { at, query, quoted };
}

/** Insert a relative path, quoting spaces and making extensionless root files unambiguous. */
export function completeFile(text, at, caret, path) {
  const quoted = text[at + 1] === '"';
  const after = text.slice(caret);
  const rest = quoted ? after.replace(/^[^"\r\n]*(?:"|$)/, '') : after.replace(/^[^\s,;!?)}\]]*/, '');
  const relative = /\.[A-Za-z][\w-]*$/.test(path) ? path : `./${path}`;
  const spaced = /^[ \t]/.test(rest);
  const start = `${text.slice(0, at)}${fileMention(relative)}${spaced ? '' : ' '}`;
  return { text: start + rest, caret: start.length + (spaced ? 1 : 0) };
}
