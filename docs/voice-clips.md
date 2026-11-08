# Voice clips

Hold **F2**, say your message, and let go. What you said is typed into the message box, so you can fix it before you press Enter. The **Voice Clip** button by the message box does the same while you hold it down.

**View > Voice clips...** in a conversation, or **Tools > Voice clips...** in the contact list, changes the shortcut, and lets you press it once to start and again to stop instead of holding it. A shortcut is one of the F keys, or a key with Ctrl, ⌥ or ⌘. [Settings > Shortcuts](settings.md#app) changes it too, with the app's other shortcuts: keys one of them already has can't record a clip as well.

**Send the message as soon as I stop talking**, in the same place, sends what you said without waiting for Enter. Anything already in the message box is sent with it. Left off, your words are only typed.

Your voice is turned into text on your computer by [whisper.cpp](https://github.com/ggml-org/whisper.cpp). The recording never leaves it.

**Set it up on Mac.** Install whisper.cpp and download a model:

```bash
brew install whisper-cpp
curl -L --fail --create-dirs -o "$HOME/Library/Application Support/buddylist/whisper/ggml-base.en.bin" https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

**On Windows and Linux**, install or build whisper.cpp for your system and put `whisper-cli` on your PATH, or set `BUDDYLIST_WHISPER_CLI` to its full executable path. Put the model in `whisper/` inside [the app's data folder](getting-started.md#where-your-data-lives), or set `BUDDYLIST_WHISPER_MODEL` to its full path.

Neither is bundled, because a model alone is about 150 MB. `ggml-base.en.bin` is English only. The [other models](https://huggingface.co/ggerganov/whisper.cpp) understand more languages; the bigger ones are more accurate and slower.

- The app finds `whisper-cli` on your `PATH`; set `BUDDYLIST_WHISPER_CLI` to use a different one.
- It uses the `ggml-*.bin` file in that `whisper` folder, the first by name if there are several. Set `BUDDYLIST_WHISPER_MODEL` to use a model kept somewhere else.
- On Mac, macOS asks for microphone access the first time you record. Allow it, then hold F2 again.

Good to know:

- On a Mac keyboard F2 is **fn+F2**, unless your F keys are set to work as standard function keys.
- Wait for "Recording" in the status bar before you talk. The microphone is only on while you hold the key.
- `Esc` throws the clip away. So does switching to another window while you hold the shortcut; a clip you started with a press carries on.
- A tap does nothing, and a clip stops by itself after two minutes.
- **Conversation > Record a voice clip** records until you press the shortcut, whichever way it is set.
- The browser preview has no microphone: it types a sample sentence instead.

## If a voice clip will not start

Hold the microphone button until the status says **Recording**, or choose **Press it once to start, and again to stop** in **View > Voice clips...**. A quick tap in hold mode cancels the clip. Escape cancels either mode; you can record again without changing your draft or attachments.

- **Access is not allowed:** on Mac, check **System Settings > Privacy & Security > Microphone** for buddylist. Restart buddylist after changing access. If your administrator restricts microphone use, they must change that policy. A browser also has its own site permission. The agent's **Never ask** setting does not grant microphone access.
- **No microphone was found / could not be opened:** check the input selected in your system sound settings, enable or reconnect it, then record again. This error alone does not mean another app is using it.
- **The voice recorder could not start:** restart buddylist, then check for an update or use **Help > Send feedback...** if it persists. This is a recorder setup failure, separate from microphone permission.
- **Whisper errors:** recording has stopped and the microphone is released. Check the whisper.cpp executable and model setup above before recording again. These errors do not require changing microphone permission.

If a device disconnects or recording fails, the clip is discarded and the draft stays in the message box. Nothing is sent on failure. Successful clips still follow your **Send the message as soon as I stop talking** setting.
