#!/usr/bin/env node
// A stand-in for Tailscale's command, for a check run of Settings > Remote access (BUDDYLIST_TAILSCALE_CLI with
// BUDDYLIST_TEST=1): it answers `status --json`, `serve status --json`, `serve --bg …` and `serve … off` as Tailscale
// does, from the JSON file FAKE_TAILSCALE_STATE names, and writes Serve's state back to it. The real Tailscale is
// never asked. The file says:
//   { "backend": "Running" | "Stopped" | "NeedsLogin", "host": "mac.tail1234.ts.net", "login": "safa@example.com",
//     "phones": [{ "name": "safas-iphone", "os": "iOS" }], "serving": { "httpsPort": 443, "target": "http://…" } | null }
import fs from 'node:fs';

const file = process.env.FAKE_TAILSCALE_STATE;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
const say = (json) => process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);

if (args[0] === 'status') {
  if (state.backend === 'Stopped') {
    process.stderr.write('failed to connect to local Tailscale service; is Tailscale running?\n');
    process.exit(1);
  }
  say({
    BackendState: state.backend,
    Self: { DNSName: `${state.host}.`, UserID: 1, OS: 'macOS' },
    User: { 1: { LoginName: state.login } },
    CertDomains: [state.host],
    Peer: Object.fromEntries(
      (state.phones ?? []).map((phone, i) => [
        `peer${i}`,
        {
          HostName: 'localhost',
          DNSName: `${phone.name}.${state.host.split('.').slice(1).join('.')}.`,
          OS: phone.os ?? 'iOS',
          UserID: 1,
          Online: true,
        },
      ])
    ),
  });
} else if (args[0] === 'serve' && args[1] === 'status') {
  const { serving } = state;
  say(
    serving
      ? {
          TCP: { [serving.httpsPort]: { HTTPS: true } },
          Web: { [`${state.host}:${serving.httpsPort}`]: { Handlers: { '/': { Proxy: serving.target } } } },
        }
      : {}
  );
} else if (args[0] === 'serve' && args.at(-1) === 'off') {
  state.serving = null;
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
} else if (args[0] === 'serve' && args[1] === '--bg') {
  const httpsPort = Number(args[2].split('=')[1]);
  const target = args[3];
  state.serving = { httpsPort, target };
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
  process.stdout.write(
    `Available within your tailnet:\n\nhttps://${state.host}/\n|-- proxy ${target}\n\nServe started and running in the background.\nTo disable the proxy, run: tailscale serve --https=${httpsPort} off\n`
  );
} else {
  process.stderr.write(`fake tailscale: ${args.join(' ')} is not something it answers\n`);
  process.exit(2);
}
