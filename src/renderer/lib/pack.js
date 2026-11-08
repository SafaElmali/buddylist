// What's in the user's local pack of emoticons, winks and display pictures
// (see src/main/pack.js). Each window asks for it once, with
// setPack(await api.pack.list()), before drawing anything that could use it.

/** @typedef {{ emoticons: string[], winks: { file: string, duration: number | null, audio?: string }[], pictures: string[] }} PackList */

/** @type {PackList} */
let current = { emoticons: [], winks: [], pictures: [] };

export const pack = () => current;

/** @param {PackList} list */
export function setPack(list) {
  current = list;
}
