# Feature videos

`npm run video` films the real app in demo mode while a scene works it, then puts the film together with a camera that follows what happens, captions, and a voice reading the scene's narration. One scene makes everything a feature needs:

| File                                          | For                                                                                                  |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `<scene>.mp4`                                 | YouTube: 1920 by 1080 at 60 frames a second, voice over a quiet bed                                  |
| `<scene>.srt`                                 | the narration's captions, to upload with it                                                          |
| `<scene>-voice.wav`                           | the voice alone, at -16 LUFS                                                                         |
| `<scene>-loop.mp4`, `-loop.webm`, `-loop.gif` | a silent loop of the scene's heart, for the changelog, site and onboarding. The GIF stays under 5 MB |

```
scenes/managers.js ──► voice.js ──────────► each line said, and how long it takes
        │                                          │
        │  prepare: data, projects, worktrees      │ the film waits for each line
        ▼                                          ▼
     film.js ── the app in demo mode, its windows unseen ──► take/ (frames + take.json)
                                                                  │
                         stage.js + camera.js, frame by frame ◄───┘
                                     │
                                render.js ──► mp4, srt, voice, loops
```

```bash
npm run video -- managers                       # dist/video/managers/
npm run video -- managers --voice kokoro:af_heart
npm run video -- managers --out /tmp/videos
npm run video -- managers --again               # put together again from the last take
npm run video -- managers --still 12.5          # a photograph of a moment, to check a change
npm run video -- managers --draft               # 30 frames a second, quicker
npm run video -- managers --voices qwen3:Aiden,kokoro:af_heart,elevenlabs   # the same lines in each voice
```

Needs ffmpeg, [uv](https://docs.astral.sh/uv/) for a voice made on this Mac, and Chromium for Playwright (`npx playwright-core install chromium-headless-shell`). What it makes stays out of the repository: `dist/` is ignored, and `--out` puts it anywhere else.

## Filming without a screen

The app runs with a home folder of its own under the system's temporary folder, so its paths read `~/code/shop` and nothing of yours is in the picture. Its windows are drawn but never seen: [`hide-windows.cjs`](../scripts/video/hide-windows.cjs) makes them see-through, deaf to the mouse and never in front, with no Dock icon, so a video can be made while you work. Each page is told it has the focus over the DevTools protocol, so carets blink and title bars look active, and each page's `Math.random` starts the same way every time, so a take shows the same tips. What demo mode says about itself, its badge and its "This is demo mode" sentences, is hidden from the film.

Each window is filmed over the DevTools protocol at twice its size, which is as close as the camera goes: a close-up stays sharp.

## Writing a scene

A scene is a file in `scripts/video/scenes/` with:

- `title`: the title card's words.
- `narration`: its lines, by name, as the captions spell them. **Bold** words stand out in a caption.
- `spoken`: the words a voice would say wrong, and how to say them: `{ buddylist: 'buddy list' }`.
- `sample`: the lines `--voices` reads, about 25 seconds of them.
- `prepare({ home, data, store, history, git, write })`: the app's data before it starts. Projects go under `home`, and the worktrees the app would make under `data/worktrees/<project>/`.
- `setup(d, prepared)`: off camera. Use the app's own `window.messenger` calls from `d.contacts` where the UI would take long, open conversations with `d.open(contactId)`, and put windows on the desk with `d.show(page, bounds)`. A window not shown is not in the film.
- `play(d, prepared)`: on camera, with the director `d`:

| Call                                         | What it does                                                                                   |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `d.say(name)`                                | says a line from now on; resolves once it is said. Start it, act, then `await` it              |
| `d.caption(text)`                            | the caption in the band from now on                                                            |
| `d.look(target, { ms, pad })`                | the camera eases onto a locator, a page, a rect of the desk, or `'wide'`                       |
| `d.moveTo(target, { ms })`                   | the pointer glides there; the camera slides along when it nears the edge of the view           |
| `d.click(target, { ms, zoom })`              | moves and clicks; with `zoom`, the camera goes in on the target as the pointer goes, and holds |
| `d.type(text)`, `d.press(keys, label)`       | keys, into what was clicked last; `press` shows them on a keycap                               |
| `d.rect(...targets)`                         | the smallest rect of the desk around them all, to look at                                      |
| `d.front(page)`, `d.mark(name)`, `d.cut(fn)` | the window in front; a named moment (`loop-from`, `loop-to`); something left out of the film   |
| `d.end(d.say('outro'))`                      | the end card comes in, and the film ends once the line is said                                 |

The camera keeps to a few deliberate moves: in on what the line is about before the line needs it, held while it is read, out again for the next thing. Each move eases in and out, and a zoom changes size by the same ratio every moment. Keep one thing happening at a time, and let the voice set the pace: the film waits for each line.

## Voices

`--voice` (or `BUDDYLIST_VIDEO_VOICE`) names the voice as `engine:voice`. Each line said is kept in `~/.cache/buddylist-video/voice`, by its words and voice, so only a changed line is said again.

| Engine       | Model                                                | Licence                                             | Voices                                 |
| ------------ | ---------------------------------------------------- | --------------------------------------------------- | -------------------------------------- |
| `qwen3`      | Qwen3-TTS 1.7B CustomVoice, on this Mac              | Apache-2.0                                          | `Aiden` (the default), `Ryan`          |
| `kokoro`     | Kokoro 82M, on this Mac                              | Apache-2.0                                          | `af_heart`, `am_michael`, `bf_emma`, … |
| `elevenlabs` | ElevenLabs' `eleven_multilingual_v2`                 | ElevenLabs' terms: commercial use needs a paid plan | a voice id; George to begin with       |
| `none`       | no voice: each line takes as long as it would to say | —                                                   | —                                      |

The local models run with mlx-audio through `uv`, in a throwaway environment, and download into the Hugging Face cache the first time (Qwen3-TTS about 4 GB, Kokoro about 330 MB). A model that samples says a line the same way each time, and a take too fast or too slow for its words is said again.

**ElevenLabs.** Make a key at [elevenlabs.io](https://elevenlabs.io) under **Developers > API keys**, and export it in your shell, never in the repository:

```bash
export ELEVENLABS_API_KEY=…            # in ~/.zshrc, or for one run
npm run video -- managers --voices elevenlabs,elevenlabs:<another voice id>
```

`curl -s https://api.elevenlabs.io/v1/voices -H "xi-api-key: $ELEVENLABS_API_KEY"` lists the voices the key can use. Audio made on the free plan is not licensed for commercial use: publish only what a paid plan made.
