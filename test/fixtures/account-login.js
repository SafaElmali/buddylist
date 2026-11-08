// Synthetic auth status, backed only by a fixture HOME/config directory. Never calls a real CLI or Keychain.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.CLAUDE_CONFIG_DIR || process.env.HOME;
const read = (file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
const fixture = read('fixture-auth.json');
if (process.argv.slice(2).join(' ') !== 'auth status --json') throw new Error('Only read-only auth status is allowed');
if (fixture.stderr) process.stderr.write(fixture.stderr);
if (fixture.malformed) console.log('not a status');
else if (!fixture.noOutput) {
  const { oauthAccount: account } = read('.claude.json');
  console.log(
    JSON.stringify(
      fixture.signedOut
        ? { loggedIn: false, authMethod: 'none' }
        : {
            loggedIn: true,
            authMethod: fixture.authMethod || 'claude.ai',
            email: account.emailAddress,
            subscriptionType: 'team',
            // Older status responses can omit organization details which remain in .claude.json.
            ...(!fixture.omitOrganization && { orgId: account.organizationUuid, orgName: account.organizationName }),
          }
    )
  );
}
process.exitCode = fixture.exitCode || (fixture.signedOut ? 1 : 0);
