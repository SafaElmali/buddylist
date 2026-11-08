// Shared synthetic account fixture for unit tests and the real Electron Accounts check.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function accountLoginFixture(home, { node = process.execPath } = {}) {
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const binary = path.join(home, 'claude-fixture');
  const script = fileURLToPath(new URL('./account-login.js', import.meta.url));
  // A Node shebang points at the runner, not at Electron or the user's Claude executable.
  fs.writeFileSync(
    binary,
    `#!${node}\nimport(${JSON.stringify(new URL('./account-login.js', import.meta.url).href)});\n`
  );
  fs.chmodSync(binary, 0o755);
  const write = (dir = home, patch = {}, identity = {}) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.claude.json'),
      JSON.stringify({
        oauthAccount: {
          emailAddress: 'fixture@example.test',
          organizationUuid: 'fixture-team',
          organizationName: 'Fixture Team',
          organizationType: 'claude_team',
          ...identity,
        },
      })
    );
    fs.writeFileSync(path.join(dir, 'fixture-auth.json'), JSON.stringify(patch));
  };
  write();
  return { binary, script, write, env: { HOME: home, PATH: process.env.PATH } };
}
