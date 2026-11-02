import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { setTimeout as delay } from 'node:timers/promises';
import { InputQueue } from './input.js';
import type { QueryPort, Runtime } from './port.js';
/** Explicit teaching fixture. No Claude process, model request, or SDK runtime control executes here. */
export function createPracticeRuntime(stepMs = 300): Runtime {
  const input = new InputQueue<string>();
  const abort = new AbortController();
  let model = 'fixture-model';
  let attached = false;
  let turns = 0;
  const castMessage = (value: unknown) => value as SDKMessage;
  const handle: QueryPort = {
    async *[Symbol.asyncIterator]() {
      yield castMessage({ type: 'system', subtype: 'init' });
      try {
        for await (const prompt of input) {
          await delay(stepMs, undefined, { signal: abort.signal });
          yield castMessage({ type: 'user', message: { role: 'user', content: prompt } });
          await delay(stepMs, undefined, { signal: abort.signal });
          yield castMessage({
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'text',
                  text: 'Practice fixture: the host retains q, observes its typed stream, and issues controls on the same handle.',
                },
              ],
            },
          });
          await delay(stepMs, undefined, { signal: abort.signal });
          turns++;
          yield castMessage({
            type: 'result',
            subtype: 'success',
            is_error: false,
            result:
              'Practice fixture: inspect the stream, change the next-response model, and close q when finished. A turn result does not automatically end a streaming-input session.',
            total_cost_usd: turns * 0.001,
            usage: { input_tokens: 120, output_tokens: 45 },
            modelUsage: {
              [model]: {
                inputTokens: 120 * turns,
                outputTokens: 45 * turns,
                costUSD: turns * 0.001,
              },
            },
          });
        }
      } catch (error) {
        if (!abort.signal.aborted) throw error;
      }
    },
    close() {
      input.close();
      abort.abort();
    },
    async setModel(value) {
      model = value || 'fixture-model';
    },
    async setMcpServers(servers) {
      const next = Object.hasOwn(servers, 'course');
      const before = attached;
      attached = next;
      return {
        added: next && !before ? ['course'] : [],
        removed: before && !next ? ['course'] : [],
        errors: {},
      };
    },
    async mcpServerStatus() {
      return attached
        ? [
            {
              name: 'course',
              status: 'connected',
              tools: [{ name: 'lifecycle_note', description: 'Fixture course note.' }],
            },
          ]
        : [];
    },
    async supportedAgents() {
      return [{ name: 'lifecycle-guide', description: 'Fixture agent discovery; no agent runs.' }];
    },
    async reloadPlugins() {
      return { commands: [], agents: [], plugins: [], mcpServers: [], error_count: 0, held: false };
    },
    async getContextUsage() {
      return {
        totalTokens: 860 + turns * 165,
        maxTokens: 200000,
        percentage: (860 + turns * 165) / 2000,
        categories: [{ id: 'messages', name: 'Messages', tokens: turns * 165, kind: 'used' }],
        model,
      } as Awaited<ReturnType<QueryPort['getContextUsage']>>;
    },
  };
  return {
    handle,
    send: (prompt) => input.push(prompt),
    async dispose() {
      input.close();
      abort.abort();
    },
  };
}
