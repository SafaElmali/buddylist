# Bundled classic Winks

These 15 animations and their soundtracks are from the original Microsoft MSN Messenger default Winks. They are included in the desktop app and browser demo.

- Source: [MessengerGeek — How to extract the default MSN winks](https://wink.messengergeek.com/t/how-to-extract-the-default-msn-winks/14337)
- Original archive: [Default-Winks.7z](https://wink.messengergeek.com/uploads/short-url/AwlLRssnA7Bi2DPMhJcbSq4NEV4.7z)
- Retrieved: October 6, 2026
- Conversion: Ruffle 0.6.0 rendered the original Flash files into transparent animated GIFs and their original audio into stereo PCM WAV files, using FFmpeg for encoding.
- Compression: the GIFs became lossless animated WebP (`gif2webp -min_size -m 6`), which keeps every pixel and frame delay, and the WAV files became AAC (`ffmpeg -c:a aac -b:a 128k -movflags +faststart`). That took the folder from 34 MB to 5 MB, and every megabyte here is in each download of the app.

The dancer animation and audio are sped up together to fit the app's 15-second Wink limit (14.9 seconds). All other animations retain their original frame rates. Each soundtrack matches its GIF's duration.

`manifest.json` supplies the browser demo with the same filenames, durations and audio companions that the desktop app reads from this folder. The pack tests check that they stay in sync.

The user's pack folder can add files or override bundled files with the same name. The originals here stay inside the app bundle.
