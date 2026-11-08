// Isolated Chrome regression for the shared audio capture code, with generated audio only.
// node scripts/check-microphone-browser.js
/* global window */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('..', import.meta.url));
let missingWorklet = true;
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/src/renderer/microphone-check.html') {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<button id="mic">Record</button><textarea id="draft">Existing draft</textarea>
      <script type="module">
      import { Microphone, VoiceClips } from './chat/voice.js';
      window.streams = [];
      window.errors = [];
      const Capture = window.AudioWorkletNode;
      window.AudioWorkletNode = class extends Capture {
        constructor(...args) {
          super(...args);
          this.port.addEventListener('message', ({data}) => {
            if (data.some(sample => Math.abs(sample) > 0.0001)) window.heard = true;
          });
        }
      };
      const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async (...args) => {
        const stream = await get(...args); window.streams.push(stream); return stream;
      };
      window.voice = new VoiceClips({
        microphone: new Microphone(), settings: () => ({ voiceMode: 'press' }),
        transcribe: async wav => {
          const data = new DataView(wav);
          if (data.getUint32(24, true) !== 16000 || !new Int16Array(wav.slice(44)).some(x => x))
            throw new Error('Invalid PCM');
          return ' Synthetic words.';
        },
        insert: text => { document.querySelector('#draft').value += text; },
        error: text => window.errors.push(text), status() {}
      });
      window.voice.attach(document.querySelector('#mic'));
      window.addEventListener('keydown', e => window.voice.keyDown(e));
      </script>`);
    return;
  }
  const file = path.resolve(root, '.' + url.pathname);
  if (missingWorklet && url.pathname.endsWith('/voice-worklet.js')) {
    response.writeHead(404).end();
    return;
  }
  if (!file.startsWith(path.join(root, 'src') + path.sep) || !file.endsWith('.js') || !fs.existsSync(file)) {
    response.writeHead(404).end();
    return;
  }
  response.setHeader('Content-Type', 'text/javascript');
  response.end(fs.readFileSync(file));
});
let browser;
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/src/renderer/microphone-check.html`);
  await page.waitForFunction(() => window.voice);
  await page.locator('#mic').click();
  await page.waitForFunction(() => window.errors.length === 1);
  assert.match(await page.evaluate(() => window.errors[0]), /voice recorder could not start/);
  missingWorklet = false;
  for (const cancel of [true, false]) {
    await page.evaluate(() => {
      window.heard = false;
    });
    await page.locator('#mic').click();
    await page.waitForFunction(() => window.voice.state === 'recording' && window.heard);
    if (cancel) await page.keyboard.press('Escape');
    else {
      await page.waitForTimeout(800);
      await page.locator('#mic').click();
    }
    await page.waitForFunction(
      () =>
        window.voice.state === 'idle' &&
        window.streams.every((s) => s.getTracks().every((t) => t.readyState === 'ended'))
    );
  }
  assert.equal(await page.locator('#draft').inputValue(), 'Existing draft Synthetic words.');
  assert.equal(await page.evaluate(() => window.errors.length), 1);
  console.log(`Chrome ${browser.version()}: worklet failure recovery, capture, cancellation, PCM and cleanup passed.`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
