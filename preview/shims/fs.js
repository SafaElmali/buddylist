// The browser preview has no disk: every folder exists except "archived" ones,
// which shows how an Offline contact looks.
export const existsSync = (p) => !String(p).includes('/archive/');
// The folder of a contact on This computer is made again before its session: there is nothing to make here.
export const mkdirSync = () => {};
export default { existsSync, mkdirSync };
