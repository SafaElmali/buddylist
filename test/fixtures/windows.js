import fs from 'node:fs';
import path from 'node:path';
import { tempDir } from './temp-dir.js';

// The stand-in for cmd.exe is a script, which Windows has no way to start. There the real one is.
export const NOT_ON_WINDOWS = { skip: process.platform === 'win32' };

/**
 * A CLI as npm installs it on Windows, a batch file, and a stand-in for cmd.exe to name in ComSpec.
 * The stand-in says what it was asked to run in a JSON-RPC notification, "cmd", and leaves with 0.
 * @returns {{ batch: string, cmd: string }}
 */
export function batchAndCmd() {
  const dir = tempDir('cm-cmd-');
  const batch = path.join(dir, 'agent.cmd');
  fs.writeFileSync(batch, '@echo off\r\n');
  const cmd = path.join(dir, 'cmd');
  const say = 'console.log(JSON.stringify({ method: "cmd", params: { args: process.argv.slice(1) } }))';
  fs.writeFileSync(cmd, `#!/bin/sh\nexec "${process.execPath}" -e '${say}' "$@"\n`, { mode: 0o755 });
  return { batch, cmd };
}
