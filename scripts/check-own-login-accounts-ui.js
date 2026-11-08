// Real Electron renderer and Accounts IPC with isolated HOME, config and synthetic auth/usage probes.
// node scripts/check-own-login-accounts-ui.js [proof-directory]
/* global window, document */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';
import { Store } from '../src/main/storage/store.js';
import { accountLoginFixture } from '../test/fixtures/account-login-setup.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(os.homedir(), 'buddylist-media/own-login-accounts'));
fs.mkdirSync(output, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddylist-own-login-ui-'));
const errors = [];
const results = [];
let app;
try {
  for (const look of ['professional', 'messenger']) {
    for (const scenario of ['same-account', 'signed-out', 'keychain-unreadable', 'rate-limited']) {
      const home = path.join(temp, `${look}-${scenario}`);
      const fixture = accountLoginFixture(home);
      const profile = path.join(home, 'profile');
      const added = path.join(profile, 'accounts', 'claude', 'team');
      fixture.write(
        home,
        scenario === 'signed-out'
          ? { signedOut: true }
          : scenario === 'keychain-unreadable'
            ? { noOutput: true, exitCode: 1, stderr: 'Keychain access denied: synthetic-secret-do-not-display' }
            : { omitOrganization: true, exitCode: 1 }
      );
      fixture.write(added);
      const store = new Store(profile, { defaultProvider: 'claude' });
      store.finishOnboarding();
      store.updateProfile({ name: 'Account check' });
      store.updateSettings({
        look,
        theme: 'light',
        sounds: false,
        shareUsage: false,
        errorReports: false,
        suggestReplies: false,
        accounts: {
          claude: {
            inUse: 'team',
            added: [
              {
                id: 'team',
                email: 'fixture@example.test',
                orgId: 'fixture-team',
                orgName: 'Fixture Team',
                plan: 'team',
              },
            ],
          },
        },
      });
      const env = {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        BUDDYLIST_DEMO: '1',
        BUDDYLIST_TEST: '1',
        BUDDYLIST_USER_DATA: profile,
      };
      for (const key of [
        'ELECTRON_RUN_AS_NODE',
        'CLAUDE_CONFIG_DIR',
        'BUDDYLIST_UPDATES_URL',
        'BUDDYLIST_ANALYTICS_URL',
        'ANTHROPIC_API_KEY',
        'CLAUDE_CODE_OAUTH_TOKEN',
      ])
        delete env[key];
      app = await electron.launch({ executablePath: electronPath, args: [root], env, timeout: 60000 });
      const page = await app.firstWindow();
      page.setDefaultTimeout(15000);
      page.on('pageerror', (error) => errors.push(error.message));
      await app.evaluate(
        (_electron, { root, home, binary, scenario }) => {
          const require = process.getBuiltinModule('module').createRequire(root);
          const { Accounts } = require(new URL('src/main/accounts.js', root).pathname);
          const { claudeAccounts } = require(new URL('src/providers/claude/accounts.js', root).pathname);
          const fixtureOps = claudeAccounts({
            binary: () => binary,
            env: () => ({ HOME: home, PATH: process.env.PATH }),
            loginArgs: () => [],
            queryFn: ({ options, prompt }) => ({
              accountInfo: async () => ({ email: 'fixture@example.test' }),
              usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: async () => {
                if (!options.env.CLAUDE_CONFIG_DIR || scenario === 'rate-limited')
                  throw Object.assign(new Error('429 synthetic rate limit'), {
                    status: 429,
                    headers: { 'retry-after': '600' },
                  });
                const reset = new Date(Date.now() + 3_600_000).toISOString();
                return {
                  rate_limits_available: true,
                  rate_limits: {
                    five_hour: { utilization: 52, resets_at: reset },
                    seven_day: { utilization: 21, resets_at: reset },
                  },
                };
              },
              close() {
                prompt.close();
              },
            }),
          });
          // Only replace the external provider in this isolated process. Cache, identity handling,
          // dashboard, IPC and renderer are the real implementation.
          const dashboard = Accounts.prototype.dashboard;
          Accounts.prototype.dashboard = function (...args) {
            this.ops = () => fixtureOps;
            return dashboard.apply(this, args);
          };
        },
        { root: pathToFileURL(`${root}/`).href, home, binary: fixture.binary, scenario }
      );
      await page.evaluate(() => window.messenger.settings.open({ section: 'accounts' }));
      const card = page
        .locator('.st-account-card')
        .filter({ has: page.locator('.st-card-head b', { hasText: /^Claude$/ }) });
      await card.getByRole('button', { name: 'Refresh', exact: true }).waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector('.st-account-quota')?.textContent.includes('Last checked') ||
          document.querySelector('.st-account-quota')?.textContent.includes('Updated')
      );
      const rows = card.locator('.st-account');
      assert.equal(await rows.count(), 2);
      const terminal = rows.nth(0),
        copy = rows.nth(1);
      assert.match(await terminal.innerText(), /The login Claude Code uses in your terminal/);
      const text = await terminal.innerText();
      assert.ok(!text.includes('synthetic-secret'));
      if (scenario === 'same-account') {
        assert.match(text, /fixture@example.test/);
        assert.match(text, /52% used/);
        assert.match(text, /21% used/);
        assert.match(text, /Signed in/);
        assert.match(await copy.innerText(), /same account as terminal login/);
        assert.equal(await copy.getByRole('button', { name: 'Use', exact: true }).count(), 0);
      } else if (scenario === 'signed-out') {
        assert.match(text, /Terminal login/);
        assert.match(text, /Signed out/);
        assert.match(text, /claude auth login/);
      } else if (scenario === 'keychain-unreadable') {
        assert.match(text, /fixture@example.test/);
        assert.match(text, /Sign-in not confirmed/);
        assert.match(text, /could not read the macOS Keychain/);
        assert.ok(!(await copy.innerText()).includes('same account as'));
      } else {
        assert.match(text, /Signed in/);
        assert.match(text, /limiting usage checks/);
        assert.match(text, /Retry after/);
      }
      await terminal.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `${look}-${scenario}.png`), animations: 'disabled' });
      results.push({ look, scenario, text });
      await app.close();
      app = null;
    }
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  console.log(`Passed ${results.length} isolated Electron scenarios. Proof: ${output}`);
} finally {
  await app?.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
