// The keyboard takes the bottom of a phone's screen, and the app is as tall as what is left of it. iOS also scrolls
// the page up by the keyboard's height to show the box you tapped, which on top of that would push the box and the
// header off the top: the page is put back, and the conversation shows a box tapped in a card instead. While the
// keyboard is up, <html> says so with data-keyboard (see phone.css), and a conversation read to its end stays there.

/** How much less of the screen has to be left, with a box to type in, for that to be the keyboard: more than
 * Safari's bars or the bar iOS shows over a hardware keyboard take. */
const KEYBOARD_PX = 100;
/** How near its end a conversation has to be to stay at its end, as conversation.js has it as lines come in. */
const AT_END_PX = 48;

export function followKeyboard(win = window) {
  const { document } = win;
  const root = document.documentElement;
  // The most of the screen seen at each width, upright and on its side: what there is without the keyboard. The
  // window can't say: iOS 26 makes it as short as what the keyboard leaves, as a browser on a computer does when
  // its window is made shorter.
  const tallest = new Map();
  let fitted = 0;
  const fit = () => {
    const { height = win.innerHeight, scale = 1 } = win.visualViewport ?? {};
    if (height !== fitted) {
      fitted = height;
      // Zoomed in, less of the page is visible, but no less of the screen.
      const visible = height * scale;
      const full = Math.max(tallest.get(win.innerWidth) ?? 0, visible);
      tallest.set(win.innerWidth, full);
      const focused = document.activeElement;
      const transcript = document.querySelector('.ph-transcript');
      const atEnd = transcript && transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < AT_END_PX;
      root.style.setProperty('--ph-height', `${height}px`);
      if (focused?.matches('input, textarea') && visible < full - KEYBOARD_PX) root.dataset.keyboard = '';
      else delete root.dataset.keyboard;
      if (atEnd) transcript.scrollTop = transcript.scrollHeight;
      if (focused && transcript?.contains(focused)) focused.scrollIntoView({ block: 'nearest' });
    }
    // Zoomed in, the page is the reader's to move about.
    if (win.scrollY && scale <= 1) win.scrollTo(0, 0);
  };
  win.visualViewport?.addEventListener('resize', fit);
  win.visualViewport?.addEventListener('scroll', fit);
  fit();
}
