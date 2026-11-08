/**
 * `promise`, unless it takes longer than `ms`: then a rejection that says so.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} who  the program that was asked: "Codex"
 * @returns {Promise<T>}
 */
export function within(promise, ms, who) {
  let timer;
  const late = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${who} took too long to answer.`)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}
