import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/server/session.js';
import { createPracticeRuntime } from '../src/server/practice.js';
import { waitFor } from './helpers.js';
test('handshake readiness permits first input before any system/init stream event', async () => {
  const runtime = createPracticeRuntime(1);
  let emitInit!: () => void;
  runtime.ready = Promise.resolve();
  runtime.handle[Symbol.asyncIterator] = async function* () {
    await new Promise<void>((resolve) => {
      emitInit = resolve;
    });
    yield { type: 'system', subtype: 'init' } as never;
    await new Promise<void>(() => {});
  };
  const session = new Session(runtime, 'live');
  try {
    await waitFor(session);
    await session.command('send', 'Explain the initialization handshake.');
    emitInit();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(session.state.status, 'running');
    assert.equal(session.state.turnCount, 0);
  } finally {
    await session.close();
  }
});
test('failed initialization closes the handle and is visible to the host', async () => {
  const runtime = createPracticeRuntime(1);
  runtime.ready = Promise.reject(new Error('Handshake failed'));
  const session = new Session(runtime, 'live');
  await waitFor(session, () => session.state.status === 'error');
  await session.close();
  assert.equal(session.state.closeCount, 1);
  assert.ok(session.state.events.some((e) => e.title === 'Initialization failed'));
});
