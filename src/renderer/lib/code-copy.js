// Copy one code block, after Markdown has been sanitized. The button is the app's, never the reply's.
import { DIAGRAM_CLASS } from './diagrams.js';
import { el, html, raw } from './dom.js';
import { smallIcon } from './icons.js';

/** A block is part of a message for the existing copy count; none of its text leaves the window. */
async function copyCode(text) {
  const { copyText } = await import('./copy-folder.js');
  await copyText(text, 'message');
}

/**
 * Each ordinary code block gets its own Copy button. Reading the code when pressed also copies the
 * latest lines of a block still streaming in. Diagrams already have Copy source of their own.
 * @param {ParentNode} root
 * @param {(text: string) => Promise<void>} [copy]
 */
export function addCodeCopies(root, copy = copyCode) {
  for (const code of root.querySelectorAll('pre > code')) {
    const pre = code.parentElement;
    if (code.classList.contains(DIAGRAM_CLASS) || pre.parentElement?.classList.contains('code-block')) continue;
    const block = el(html`<div class="code-block"></div>`);
    const button = el(
      html`<button class="code-copy" type="button" title="Copy code" aria-label="Copy code">
        ${raw(smallIcon.copy())}<span aria-live="polite">Copy</span>
      </button>`
    );
    pre.replaceWith(block);
    block.append(pre, button);
    // Keep a pointer press from taking the focus from the composer; Tab still reaches the button.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    let timer;
    let copying = false;
    const show = (icon, label, title) => {
      button.querySelector('svg').replaceWith(el(icon));
      button.querySelector('span').textContent = label;
      button.title = title;
      button.setAttribute('aria-label', title);
    };
    button.addEventListener('click', async () => {
      if (copying) return;
      copying = true;
      clearTimeout(timer);
      try {
        await copy(code.textContent);
        show(smallIcon.check(), 'Copied', 'Code copied');
      } catch {
        show(smallIcon.copy(), 'Try again', 'Could not copy code. Try again');
      } finally {
        copying = false;
        timer = setTimeout(() => show(smallIcon.copy(), 'Copy', 'Copy code'), 1500);
      }
    });
  }
}
