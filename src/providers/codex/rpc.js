// How the app talks to `codex app-server`: JSON-RPC messages, one per line,
// over the process's stdin and stdout. Either side can ask the other something.
import { connectProcess, JsonRpcPeer } from '../json-rpc.js';

export { JsonRpcPeer };

/** Who the app server is told it is talking to. */
export const CLIENT_INFO = { name: 'buddylist', title: 'buddylist', version: '0.2.0' };

const NOT_INSTALLED =
  'Couldn’t find the Codex CLI. Install it with "npm install -g @openai/codex", run "codex login", then send your message again.';

/**
 * Start `codex app-server` and connect to it.
 * @param {{ command: string, env?: Record<string, string>, config?: string[], onClose: (error: Error) => void } & import('../json-rpc.js').RpcHandlers} opts
 *   `env`: variables for it on top of the app's own. `config`: settings for it on top of its config.toml, each
 *   `key=value` as `codex -c` takes them. `onClose` runs if the process ends without being asked to
 * @returns {import('../json-rpc.js').RpcConnection}
 */
export function connectAppServer({
  command,
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
    notInstalled: NOT_INSTALLED,
    onNotification,
    onNotificationError,
    onRequest,
    onClose,
  });
}
