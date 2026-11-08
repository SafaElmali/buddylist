// Sound effects. The desktop app and browser demo play the same bundled MSN samples.
// Winks can also play their own audio from the user's local pack.
let enabled = true;
const playingFiles = new Set();
const samples = new Map();

// The classic file behind each sound, under its original name. Sending never had one.
const FILES = { message: 'type.wav', nudge: 'nudge.wav', online: 'online.wav' };

async function play(name) {
  if (!Object.hasOwn(FILES, name)) return;
  let sample = samples.get(name);
  if (!sample) {
    sample = new Audio(`sounds/${FILES[name]}`);
    samples.set(name, sample);
  }
  sample.currentTime = 0;
  try {
    // Start inside the user's gesture; play() itself waits for the recording to load.
    await sample.play();
  } catch (error) {
    // Retry a failed download on the next notification instead of changing its sound.
    if (error.name !== 'AbortError' && samples.get(name) === sample) samples.delete(name);
  }
}

export const sounds = {
  setEnabled(on) {
    enabled = Boolean(on);
    if (!enabled) {
      for (const sample of samples.values()) sample.pause();
      for (const stop of playingFiles) stop();
    }
  },
  /** Play a local sound once. The caller stops it when its animation is dismissed. */
  playFile(url) {
    if (!enabled) return () => {};
    let audio;
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      playingFiles.delete(stop);
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
    };
    try {
      audio = new Audio(url);
      playingFiles.add(stop);
      audio.addEventListener('ended', stop, { once: true });
      audio.addEventListener('error', stop, { once: true });
      audio.play().catch(stop);
    } catch {
      stop(); // Missing files, unsupported audio or an unavailable audio device leave the wink silent.
    }
    return stop;
  },
  play(name) {
    if (!enabled) return;
    play(name).catch(() => {
      // no audio device
    });
  },
};
