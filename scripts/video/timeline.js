// Time in a feature video: the take is what was filmed, as it happened, and the film is the take without the
// parts cut out of it, such as waiting for a window to open. And the captions file, timed to the film.

/**
 * The film without the parts cut out of the take.
 * @param {{ duration: number, cuts: { from: number, to: number }[] }} take  in milliseconds of the take
 * @returns {{ duration: number, toTake: (seconds: number) => number, toFilm: (ms: number) => number }}
 *   the film's length in seconds, and the way from a moment of the film, in seconds, to one of the take, in
 *   milliseconds, and back
 */
export function timeline(take) {
  const cuts = [...take.cuts].sort((a, b) => a.from - b.from);
  const removed = cuts.reduce((sum, cut) => sum + cut.to - cut.from, 0);
  const toTake = (seconds) => {
    let ms = seconds * 1000;
    for (const cut of cuts) if (ms >= cut.from) ms += cut.to - cut.from;
    return ms;
  };
  // A moment inside a cut is where the cut is.
  const toFilm = (ms) => {
    let gone = 0;
    for (const cut of cuts) {
      if (ms >= cut.to) gone += cut.to - cut.from;
      else if (ms > cut.from) gone += ms - cut.from;
    }
    return (ms - gone) / 1000;
  };
  return { duration: (take.duration - removed) / 1000, toTake, toFilm };
}

/** 83.4 seconds as SubRip has it: 00:01:23,400. */
export function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (n, size = 2) => String(n).padStart(size, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

/** A caption's words in lines of at most `width` characters, as a player shows them: two at most, by balance. */
export function captionLines(text, width = 42) {
  const words = text.replace(/\*\*/g, '').split(/\s+/).filter(Boolean);
  const one = words.join(' ');
  if (one.length <= width) return [one];
  // Two lines as even as they can be, broken between words.
  let best = null;
  for (let i = 1; i < words.length; i += 1) {
    const pair = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const longest = Math.max(...pair.map((line) => line.length));
    if (!best || longest < best.longest) best = { pair, longest };
  }
  return best.pair;
}

/**
 * The captions file of a narration: a cue for each line, from when it is said until it ends, or until the next
 * one starts, whichever is first. Each line longer than two lines of captions is split at its sentences.
 * @param {{ at: number, end: number, text: string }[]} lines  in seconds of the film
 */
export function srt(lines) {
  const cues = [];
  for (const line of [...lines].sort((a, b) => a.at - b.at)) {
    const parts = splitLong(line.text);
    // A line split in parts gives each part its share of the time, by its length.
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    let at = line.at;
    for (const part of parts) {
      const end = at + ((line.end - line.at) * part.length) / total;
      cues.push({ at, end, text: captionLines(part).join('\n') });
      at = end;
    }
  }
  return cues
    .map((cue, i) => {
      const end = Math.min(cue.end, cues[i + 1]?.at ?? Infinity);
      return `${i + 1}\n${srtTime(cue.at)} --> ${srtTime(end)}\n${cue.text}\n`;
    })
    .join('\n');
}

/** A line in parts that each fit two lines of captions: whole sentences where they can, else at a comma. */
function splitLong(text, most = 84) {
  if (text.length <= most) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+["”’)]*\s*|[^.!?]+$/g)?.map((s) => s.trim()) ?? [text];
  if (sentences.length > 1) return sentences.flatMap((sentence) => splitLong(sentence, most));
  const at = text.lastIndexOf(', ', Math.floor(text.length / 2) + 10);
  if (at > 0) return [text.slice(0, at + 1), text.slice(at + 2)].flatMap((part) => splitLong(part, most));
  return [text];
}
