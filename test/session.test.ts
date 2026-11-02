import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/server/session.js';
import { createPracticeRuntime } from '../src/server/practice.js';
import { waitFor } from './helpers.js';
test('one retained handle survives two turn results; cumulative snapshots are replaced', async () => {
  const session = new Session(createPracticeRuntime(1), 'practice');
  try {
    await waitFor(session);
    const id = session.state.id;
    for (let i = 1; i <= 2; i++) {
      await session.command('send', 'Explain the retained query handle.');
      await waitFor(session);
      assert.equal(session.state.turnCount, i);
      assert.equal(session.state.usage?.costUsd, i * 0.001);
      assert.equal(session.state.closeCount, 0);
      assert.equal(session.state.id, id);
    }
    assert.equal(session.state.status, 'ready');
    assert.equal(session.state.messageCount, 7);
    assert.equal(session.state.usage?.inputTokens, 120); // per-turn, not incorrectly accumulated
  } finally {
    await session.close();
  }
  assert.equal(session.state.closeCount, 1);
});
test('close is idempotent and prevents subsequent commands', async () => {
  const runtime = createPracticeRuntime(1);
  let closes = 0,
    disposals = 0;
  const oldClose = runtime.handle.close;
  runtime.handle.close = () => {
    closes++;
    oldClose();
  };
  const oldDispose = runtime.dispose;
  runtime.dispose = async () => {
    disposals++;
    await oldDispose();
  };
  const session = new Session(runtime, 'practice');
  await waitFor(session);
  await Promise.all([session.close(), session.close(), session.close()]);
  assert.equal(closes, 1);
  assert.equal(disposals, 1);
  assert.equal(session.state.closeCount, 1);
  await assert.rejects(session.command('send', 'A new user turn after close.'), /closed/);
});
test('closing an in-flight turn suppresses a late result and releases the reader', async () => {
  const session = new Session(createPracticeRuntime(100), 'practice');
  await waitFor(session);
  await session.command('send', 'Explain a long running query.');
  await session.close();
  await session.consumed;
  assert.equal(session.state.status, 'closed');
  assert.equal(session.state.turnCount, 0);
  assert.equal(session.state.lastResult, null);
});
test('controls run on the same handle; MCP health is separate from permission', async () => {
  const session = new Session(createPracticeRuntime(1), 'practice');
  try {
    await waitFor(session);
    await session.command('attach-mcp');
    assert.equal(session.state.mcpAttached, true);
    await session.command('mcp-status');
    const event = session.state.events.at(-1)!;
    assert.match(event.detail, /separate from permission/);
    assert.deepEqual(
      (event.data as { name: string }[]).map((s) => s.name),
      ['course'],
    );
    await session.command('detach-mcp');
    assert.equal(session.state.mcpAttached, false);
    await session.command('agents');
    await session.command('context');
    await session.command('reload-plugins');
    assert.equal(session.state.turnCount, 0);
    assert.equal(session.state.closeCount, 0);
  } finally {
    await session.close();
  }
});
test('model changes apply between turns without replacing the handle', async () => {
  const session = new Session(createPracticeRuntime(1), 'practice');
  try {
    await waitFor(session);
    const id = session.state.id;
    await session.command('set-model', 'student-fixture-v2');
    await session.command('send', 'Explain the next response model.');
    await waitFor(session);
    assert.equal(session.state.id, id);
    assert.equal(session.state.model, 'student-fixture-v2');
    assert.ok(Object.hasOwn(session.state.usage!.modelUsage as object, 'student-fixture-v2'));
  } finally {
    await session.close();
  }
});
test('unsafe or empty model identifiers and short prompts do not start work', async () => {
  const session = new Session(createPracticeRuntime(1), 'practice');
  try {
    await waitFor(session);
    await assert.rejects(session.command('set-model', '<script>'), /model identifier/);
    await assert.rejects(session.command('send', 'short'), /prompt/);
    assert.equal(session.state.status, 'ready');
    assert.equal(session.state.turnCount, 0);
  } finally {
    await session.close();
  }
});
test('a second send or model mutation is rejected while a turn is running', async () => {
  const session = new Session(createPracticeRuntime(50), 'practice');
  try {
    await waitFor(session);
    await session.command('send', 'Explain active query controls.');
    await assert.rejects(
      session.command('send', 'This should not queue twice.'),
      /Wait for the turn/,
    );
    await assert.rejects(session.command('set-model', 'another-model'), /Wait for the turn/);
    await session.command('agents');
  } finally {
    await session.close();
  }
});
test('unexpected stream failure closes the query once and redacts a credential-shaped message', async () => {
  const runtime = createPracticeRuntime(1);
  runtime.handle[Symbol.asyncIterator] = async function* () {
    throw new Error('Failure sk-ant-test_credential1234567890');
  };
  const session = new Session(runtime, 'practice');
  await session.consumed;
  assert.equal(session.state.status, 'error');
  assert.equal(session.state.closeCount, 1);
  assert.ok(!JSON.stringify(session.snapshot()).includes('sk-ant-'));
  assert.match(JSON.stringify(session.snapshot()), /redacted/);
});
test('an abrupt stream end during a turn is not treated as a successful result', async () => {
  const runtime = createPracticeRuntime(1);
  let finish!: () => void;
  runtime.handle[Symbol.asyncIterator] = async function* () {
    yield { type: 'system', subtype: 'init' } as never;
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  };
  const session = new Session(runtime, 'practice');
  await waitFor(session);
  await session.command('send', 'Explain the message stream.');
  finish();
  await session.consumed;
  assert.equal(session.state.status, 'error');
  assert.equal(session.state.turnCount, 0);
  assert.equal(session.state.closeCount, 1);
});
test('a failed runtime control leaves the handle inspectable and records the failure', async () => {
  const runtime = createPracticeRuntime(1);
  runtime.handle.setModel = async () => {
    throw new Error('Provider rejected model');
  };
  const session = new Session(runtime, 'practice');
  try {
    await waitFor(session);
    await assert.rejects(session.command('set-model', 'unavailable-model'), /control failed/);
    assert.equal(session.state.status, 'ready');
    assert.equal(session.state.pendingControl, false);
    assert.equal(session.state.model, 'fixture-model');
    assert.match(session.state.events.at(-1)!.detail, /Provider rejected/);
  } finally {
    await session.close();
  }
});
test('a held plugin reload is reported without forcing a second reload', async () => {
  const runtime = createPracticeRuntime(1);
  let calls = 0;
  runtime.handle.reloadPlugins = async (options) => {
    calls++;
    assert.equal(options?.holdOnCacheImpact, true);
    return { commands: [], agents: [], plugins: [], mcpServers: [], error_count: 0, held: true };
  };
  const session = new Session(runtime, 'practice');
  try {
    await waitFor(session);
    await session.command('reload-plugins');
    assert.equal(calls, 1);
    assert.match(session.state.events.at(-1)!.detail, /held/);
  } finally {
    await session.close();
  }
});
test('turn timeout closes the handle and does not manufacture usage', async () => {
  const session = new Session(createPracticeRuntime(100), 'practice', 10);
  await waitFor(session);
  await session.command('send', 'Explain a slow runtime turn.');
  await waitFor(session, () => session.state.status === 'error');
  await session.close();
  assert.equal(session.state.closeCount, 1);
  assert.equal(session.state.usage, null);
});
test('snapshots cannot mutate server state', async () => {
  const session = new Session(createPracticeRuntime(1), 'practice');
  try {
    await waitFor(session);
    const snapshot = session.snapshot();
    snapshot.events.length = 0;
    snapshot.status = 'closed';
    assert.ok(session.state.events.length > 0);
    assert.equal(session.state.status, 'ready');
  } finally {
    await session.close();
  }
});
