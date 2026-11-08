// Installed only in the isolated UI check's bundle. No SDK process or real account is used.
import { Conversations } from '../../src/main/conversations.js';
import { ClaudeSession } from '../../src/providers/claude/session.js';
import { InputQueue } from '../../src/providers/claude/input-queue.js';
import fs from 'node:fs';

export function installSendNowFixture() {
  process.on('unhandledRejection', (error) => {
    fs.appendFileSync(process.env.BUDDYLIST_TEST_LOG, `${error?.stack ?? error}\n`);
  });
  const fixture = (globalThis.sendNowFixture = { mode: 'hang', interrupts: 0, sent: [] });
  const original = Conversations.prototype.send;
  Conversations.prototype.send = function (...args) {
    fixture.conversations = this;
    this.providers.createSession = (contact, emit) => {
      const output = new InputQueue();
      fixture.output = output;
      fixture.finish = () =>
        output.push({
          type: 'result',
          subtype: 'success',
          is_error: false,
          duration_ms: 5,
          total_cost_usd: 0,
          num_turns: 1,
        });
      const queryFn = ({ prompt }) => {
        void (async () => {
          for await (const message of prompt) fixture.sent.push(message);
        })();
        output.push({
          type: 'system',
          subtype: 'init',
          session_id: 'fixture-session',
          model: 'fixture',
          tools: [],
          slash_commands: [],
          permissionMode: 'default',
        });
        return Object.assign(output[Symbol.asyncIterator](), {
          [Symbol.asyncIterator]() {
            return this;
          },
          initializationResult: async () => ({}),
          interrupt: async () => {
            fixture.interrupts += 1;
            if (fixture.mode === 'hang') return new Promise(() => {});
            fixture.finish();
          },
          close: () => output.close(),
        });
      };
      return new ClaudeSession({ contact, emit, queryFn });
    };
    return original.apply(this, args);
  };
}
