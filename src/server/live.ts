import {
  query,
  createSdkMcpServer,
  tool,
  type SDKUserMessage,
  type Query,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { InputQueue } from './input.js';
import type { Runtime, QueryPort } from './port.js';
import { WORKSPACE } from './paths.js';
export type QueryFactory = (
  input: Parameters<typeof query>[0],
) => QueryPort & Partial<Pick<Query, 'initializationResult'>>;
export function createLessonServer() {
  return createSdkMcpServer({
    name: 'lifecycle-notes',
    version: '1.0.0',
    tools: [
      tool(
        'lifecycle_note',
        'Read a short course note about query handles and cleanup.',
        { topic: z.enum(['handle', 'cleanup']) },
        async ({ topic }) => ({
          content: [
            {
              type: 'text',
              text:
                topic === 'handle'
                  ? 'Retain q to observe messages and issue runtime controls on one session.'
                  : 'Close the query and dispose host-owned queues, timers and servers.',
            },
          ],
        }),
        { annotations: { readOnlyHint: true, openWorldHint: false } },
      ),
    ],
  });
}
export function createLiveRuntime(queryFactory: QueryFactory = query): Runtime {
  const input = new InputQueue<SDKUserMessage>();
  const abortController = new AbortController();
  let handle: ReturnType<QueryFactory>;
  try {
    // Keep input open. Runtime controls require streaming input/output mode.
    handle = queryFactory({
      prompt: input,
      options: {
        cwd: WORKSPACE,
        tools: [],
        settingSources: [],
        persistSession: false,
        permissionMode: 'dontAsk',
        allowedTools: ['mcp__course__lifecycle_note'],
        agents: {
          'lifecycle-guide': {
            description: 'Explain query lifecycle responsibilities.',
            prompt: 'Explain observation, control and cleanup concisely.',
            tools: [],
          },
        },
        maxTurns: 4,
        maxBudgetUsd: 0.25,
        abortController,
        ...(process.env.ANTHROPIC_MODEL ? { model: process.env.ANTHROPIC_MODEL } : {}),
        systemPrompt:
          'You are a concise TypeScript course tutor. Explain query handles using the user task. No file or command tools are available.',
      },
    });
  } catch (error) {
    input.close();
    abortController.abort();
    throw error;
  }
  let disposed = false;
  return {
    handle,
    ready: handle.initializationResult?.().then(() => undefined) ?? Promise.resolve(),
    send(prompt) {
      input.push({
        type: 'user',
        message: { role: 'user', content: prompt },
        parent_tool_use_id: null,
        session_id: '',
        uuid: randomUUID(),
      });
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      input.close();
      abortController.abort();
    },
  };
}
