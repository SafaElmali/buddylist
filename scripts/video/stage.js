// The stage a feature video is put together on, one frame at a time in headless Chromium: the app's windows on
// a desk, as they were filmed, the camera looking at part of it, a drawn mouse pointer, the keys pressed, and a
// band at the top with the caption of the moment. It opens on a title card that the band shrinks from, and ends
// on a card with where to get the app.
//
// `window.seek(ms)` draws the stage at a moment of the take, and is done once the windows' pictures for that
// moment are drawn. Nothing keeps time of its own, so the same take makes the same film.
/* global document, window, getComputedStyle */
import { appMark } from '../../src/renderer/lib/icons.js';

/** The film's frame, the band at its top, and the picture the camera fills under it. */
export const FRAME = { width: 1920, height: 1080 };
export const BAND = 120;
export const VIEW = { width: FRAME.width, height: FRAME.height - BAND };
/** The windows are filmed at twice their size: past that, a close-up only gets blurrier. */
export const MOST = 2;

const CSS = `
  html, body { margin: 0; width: ${FRAME.width}px; height: ${FRAME.height}px; overflow: hidden; background: #1259dc; }
  #desk { position: absolute; left: 0; top: ${BAND}px; width: ${VIEW.width}px; height: ${VIEW.height}px; overflow: hidden; }
  #world { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
  #wallpaper {
    position: absolute; left: -3000px; top: -2000px; width: 8000px; height: 5200px;
    background:
      radial-gradient(ellipse 30% 22% at 46% 74%, #7cc24a 0 44%, #4f9a32 45% 58%, transparent 59%),
      radial-gradient(ellipse 12% 4% at 40% 40%, rgba(255, 255, 255, 0.7), transparent 70%),
      radial-gradient(ellipse 9% 3% at 58% 37%, rgba(255, 255, 255, 0.55), transparent 70%),
      linear-gradient(180deg, #3a7bd5 0%, #5b98e3 45%, #9cc9f2 100%);
  }
  .win { position: absolute; display: none; transform-origin: 50% 50%; }
  .win.shadow { box-shadow: 0 22px 60px rgba(0, 24, 80, 0.42), 0 2px 10px rgba(0, 24, 80, 0.22); }
  .win img { display: block; width: 100%; height: 100%; }

  #cursor {
    position: absolute; left: 0; top: 0; width: 40px; height: 40px; z-index: 30; pointer-events: none;
    filter: drop-shadow(2px 4px 4px rgba(0, 0, 0, 0.4));
  }
  .ring {
    position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; z-index: 29;
    box-sizing: border-box; border: 5px solid #fff; box-shadow: 0 0 0 3px rgba(18, 89, 220, 0.85);
  }
  #keycap {
    position: absolute; bottom: 48px; left: 50%; z-index: 31; transform-origin: 50% 100%; display: none;
    padding: 12px 26px 14px; min-width: 56px; text-align: center; border-radius: 16px;
    background: rgba(12, 22, 48, 0.86); color: #fff; box-shadow: 0 10px 30px rgba(0, 10, 40, 0.4);
    font: 600 40px/1 -apple-system, 'Helvetica Neue', sans-serif; letter-spacing: 2px;
    border: 2px solid rgba(255, 255, 255, 0.18);
  }

  #band {
    position: absolute; left: 0; top: 0; width: 100%; z-index: 40; overflow: hidden;
    background: linear-gradient(158deg, #082f96 0%, #1259dc 52%, #3f97f6 100%);
    box-shadow: 0 12px 40px rgba(0, 20, 70, 0.35);
    color: #fff; font-family: 'Trebuchet MS', Tahoma, sans-serif;
  }
  .brand { position: absolute; left: 40px; top: ${BAND / 2}px; transform: translateY(-50%); display: flex; align-items: center; gap: 12px; font-size: 28px; font-weight: bold; }
  .brand svg { width: 40px; height: 40px; }
  .caption {
    position: absolute; left: 300px; right: 300px; top: ${BAND / 2}px; text-align: center;
    font-size: 50px; font-weight: bold; letter-spacing: -0.4px; line-height: 1.05; white-space: nowrap;
    text-shadow: 0 3px 0 rgba(4, 20, 90, 0.45);
  }
  .caption em { font-style: normal; color: #ffe066; }
  #title { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 26px; }
  #title svg { width: 140px; height: 140px; }
  #title .over { font-size: 40px; opacity: 0.85; }
  #title h1 { margin: 0; font-size: 110px; letter-spacing: -2px; text-shadow: 0 5px 0 rgba(4, 20, 90, 0.5); }

  #end {
    position: absolute; inset: 0; z-index: 50; opacity: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 24px;
    background: linear-gradient(158deg, #082f96 0%, #1259dc 52%, #3f97f6 100%);
    color: #fff; font-family: 'Trebuchet MS', Tahoma, sans-serif; text-align: center;
  }
  #end svg { width: 150px; height: 150px; }
  #end h1 { margin: 6px 0 0; font-size: 120px; letter-spacing: -2px; text-shadow: 0 5px 0 rgba(4, 20, 90, 0.5); }
  #end span { margin-top: 26px; padding: 18px 44px; border-radius: 999px; background: rgba(255, 255, 255, 0.16); font: 600 44px ui-monospace, Menlo, monospace; }
`;

const POINTER = `<svg id="cursor" viewBox="0 0 23 23" aria-hidden="true"><path d="M2 1.5v17.2l4.5-4.1 2.9 6.6 2.9-1.3-2.9-6.4h6.2z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>`;

const escape = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The stage's page, with a window for each the take filmed. */
export function stageHtml(take) {
  const windows = Object.keys(take.windows)
    .map((name) => `<div class="win shadow" id="win-${name}"><img alt=""></div>`)
    .join('');
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>${CSS}</style></head>
<body>
  <div id="desk">
    <div id="world"><div id="wallpaper"></div>${windows}</div>
    ${POINTER}
    <div id="keycap"></div>
  </div>
  <header id="band">
    <div id="title">${appMark(140)}<div class="over">buddylist</div><h1>${escape(take.title)}</h1></div>
    <div class="brand">${appMark(40)}<span>buddylist</span></div>
    <div class="caption"></div>
  </header>
  <section id="end">${appMark(150)}<h1>buddylist</h1><span>buddylist.dev</span></section>
</body></html>`;
}

/**
 * Sets up `window.seek` on the stage's page. Runs in the browser, with the camera's source handed in.
 * @param {{ take: any, frame: typeof FRAME, band: number, view: typeof VIEW, most: number, camera: string }} given
 */
export function stage({ take, frame, band, view, most, camera: cameraSource }) {
  const $ = (selector) => document.querySelector(selector);
  const camera = new Function(`return (${cameraSource})`)()(view, most);
  const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
  const out = (t) => 1 - (1 - t) ** 3;
  const mix = (a, b, p) => a + (b - a) * p;
  /** The last of a list sorted by `at` that has begun by `ms`. */
  const latest = (list, ms) => {
    let found = null;
    for (const item of list) {
      if (item.at > ms) break;
      found = item;
    }
    return found;
  };
  const cameraAt = camera.track(take.camera);

  const pointerAt = (ms) => {
    let move = null;
    for (const m of take.moves) if (m.t0 <= ms) move = m;
    if (!move) return take.pointer;
    const p = camera.ease(clamp((ms - move.t0) / (move.t1 - move.t0)));
    return { x: mix(move.from.x, move.to.x, p), y: mix(move.from.y, move.to.y, p) };
  };

  // How long a window takes to come in, and to go.
  const OPENS = 220;
  const pictures = [];
  const show = (name, ms) => {
    const win = $(`#win-${name}`);
    const { frames, bounds, shown } = take.windows[name];
    const since = latest(shown, ms);
    const opened = since?.on ? clamp((ms - since.at) / OPENS) : 1 - clamp((ms - (since?.at ?? -Infinity)) / OPENS);
    const picture = latest(frames, ms) ?? (since?.on ? frames[0] : null);
    const place = latest(bounds, ms) ?? bounds[0];
    if (!picture || !place || opened <= 0) {
      win.style.display = 'none';
      return;
    }
    Object.assign(win.style, {
      display: 'block',
      left: `${place.x}px`,
      top: `${place.y}px`,
      width: `${picture.w}px`,
      height: `${picture.h}px`,
      opacity: String(out(opened)),
      transform: opened < 1 ? `scale(${0.96 + 0.04 * out(opened)})` : '',
    });
    const img = win.querySelector('img');
    if (img.getAttribute('src') !== picture.file) {
      img.setAttribute('src', picture.file);
      pictures.push(img.decode().catch(() => {}));
    }
  };

  window.seek = async (ms) => {
    pictures.length = 0;
    // The title card is the band, as tall as the frame, until it shrinks to its place over the windows.
    const opening = camera.ease(clamp((ms - take.reveal) / 900));
    $('#band').style.height = `${mix(frame.height, band, opening)}px`;
    const titleIn = out(clamp(ms / 600));
    $('#title').style.opacity = String(clamp(1 - (ms - take.reveal) / 300) * titleIn);
    $('#title').style.transform = `translateY(${(1 - titleIn) * 24}px)`;
    const branded = clamp((ms - take.reveal - 500) / 400);
    $('.brand').style.opacity = String(branded);

    // The windows, back to front.
    const order = latest(take.order, ms)?.names ?? Object.keys(take.windows);
    order.forEach((name, i) => {
      $(`#win-${name}`).style.zIndex = String(i + 1);
      show(name, ms);
    });

    // The camera.
    const look = camera.transform(cameraAt(ms));
    $('#world').style.transform = `translate(${look.x}px, ${look.y}px) scale(${look.scale})`;
    const screen = (p) => ({ x: look.x + p.x * look.scale, y: look.y + p.y * look.scale });

    // The pointer, and a ring where it clicked.
    const at = screen(pointerAt(ms));
    const cursor = $('#cursor');
    cursor.style.display = ms > take.reveal + 700 ? 'block' : 'none';
    cursor.style.transform = `translate(${at.x - 6}px, ${at.y - 3}px)`;
    document.querySelectorAll('.ring').forEach((ring) => ring.remove());
    for (const click of take.clicks) {
      const age = (ms - click.at) / 500;
      if (age < 0 || age > 1) continue;
      const ring = document.createElement('div');
      ring.className = 'ring';
      const spot = screen(click);
      Object.assign(ring.style, {
        left: `${spot.x}px`,
        top: `${spot.y}px`,
        transform: `scale(${1 + 3.2 * out(age)})`,
        opacity: String(1 - age),
      });
      $('#desk').appendChild(ring);
    }

    // The keys pressed.
    const key = latest(take.keys, ms);
    const keycap = $('#keycap');
    const age = key ? ms - key.at : Infinity;
    if (age < 1300) {
      keycap.textContent = key.label;
      keycap.style.display = 'block';
      const pop = out(clamp(age / 160));
      keycap.style.opacity = String(Math.min(pop, clamp((1300 - age) / 250)));
      keycap.style.transform = `translateX(-50%) scale(${0.86 + 0.14 * pop})`;
    } else keycap.style.display = 'none';

    // The caption: the one before goes, then this one comes.
    const index = take.captions.findLastIndex((c) => c.at <= ms);
    const caption = take.captions[index];
    const text = $('.caption');
    if (caption && ms >= take.reveal) {
      const since = ms - Math.max(caption.at, take.reveal + 500);
      const before = take.captions[index - 1];
      const leaving = since < 220 && before;
      const shown = leaving ? before : caption;
      const fade = leaving ? 1 - since / 220 : clamp((since - (before ? 220 : 0)) / 320);
      text.innerHTML = shown.html;
      text.style.opacity = String(out(clamp(fade)));
      text.style.transform = `translateY(calc(-50% + ${(1 - out(clamp(fade))) * 14}px))`;
    } else text.style.opacity = '0';

    $('#end').style.opacity = String(clamp((ms - take.end) / 600));
    await Promise.all(pictures);
    // One frame for the browser to lay it all out.
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    return getComputedStyle(document.body).width;
  };
}

/** A caption as the band shows it: **these** words stand out. */
export function captionHtml(text) {
  return escape(text).replace(/\*\*(.+?)\*\*/g, '<em>$1</em>');
}
