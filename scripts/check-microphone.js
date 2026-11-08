// Exercise the built desktop composer with Chromium's fake microphone, never a physical input.
// npm run build:app && node scripts/check-microphone.js [evidence-directory]
/* global window, Worklet, document, DataTransfer, ClipboardEvent */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { setTimeout as wait } from 'node:timers/promises';
import { _electron as electron } from 'playwright-core';
import { Store } from '../src/main/storage/store.js';

const require = createRequire(import.meta.url);
const output = path.resolve(process.argv[2] || 'dist/microphone-check');
fs.mkdirSync(output, { recursive: true });
// Source Electron sets its Dock icon; installers supply their icon in the app bundle instead.
fs.mkdirSync('dist/build', { recursive: true });
fs.copyFileSync('build/icon.png', 'dist/build/icon.png');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-microphone-'));
const profile = path.join(temp, 'profile');
const store = new Store(profile, { defaultProvider: 'claude' });
store.finishOnboarding();
store.updateSettings({ sounds: false, shareUsage: false, errorReports: false, voiceMode: 'press' });
const contact = store.addContact({ provider: 'claude', name: 'Microphone test', cwd: temp });
const env = { ...process.env, BUDDYLIST_DEMO: '1', BUDDYLIST_TEST: '1', BUDDYLIST_USER_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.BUDDYLIST_UPDATES_URL;
delete env.BUDDYLIST_ANALYTICS_URL;
// Never discover or execute the user's transcription installation.
env.BUDDYLIST_WHISPER_MODEL = path.join(temp, 'missing-test-model.bin');
let app;
let chat;
try {
  app = await electron.launch({
    executablePath: require('electron'),
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', 'dist/app/main/index.js'],
    env,
    timeout: 30000,
  });
  for (const stream of [app.process().stdout, app.process().stderr])
    stream?.on('data', (data) => fs.appendFileSync(path.join(output, 'electron.log'), data));
  const contacts = await app.firstWindow();
  const opened = app.waitForEvent('window');
  await contacts.locator(`.contact[data-id="${contact.id}"] .name`).dblclick();
  chat = await opened;
  await chat.locator('#ct-voice').waitFor();
  await chat.evaluate(() => {
    window.micCheck = { streams: [], failures: [], samples: 0, nonzero: 0 };
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (window.micCheck.captureFailure) throw new DOMException('', window.micCheck.captureFailure);
      const stream = await get(constraints);
      window.micCheck.streams.push(stream);
      return stream;
    };
    const add = Worklet.prototype.addModule;
    Worklet.prototype.addModule = async function (...args) {
      try {
        if (window.micCheck.moduleFailure) throw new DOMException('Missing module', 'AbortError');
        return await add.apply(this, args);
      } catch (error) {
        window.micCheck.failures.push({ stage: 'worklet', name: error.name, message: error.message });
        throw error;
      }
    };
    const NativeCapture = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends NativeCapture {
      constructor(...args) {
        super(...args);
        this.port.addEventListener('message', ({ data }) => {
          window.micCheck.samples += data.length;
          window.micCheck.nonzero += data.filter((sample) => Math.abs(sample) > 0.0001).length;
        });
      }
    };
  });
  const idle = async () => {
    await chat.waitForFunction(
      () => !document.querySelector('#ct-voice').matches('.opening, .recording, .transcribing')
    );
    await chat.waitForFunction(() =>
      window.micCheck.streams.every((s) => s.getTracks().every((t) => t.readyState === 'ended'))
    );
  };
  const start = async () => {
    await chat.evaluate(() => {
      window.micCheck.samples = 0;
      window.micCheck.nonzero = 0;
    });
    await chat.locator('#ct-voice').click();
    await chat.locator('#ct-voice.recording').waitFor({ timeout: 5000 });
    await chat.waitForFunction(() => window.micCheck.samples >= 8000 && window.micCheck.nonzero > 100);
  };
  const errorCount = () => chat.locator('#conversation .event.error').count();
  // A generated picture exercises attachment preservation without reading a user's files.
  await chat.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 8;
    canvas.getContext('2d').fillRect(0, 0, 8, 8);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve));
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([blob], 'synthetic.png', { type: 'image/png' }));
    document.querySelector('#input').dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true }));
  });
  await chat.locator('#attachments img').waitFor();
  const attachment = await chat.locator('#attachments img').getAttribute('src');
  for (const look of ['professional', 'messenger']) {
    await chat.evaluate(
      (look) => window.messenger.app.updateSettings({ look, voiceMode: 'press', voiceSend: false }),
      look
    );
    await chat.locator('#input').fill('Keep this draft.');
    await start();
    await chat.screenshot({ path: path.join(output, `${look}-recording.png`) });
    await chat.keyboard.press('Escape');
    await idle();
    assert.equal(await chat.locator('#input').inputValue(), 'Keep this draft.');

    // Real backend configuration failure: the mic has already stopped by this point.
    await start();
    await chat.locator('#ct-voice').click();
    await chat
      .getByText(/BUDDYLIST_WHISPER_MODEL points to|Whisper could not transcribe the test clip/)
      .last()
      .waitFor();
    await idle();
    assert.equal(await chat.locator('#input').inputValue(), 'Keep this draft.');

    // Test-only IPC responder validates actual worklet PCM; it retains no audio.
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('voice:transcribe');
      ipcMain.handle('voice:transcribe', (_event, wav) => {
        const data = new DataView(wav);
        if (
          data.getUint32(24, true) !== 16000 ||
          wav.byteLength < 16044 ||
          !new Int16Array(wav.slice(44)).some((sample) => sample !== 0)
        )
          throw new Error(
            `Invalid synthetic PCM: rate=${data.getUint32(24, true)}, bytes=${wav.byteLength}, nonzero=${new Int16Array(wav.slice(44)).filter((sample) => sample !== 0).length}`
          );
        return 'Synthetic words.';
      });
    });
    await start();
    await chat.locator('#ct-voice').click();
    await idle();
    assert.match(await chat.locator('#input').inputValue(), /Keep this draft\..*Synthetic words\./s);
    assert.equal(await chat.locator('#conversation .msg.me').count(), 0, 'dictation does not send');

    // One error per attempt and retry without a reload for each capture/setup failure.
    for (const [setting, value, message] of [
      ['captureFailure', 'NotAllowedError', 'Microphone access is not allowed.'],
      ['captureFailure', 'NotFoundError', 'No microphone was found.'],
      ['captureFailure', 'NotReadableError', 'The microphone could not be opened.'],
      ['moduleFailure', true, 'The voice recorder could not start.'],
    ]) {
      const before = await errorCount();
      await chat.evaluate(
        ([key, value]) => {
          window.micCheck[key] = value;
        },
        [setting, value]
      );
      await chat.locator('#ct-voice').click();
      await chat.getByText(message, { exact: false }).last().waitFor();
      await idle();
      assert.equal(await errorCount(), before + 1);
      await chat.evaluate((key) => {
        delete window.micCheck[key];
      }, setting);
      await start();
      await chat.keyboard.press('Escape');
      await idle();
    }
    // Hold mode uses the same control in each look.
    await chat.evaluate(() => window.messenger.app.updateSettings({ voiceMode: 'hold' }));
    await chat.locator('#ct-voice[title^="Hold"]').waitFor();
    const bounds = await chat.locator('#ct-voice').boundingBox();
    await chat.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await chat.mouse.down();
    await chat.locator('#ct-voice.recording').waitFor();
    await wait(600);
    await chat.mouse.up();
    await idle();
    assert.equal(await chat.locator('#conversation .msg.me').count(), 0);
    await chat.screenshot({ path: path.join(output, `${look}-recovery.png`) });
    assert.equal(await chat.locator('#attachments img').getAttribute('src'), attachment);
    console.log(`${look}: capture, PCM, cancel, stop, retries, error isolation and draft preservation passed.`);

    // A backend execution failure for the second look (the first used real config validation).
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('voice:transcribe');
      ipcMain.handle('voice:transcribe', () => {
        throw new Error('Whisper could not transcribe the test clip.');
      });
    });
  }
  // Fake UI automatically grants access before Electron's policy is consulted. Relaunch the
  // isolated app with fake devices only, and deny requests before opening the chat.
  await app.close();
  app = await electron.launch({
    executablePath: require('electron'),
    args: ['--use-fake-device-for-media-stream', 'dist/app/main/index.js'],
    env,
    timeout: 30000,
  });
  await app.evaluate(({ session }) => {
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, answer) => answer(false));
  });
  const deniedContacts = await app.firstWindow();
  const deniedChat = app.waitForEvent('window');
  await deniedContacts.locator(`.contact[data-id="${contact.id}"] .name`).dblclick();
  chat = await deniedChat;
  await chat.locator('#ct-voice').waitFor();
  await chat.evaluate(() => {
    window.micCheck = { streams: [] };
    const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => {
      const stream = await get(...args);
      window.micCheck.streams.push(stream);
      return stream;
    };
  });
  await chat.evaluate(() => window.messenger.app.updateSettings({ voiceMode: 'press' }));
  const beforeDenied = await errorCount();
  await chat.locator('#ct-voice').click();
  await chat.waitForFunction(
    (count) => document.querySelectorAll('#conversation .event.error').length > count,
    beforeDenied
  );
  await idle();
  assert.match(await chat.locator('#conversation .event.error').last().innerText(), /access is not allowed/);
  assert.equal(await errorCount(), beforeDenied + 1);
  assert.equal(await chat.evaluate(() => window.micCheck.streams.length), 0);
  console.log('Electron session denial respected; one permission error and no active tracks.');
  console.log(
    await app.evaluate(({ systemPreferences }) => ({
      platform: process.platform,
      electron: process.versions.electron,
      microphonePermission:
        process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('microphone') : 'not inspected',
    }))
  );
} catch (error) {
  if (chat) {
    await chat.screenshot({ path: path.join(output, 'failure.png') });
    console.log(
      await chat.evaluate(() => ({
        captureCount: window.micCheck?.streams.length,
        failures: window.micCheck?.failures,
        errors: document.querySelector('#conversation')?.innerText,
      }))
    );
  }
  throw error;
} finally {
  await app?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
