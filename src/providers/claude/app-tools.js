// The app's own tools (main/app-tools.js) as the Claude Agent SDK takes them: one
// server of tools that runs in this process, next to the ones Claude Code has.
import { APP_SERVER, APP_TOOLS } from '../../shared/app-tools.js';
import { createSdkMcpServer, tool } from './sdk.js';

/** @typedef {import('../../main/app-tools.js').AppTool} AppTool */

/** The name Claude Code calls one of the app's tools by. @param {string} name */
export const appToolName = (name) => `mcp__${APP_SERVER}__${name}`;

/** Said to Claude once, after the chat instructions, when it has the app's tools. */
export const APP_TOOL_INSTRUCTIONS =
  `buddylist gives you tools of its own, named mcp__${APP_SERVER}__*, for what the user asks to have ` +
  `opened in the app itself. ${appToolName(APP_TOOLS.terminals)} opens terminals beside this conversation, and ` +
  'types a command into them when the user wants something running there, such as terminals running claude. ' +
  `${appToolName(APP_TOOLS.conversation)} starts another conversation, in a worktree of its own, for work that ` +
  'should go on apart from this one: when the user asks for one, or to offer one for a side task you come across. ' +
  'Other agents, such as Codex, can be in it from the start, when the user wants them to work on it together. ' +
  `${appToolName(APP_TOOLS.instructions)} reads and saves what this project's conversations are told, such as ` +
  'how far to take a change without asking: when the user wants to see or change them.';

/**
 * One of the app's tools as the SDK takes a tool: what it answers is text for Claude.
 * @param {AppTool} appTool
 * @param {() => import('../../main/app-tools.js').ToolContext} context  made for each call, before it runs
 */
export function sdkTool({ name, description, input, run }, context) {
  return tool(name, description, input, async (args) => {
    try {
      return { content: [{ type: 'text', text: await run(args, context?.()) }] };
    } catch (err) {
      // What went wrong is for Claude to tell the user: it is not the session's own trouble.
      return { content: [{ type: 'text', text: err.message }], isError: true };
    }
  });
}

/**
 * @param {AppTool[]} tools
 * @param {() => import('../../main/app-tools.js').ToolContext} context
 * @returns {import('@anthropic-ai/claude-agent-sdk').McpSdkServerConfigWithInstance}
 */
export function appToolServer(tools, context) {
  // Always in what Claude is told, not behind its search for tools: it does not look there for a
  // word it thinks it already has a tool for.
  return createSdkMcpServer({
    name: APP_SERVER,
    tools: tools.map((appTool) => sdkTool(appTool, context)),
    alwaysLoad: true,
  });
}
