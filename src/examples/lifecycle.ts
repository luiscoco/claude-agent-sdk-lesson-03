import { Session } from '../server/session.js';
import { createPracticeRuntime } from '../server/practice.js';
const session = new Session(createPracticeRuntime(10), 'practice');
const ready = async () => {
  for (let n = 0; n < 200; n++) {
    if (session.state.status === 'ready') return;
    if (session.state.status === 'error') throw new Error('Session failed.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out.');
};
try {
  await ready();
  await session.command('send', 'Explain why a host retains a query handle.');
  await ready();
  await session.command('agents');
  await session.command('attach-mcp');
  await session.command('mcp-status');
  await session.command('context');
  await session.command('usage');
} finally {
  await session.close();
}
console.log('SCRIPTED PRACTICE ADAPTER — no SDK process or model request.');
console.log(JSON.stringify(session.snapshot(), null, 2));
