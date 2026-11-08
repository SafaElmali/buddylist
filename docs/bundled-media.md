# Bundled MSN media

The app and the browser demo bundle two sets of media from MSN Messenger itself: its sounds and its default Winks. They stay in the app, but nothing for the people who use it, neither the landing page nor the guides at buddylist.dev/docs, advertises them.

Where each Wink comes from, and how it was converted and compressed, is in [the pack's README](../src/pack/README.md).

## The sounds

The desktop app and browser demo include the original MSN Messenger recordings: `type.wav` for incoming messages, `nudge.wav` for nudges and `online.wav` for sign-ins. Both builds play the same WAV files unchanged, without changing their pitch, speed or volume. Sending a message is silent.

The recordings in `src/renderer/sounds/` are Microsoft's original MSN Messenger media, verified byte-for-byte against the unpatched MSN Messenger 7.5.0324 installer from [Escargot's archive](https://escargot.chat/download/msn/lang/en/). They are bundled with both builds; there is no synthesized replacement. Extra local sound files are gitignored and are not copied into the browser demo.
