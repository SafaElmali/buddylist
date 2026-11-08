// The Claude Agent SDK, loaded when Claude is first needed and not when the app starts: it
// is over a megabyte of code, which takes the main process some 40 ms to read, and an app
// that has only just started has no Claude Code to start yet.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** @typedef {typeof import('@anthropic-ai/claude-agent-sdk')} AgentSdk */

/**
 * The SDK itself. It is asked for with require(), which has it at once: a session makes its
 * query in the same breath as it is started, and an import() would have to be waited for.
 * @returns {AgentSdk}
 */
export const agentSdk = () => require('@anthropic-ai/claude-agent-sdk');

/** Starts a Claude Code. @type {AgentSdk['query']} */
export const query = (params) => agentSdk().query(params);

/** A tool as the SDK takes one. @type {AgentSdk['tool']} */
export const tool = (...args) => agentSdk().tool(...args);

/** A server of such tools that runs in this process. @type {AgentSdk['createSdkMcpServer']} */
export const createSdkMcpServer = (options) => agentSdk().createSdkMcpServer(options);

/** The conversations Claude Code keeps of a folder. @type {AgentSdk['listSessions']} */
export const listSessions = (options) => agentSdk().listSessions(options);

/** What Claude Code keeps about one of them. @type {AgentSdk['getSessionInfo']} */
export const getSessionInfo = (sessionId, options) => agentSdk().getSessionInfo(sessionId, options);

/** What was said in one of them. @type {AgentSdk['getSessionMessages']} */
export const getSessionMessages = (sessionId, options) => agentSdk().getSessionMessages(sessionId, options);

/** A copy of one of them, to go on with apart from it. @type {AgentSdk['forkSession']} */
export const forkSession = (sessionId, options) => agentSdk().forkSession(sessionId, options);
