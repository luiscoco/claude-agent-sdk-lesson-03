import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import type { Session } from '../src/server/session.js';
export async function waitFor(
  session: Session,
  predicate: () => boolean = () => session.state.status === 'ready',
) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await delay(5);
  }
  assert.fail(`Timed out in ${session.state.status}`);
}
