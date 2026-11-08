// Where the Claude Code binary lives.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const BINARY = process.platform === 'win32' ? 'claude.exe' : 'claude';
const PLATFORM_PACKAGE = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;

/**
 * In development the Agent SDK finds its own bundled binary. Inside a packaged
 * app that binary sits outside the asar archive, so point the SDK at it.
 * BUDDYLIST_CLAUDE_CLI overrides both (e.g. to use your installed `claude`).
 * @param {{ isPackaged: boolean, resourcesPath?: string }} app
 * @returns {string | undefined}
 */
export function claudeBinaryPath({ isPackaged, resourcesPath }) {
  if (process.env.BUDDYLIST_CLAUDE_CLI) return process.env.BUDDYLIST_CLAUDE_CLI;
  if (!isPackaged || !resourcesPath) return undefined;
  const candidate = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', PLATFORM_PACKAGE, BINARY);
  return fs.existsSync(candidate) ? candidate : undefined;
}

/**
 * The binary the Agent SDK came with, for asking it something without the SDK: in
 * development it is installed next to the SDK, which is the only one that knows where.
 * @returns {string | undefined}  none where the SDK has no binary for this computer
 */
export function sdkBinaryPath() {
  try {
    const sdk = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk');
    return createRequire(sdk).resolve(`${PLATFORM_PACKAGE}/${BINARY}`);
  } catch {
    return undefined;
  }
}
