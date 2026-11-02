import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { createLiveRuntime } from '../src/server/live.js';
import { createPracticeRuntime } from '../src/server/practice.js';
import { InputQueue } from '../src/server/input.js';
test('live adapter supplies streaming input, scoped capabilities and explicit limits', async () => {
  let captured!: Parameters<typeof query>[0];
  const fake = createPracticeRuntime(1);
  const runtime = createLiveRuntime((input) => {
    captured = input;
    return fake.handle;
  });
  assert.equal(typeof captured.prompt, 'object');
  assert.deepEqual(captured.options?.tools, []);
  assert.deepEqual(captured.options?.settingSources, []);
  assert.equal(captured.options?.persistSession, false);
  assert.equal(captured.options?.permissionMode, 'dontAsk');
  assert.equal(captured.options?.maxBudgetUsd, 0.25);
  assert.equal(captured.options?.maxTurns, 4);
  assert.deepEqual(captured.options?.allowedTools, ['mcp__course__lifecycle_note']);
  const reader = (captured.prompt as AsyncIterable<SDKUserMessage>)[Symbol.asyncIterator]();
  runtime.send('Explain cleanup.');
  const message = await reader.next();
  assert.equal(message.value?.message.content, 'Explain cleanup.');
  assert.ok(message.value?.uuid);
  await runtime.dispose();
  assert.equal((await reader.next()).done, true);
  assert.equal(captured.options?.abortController?.signal.aborted, true);
  await runtime.dispose();
});
test('input queue preserves order and close releases a waiting consumer', async () => {
  const queue = new InputQueue<string>();
  const reader = queue[Symbol.asyncIterator]();
  queue.push('first');
  queue.push('second');
  assert.equal((await reader.next()).value, 'first');
  assert.equal((await reader.next()).value, 'second');
  const waiting = reader.next();
  queue.close();
  assert.equal((await waiting).done, true);
  assert.throws(() => queue.push('late'), /closed/);
});
test('iterator return closes input and discards queued turns', async () => {
  const queue = new InputQueue<string>();
  queue.push('unused');
  const iterator = queue[Symbol.asyncIterator]();
  await iterator.return!();
  assert.equal((await iterator.next()).done, true);
});
test('a synchronous SDK startup failure propagates without a fixture fallback', () => {
  assert.throws(
    () =>
      createLiveRuntime(() => {
        throw new Error('SDK startup failed');
      }),
    /SDK startup failed/,
  );
});
