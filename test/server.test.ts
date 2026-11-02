import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createApiHandler, type AppOptions } from '../src/server/app.js';
import { createPracticeRuntime } from '../src/server/practice.js';
import type { Snapshot } from '../src/shared/lesson.js';
async function host(options: AppOptions = {}) {
  const app = createApiHandler({ liveAvailable: false, ...options });
  const server = createServer((req, res) => {
    void app(req, res).then((handled) => {
      if (!handled) {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    post: (path: string, input: unknown, headers: Record<string, string> = {}) =>
      fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(input),
      }),
    async close() {
      await app.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
test('metadata states the pinned API correction and does not expose secrets', async () => {
  const h = await host();
  try {
    const r = await fetch(h.base + '/api/meta');
    const data = await r.json();
    assert.equal(data.version, '0.3.310');
    assert.equal(data.liveAvailable, false);
    assert.match(data.usageCorrection, /no getUsage/);
    assert.ok(!JSON.stringify(data).includes('sk-ant-'));
  } finally {
    await h.close();
  }
});
test('HTTP creation, commands, inspection and close share one session ID', async () => {
  const h = await host({ runtimeFactory: () => createPracticeRuntime(1) });
  try {
    const created = await h.post('/api/session', { mode: 'practice' });
    assert.equal(created.status, 201);
    const initial = (await created.json()) as Snapshot;
    await delay(10);
    const sent = await h.post('/api/command', {
      id: initial.id,
      command: 'send',
      value: 'Explain a retained query handle.',
    });
    assert.equal(sent.status, 200);
    await delay(50);
    const state = (await (
      await fetch(h.base + `/api/session?id=${initial.id}`)
    ).json()) as Snapshot;
    assert.equal(state.id, initial.id);
    assert.equal(state.turnCount, 1);
    assert.equal(state.closeCount, 0);
    assert.equal(state.status, 'ready');
    const closed = await (
      await h.post('/api/command', { id: initial.id, command: 'close' })
    ).json();
    assert.equal(closed.status, 'closed');
    assert.equal(closed.closeCount, 1);
  } finally {
    await h.close();
  }
});
test('new sessions dispose the previous handle and invalidate its ID', async () => {
  let closed = 0;
  const h = await host({
    runtimeFactory: () => {
      const r = createPracticeRuntime(1);
      const close = r.handle.close;
      r.handle.close = () => {
        closed++;
        close();
      };
      return r;
    },
  });
  try {
    const first = await (await h.post('/api/session', { mode: 'practice' })).json();
    const second = await (await h.post('/api/session', { mode: 'practice' })).json();
    assert.notEqual(first.id, second.id);
    assert.equal(closed, 1);
    assert.equal((await fetch(h.base + `/api/session?id=${first.id}`)).status, 404);
  } finally {
    await h.close();
  }
  assert.equal(closed, 2);
});
test('missing credentials do not run live mode or silently substitute practice', async () => {
  let calls = 0;
  const h = await host({
    runtimeFactory: () => {
      calls++;
      return createPracticeRuntime(1);
    },
  });
  try {
    const response = await h.post('/api/session', { mode: 'live' });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /API_KEY/);
    assert.equal(calls, 0);
  } finally {
    await h.close();
  }
});
test('request boundaries reject cross-origin, non-JSON, invalid modes, commands and oversized bodies', async () => {
  const h = await host();
  try {
    assert.equal(
      (await h.post('/api/session', { mode: 'practice' }, { Origin: 'https://example.com' }))
        .status,
      403,
    );
    assert.equal((await h.post('/api/session', {}, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await h.post('/api/session', { mode: 'unknown' })).status, 400);
    assert.equal(
      (await h.post('/api/session', { mode: 'practice', extra: 'x'.repeat(9000) })).status,
      400,
    );
    assert.equal(
      (
        await fetch(h.base + '/api/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{',
        })
      ).status,
      400,
    );
    const first = await (await h.post('/api/session', { mode: 'practice' })).json();
    assert.equal((await h.post('/api/command', { id: first.id, command: 'invented' })).status, 400);
    assert.equal((await h.post('/api/command', { id: 'other', command: 'close' })).status, 404);
    assert.equal(
      (await h.post('/api/command', { id: first.id, command: 'send', value: 42 })).status,
      400,
    );
  } finally {
    await h.close();
  }
});
test('session expiry closes an idle handle', async () => {
  const h = await host({ sessionMs: 15 });
  try {
    const session = await (await h.post('/api/session', { mode: 'practice' })).json();
    await delay(40);
    const state = await (await fetch(h.base + `/api/session?id=${session.id}`)).json();
    assert.equal(state.status, 'closed');
    assert.equal(state.closeCount, 1);
  } finally {
    await h.close();
  }
});
test('a stalled control times out and closes the handle', async () => {
  const h = await host({
    controlMs: 15,
    runtimeFactory: () => {
      const r = createPracticeRuntime(1);
      r.handle.supportedAgents = () => new Promise(() => {});
      return r;
    },
  });
  try {
    const session = await (await h.post('/api/session', { mode: 'practice' })).json();
    await delay(10);
    const response = await h.post('/api/command', { id: session.id, command: 'agents' });
    assert.equal(response.status, 504);
    await delay(5);
    const state = await (await fetch(h.base + `/api/session?id=${session.id}`)).json();
    assert.equal(state.status, 'error');
    assert.equal(state.closeCount, 1);
  } finally {
    await h.close();
  }
});
