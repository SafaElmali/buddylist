// Codex uses an empty MCP form for tool-call approval. Other forms need input
// controls we do not implement; never accept them as if they were confirmations.
import { truncateOutput } from '../base-session.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const SCHEMA_KEYS = new Set(['$schema', 'type', 'properties', 'required']);

export function mcpApprovalRequest(params) {
  const schema = params?.requestedSchema;
  if (
    params?.mode !== 'form' ||
    typeof params.threadId !== 'string' ||
    !params.threadId ||
    (params.turnId != null && typeof params.turnId !== 'string') ||
    typeof params.serverName !== 'string' ||
    !params.serverName ||
    typeof params.message !== 'string' ||
    !params.message ||
    params._meta?.codex_approval_kind !== 'mcp_tool_call' ||
    !object(schema) ||
    schema.type !== 'object' ||
    !object(schema.properties) ||
    Object.keys(schema.properties).length ||
    Object.keys(schema).some((key) => !SCHEMA_KEYS.has(key)) ||
    (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.length))
  )
    return null;
  // Metadata is display-only. It never establishes trust or bypasses a prompt.
  const meta = params._meta;
  return {
    activity: {
      kind: 'tool',
      label: typeof meta.tool_title === 'string' ? meta.tool_title : 'MCP tool',
      source: params.serverName,
    },
    title: params.message,
    detail:
      truncateOutput(
        [
          typeof meta.tool_description === 'string' && meta.tool_description,
          meta.tool_params !== undefined && JSON.stringify(meta.tool_params, null, 2),
        ]
          .filter(Boolean)
          .join('\n\n')
      ) || null,
  };
}

const named = (value) => (typeof value === 'string' && value.trim()) || null;

/** The same value, written the same way whatever order its keys came in. */
const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : object(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])])
        )
      : value;

/**
 * What allowing an approval for the rest of the conversation would cover, where it can be: a server that lets a session
 * remember its answer (`persist` names `session`) and an app it is for, as Computer Use asks before each action in an
 * app. Null for any other. It covers the same server and connector asking the same about the same app, and nothing
 * else: `key` tells those apart. The server is never told to remember it itself: Computer Use keeps such an answer on
 * disk for the thread, past a restart of the app.
 * @returns {{ key: string, name: string, app: string, computerUse: boolean } | null}
 */
export function mcpAllowance(params) {
  const meta = params?._meta;
  const app = named(meta?.tool_params?.app);
  if (!app || ![meta.persist].flat().includes('session')) return null;
  const shown = Array.isArray(meta.tool_params_display)
    ? meta.tool_params_display.find((param) => param?.name === 'app')?.value
    : null;
  return {
    key: JSON.stringify([params.serverName, meta.connector_id ?? null, params.message, canonical(meta.tool_params)]),
    name: named(meta.connector_name) || params.serverName,
    app: named(shown) || app,
    computerUse: meta.connector_id === 'computer-use',
  };
}

export function mcpApprovalResponse(decision, cancellationReason = 'interrupted') {
  const action = ['allow', 'always'].includes(decision)
    ? 'accept'
    : ['deny', 'feedback'].includes(decision)
      ? 'decline'
      : 'cancel';
  return {
    action,
    content: action === 'accept' ? {} : null,
    _meta: decision === 'cancelled' ? { codex_approval_cancellation_reason: cancellationReason } : null,
  };
}
