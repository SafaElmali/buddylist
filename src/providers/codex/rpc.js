// How the app talks to `codex app-server`: JSON-RPC messages, one per line,
// over the process's stdin and stdout. Either side can ask the other something.
import { connectProcess, JsonRpcPeer } from '../json-rpc.js';

export { JsonRpcPeer };

/** Who the app server is told it is talking to. */
export const CLIENT_INFO = { name: 'buddylist', title: 'buddylist', version: '0.2.0' };

/** What installs it, for the user to copy. */
export const INSTALL_COMMAND = 'npm install -g @openai/codex';
/** @type {import('../json-rpc.js').Program} */
export const CODEX = { name: 'the Codex CLI', install: `Install it with "${INSTALL_COMMAND}"` };

/**
 * Start `codex app-server` and connect to it.
 * @param {{ command: string, askedAgain?: boolean, env?: Record<string, string>, config?: string[], onClose: (error: Error) => void } & import('../json-rpc.js').RpcHandlers} opts
 *   `askedAgain`: as connectProcess takes it. `env`: variables for it on top of the app's own. `config`: settings for
 *   it on top of its config.toml, each `key=value` as `codex -c` takes them. `onClose` runs if the process ends
 *   without being asked to
 * @returns {import('../json-rpc.js').RpcConnection}
 */
export function connectAppServer({
  command,
  askedAgain,
  env,
  config = [],
  onNotification,
  onNotificationError,
  onRequest,
  onClose,
}) {
  return connectProcess({
    command,
    env,
    args: ['app-server', ...config.flatMap((setting) => ['-c', setting])],
    name: 'Codex',
    program: CODEX,
    askedAgain,
    onNotification,
    onNotificationError,
    onRequest,
    onClose,
  });
}
