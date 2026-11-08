// The app's own tools (src/main/app-tools.js) say what they take with zod, for the SDK
// that hands them to a real agent. A scripted contact calls a tool as it is, so in the
// preview every part of a description answers with more of the same and nothing is checked.
const anything = new Proxy(() => anything, { get: () => anything });

export const z = anything;
