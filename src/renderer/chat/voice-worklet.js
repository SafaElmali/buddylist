// Runs on the audio thread while a voice clip is being recorded: passes every
// block of microphone samples to the window (see voice.js).
/* global AudioWorkletProcessor, registerProcessor */

class VoiceCapture extends AudioWorkletProcessor {
  /** @param {Float32Array[][]} inputs  the node mixes the microphone down to one channel */
  process([[samples]]) {
    if (samples?.length) {
      // The block is reused for the next one, so the window gets a copy of its own.
      const block = samples.slice();
      this.port.postMessage(block, [block.buffer]);
    }
    return true;
  }
}

registerProcessor('voice-capture', VoiceCapture);
