export const VERSION = '0.3.310';
export const DEFAULT_PROMPT =
  'Explain why a host should retain the query handle, inspect messages, and close the session.';
export const METHODS = [
  {
    name: 'query()',
    purpose:
      'Create and retain one handle. Streaming input keeps the session open for subsequent turns.',
    kind: 'Create',
  },
  {
    name: 'for await',
    purpose:
      'Observe typed messages on that same handle. A result finishes a turn, not necessarily the session.',
    kind: 'Observe',
  },
  {
    name: 'mcpServerStatus()',
    purpose:
      'Inspect connections and advertised tools. Connection health does not grant tool permission.',
    kind: 'Inspect',
  },
  {
    name: 'supportedAgents()',
    purpose: 'Discover available subagents. Discovery does not launch an agent.',
    kind: 'Inspect',
  },
  {
    name: 'setMcpServers()',
    purpose:
      'Replace the application-managed dynamic MCP set. Settings and plugin-owned servers have separate rules.',
    kind: 'Control',
  },
  {
    name: 'setModel()',
    purpose:
      'Select the model for subsequent responses in streaming-input mode. Log the change in the host.',
    kind: 'Control',
  },
  {
    name: 'reloadPlugins()',
    purpose:
      'Refresh plugins. holdOnCacheImpact can report held:true; acknowledge the returned outcome.',
    kind: 'Control',
  },
  {
    name: 'getContextUsage()',
    purpose:
      'Inspect current context categories. This sample requests summary detail, avoiding full per-category token-count probes.',
    kind: 'Inspect',
  },
  {
    name: 'result.usage / result.modelUsage',
    purpose:
      'Read usage from the latest result. modelUsage and total_cost_usd are cumulative; do not sum snapshots.',
    kind: 'Inspect',
  },
  {
    name: 'close()',
    purpose:
      'End this host-owned session and release resources. Usage inspection does not close the handle.',
    kind: 'Cleanup',
  },
] as const;
export type Mode = 'practice' | 'live';
export type Status = 'starting' | 'ready' | 'running' | 'closed' | 'error';
export type Command =
  | 'send'
  | 'mcp-status'
  | 'agents'
  | 'attach-mcp'
  | 'detach-mcp'
  | 'set-model'
  | 'reload-plugins'
  | 'context'
  | 'usage'
  | 'close';
export interface EventView {
  sequence: number;
  time: string;
  category: 'host' | 'message' | 'control' | 'error';
  title: string;
  detail: string;
  data?: unknown;
}
export interface UsageView {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  modelUsage: unknown;
  note: string;
}
export interface Snapshot {
  id: string;
  mode: Mode;
  status: Status;
  events: EventView[];
  messageCount: number;
  turnCount: number;
  closeCount: number;
  lastResult: string | null;
  lastTurnOk: boolean | null;
  usage: UsageView | null;
  model: string;
  mcpAttached: boolean;
  pendingControl: boolean;
}
export interface Metadata {
  version: string;
  liveAvailable: boolean;
  methods: typeof METHODS;
  usageCorrection: string;
}
export const QUIZ = [
  {
    question: 'Why retain q instead of only iterating a temporary query?',
    answers: [
      'To inspect and control the same session',
      'To make all tools automatically permitted',
      'To skip message handling',
    ],
    correct: 0,
  },
  {
    question: 'The MCP server reports connected. What does that prove?',
    answers: [
      'Every tool is permitted',
      'The connection is healthy; permissions are separate',
      'A subagent was launched',
    ],
    correct: 1,
  },
  {
    question:
      'Two result messages report cumulative costs of $0.01 and $0.02. Which is the latest reported total?',
    answers: ['$0.03', '$0.01', '$0.02'],
    correct: 2,
  },
  {
    question: 'Which action ends the host-owned session?',
    answers: [
      'Reading result.usage',
      'Calling close() and disposing host resources',
      'Inspecting context usage',
    ],
    correct: 1,
  },
] as const;
