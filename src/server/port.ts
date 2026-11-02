import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
/** Compile-checked subset; no invented SDK methods. */
export type QueryPort = AsyncIterable<SDKMessage> &
  Pick<
    Query,
    | 'close'
    | 'setModel'
    | 'setMcpServers'
    | 'mcpServerStatus'
    | 'supportedAgents'
    | 'reloadPlugins'
    | 'getContextUsage'
  >;
export interface Runtime {
  handle: QueryPort;
  ready?: Promise<void>;
  send(prompt: string): void;
  dispose(): Promise<void>;
}
