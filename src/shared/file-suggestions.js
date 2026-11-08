// Matching paths is shared by the desktop lookup and the browser's sample files.
export const FILE_SUGGESTIONS_MAX = 30;

/** The best matches first, with a bounded list for the completion menu. */
export function matchingFiles(files, query, limit = FILE_SUGGESTIONS_MAX) {
  const sought = String(query ?? '')
    .slice(0, 300)
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .toLowerCase();
  const score = (lower) => {
    const name = lower.slice(lower.lastIndexOf('/') + 1);
    return name === sought ? 0 : name.startsWith(sought) ? 1 : lower.startsWith(sought) ? 2 : 3;
  };
  const found = [...new Set(files)]
    // These cannot be represented by a quoted @path in the message box.
    .filter((file) => file && !/["\r\n\0]/.test(file) && file.toLowerCase().includes(sought))
    // Each score is independent of the other paths. Sorting used to compute it twice per comparison.
    .map((file) => ({ file, score: score(file.toLowerCase()) }))
    .sort((a, b) => a.score - b.score || a.file.localeCompare(b.file));
  return { paths: found.slice(0, limit).map(({ file }) => file), more: found.length > limit };
}
