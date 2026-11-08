const APP_ID = 'buddylist/0.2.0';

// If the app itself was started from inside a Claude Code session, don't let
// that session's identity leak into the ones we spawn. Nor where it was held: a
// conversation of the app's is one the SDK started, and is kept as one (see sessions.js).
export function childEnv() {
  // Claude Code only gives an SDK session its to-do list tools when asked to. A user who turned them off keeps them off.
  const env = { CLAUDE_CODE_ENABLE_TODO_TOOLS: '1', ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: APP_ID };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}
