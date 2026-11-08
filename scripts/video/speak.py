"""Speaks the lines of a narration with a voice model on this Mac, for scripts/video/voice.js.

    uv run --python 3.12 --with mlx-audio==0.5.7 scripts/video/speak.py job.json

job.json names the model and the voice, and the lines with where each goes:
    {"model": "mlx-community/Kokoro-82M-bf16", "voice": "am_michael", "lang": "a", "speed": 1.0, "seed": 7,
     "lines": [{"text": "...", "out": "/path/line-1.wav"}]}

The model is loaded once, from the Hugging Face cache, which it is downloaded into the first time. Each line
is written as a mono WAV at the model's own rate. A model that samples, as Qwen3-TTS does, says a line the
same way for the same seed; one whose take is too fast or too slow for its words, as a garbled one is, is
said again with the next seed, and the likeliest of the takes is kept.
"""

import json
import sys

import mlx.core as mx
import numpy as np
from mlx_audio.audio_io import write as audio_write
from mlx_audio.tts.utils import load_model

# Words a second a narrator says: outside these, a take is likely garbled or cut short.
PLAUSIBLE = (1.6, 4.2)
ATTEMPTS = 3


def take(model, text, options, seed):
    mx.random.seed(seed)
    parts = list(model.generate(text=text, **options))
    audio = np.concatenate([np.array(part.audio, dtype=np.float32).reshape(-1) for part in parts])
    return audio, parts[0].sample_rate


def main(path):
    with open(path) as file:
        job = json.load(file)
    model = load_model(job["model"])
    options = {"voice": job.get("voice"), "speed": job.get("speed", 1.0)}
    for key, name in (("lang", "lang_code"), ("instruct", "instruct"), ("temperature", "temperature")):
        if job.get(key) is not None:
            options[name] = job[key]
    seed = job.get("seed", 7)
    for i, line in enumerate(job["lines"]):
        # A line is said in one go: newlines would split it into parts with a pause between.
        text = " ".join(line["text"].split())
        words = len(text.split())
        best = None
        for attempt in range(ATTEMPTS):
            audio, rate = take(model, text, options, seed + attempt)
            pace = words / max(len(audio) / rate, 0.01)
            miss = max(PLAUSIBLE[0] - pace, pace - PLAUSIBLE[1], 0)
            if best is None or miss < best[0]:
                best = (miss, audio, rate, pace)
            if miss == 0:
                break
        miss, audio, rate, pace = best
        audio_write(line["out"], audio, rate, format="wav")
        warning = "  (an odd pace: listen to it)" if miss else ""
        print(f"{i + 1}/{len(job['lines'])} {len(audio) / rate:.2f}s {pace:.1f} words/s{warning}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1])
