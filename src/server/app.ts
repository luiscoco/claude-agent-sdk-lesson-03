import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Command, Mode } from '../shared/lesson.js';
import { METHODS, VERSION } from '../shared/lesson.js';
import { Session, SessionError } from './session.js';
import { createLiveRuntime } from './live.js';
import { createPracticeRuntime } from './practice.js';
import type { Runtime } from './port.js';
export function json(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(data));
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 8192) throw new SessionError('Use a JSON object no larger than 8 KB.', 400);
    chunks.push(Buffer.from(chunk));
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new SessionError('Provide a JSON object.', 400);
  }
}
const COMMANDS: Command[] = [
  'send',
  'mcp-status',
  'agents',
  'attach-mcp',
  'detach-mcp',
  'set-model',
  'reload-plugins',
  'context',
  'usage',
  'close',
];
export interface AppOptions {
  liveAvailable?: boolean;
  runtimeFactory?: (mode: Mode) => Runtime;
  sessionMs?: number;
  controlMs?: number;
}
export function createApiHandler(options: AppOptions = {}) {
  let session: Session | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let creating = false;
  const available = () => options.liveAvailable ?? Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  async function dispose() {
    clearTimeout(expiry);
    await session?.close();
  }
  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith('/api/')) return false;
    try {
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.host ?? ''))
        throw new SessionError('Use the local application URL.', 403);
      if (request.method === 'GET' && url.pathname === '/api/meta') {
        json(response, 200, {
          version: VERSION,
          liveAvailable: available(),
          methods: METHODS,
          usageCorrection:
            'SDK 0.3.310 has no getUsage(). Read usage, modelUsage and total_cost_usd from the latest result. getContextUsage() is a separate context-window inspection.',
        });
        return true;
      }
      if (request.method === 'GET' && url.pathname === '/api/session') {
        if (!session || url.searchParams.get('id') !== session.state.id)
          throw new SessionError('Session not found. Create a handle.', 404);
        json(response, 200, session.snapshot());
        return true;
      }
      if (request.method !== 'POST' || !['/api/session', '/api/command'].includes(url.pathname))
        throw new SessionError('Unknown API endpoint.', 404);
      if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)
        throw new SessionError('Cross-origin requests are not allowed.', 403);
      if (!request.headers['content-type']?.startsWith('application/json'))
        throw new SessionError('Send application/json.', 415);
      const input = await body(request);
      if (url.pathname === '/api/session') {
        if (input.mode !== 'practice' && input.mode !== 'live')
          throw new SessionError('Choose practice or live mode.', 400);
        if (input.mode === 'live' && !available())
          throw new SessionError(
            'Live mode requires your server-side ANTHROPIC_API_KEY. Practice mode needs no key.',
            409,
          );
        if (creating) throw new SessionError('A handle is being created.');
        creating = true;
        try {
          await dispose();
          const runtime = options.runtimeFactory
            ? options.runtimeFactory(input.mode)
            : input.mode === 'practice'
              ? createPracticeRuntime()
              : createLiveRuntime();
          session = new Session(runtime, input.mode);
          const owned = session;
          expiry = setTimeout(() => {
            void owned.close();
          }, options.sessionMs ?? 600000);
          expiry.unref();
          json(response, 201, session.snapshot());
        } finally {
          creating = false;
        }
        return true;
      }
      if (!session || input.id !== session.state.id)
        throw new SessionError('Session not found. Create a handle.', 404);
      if (!COMMANDS.includes(input.command as Command))
        throw new SessionError('Unknown command.', 400);
      if (input.value !== undefined && typeof input.value !== 'string')
        throw new SessionError('Command value must be text.', 400);
      const owned = session;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          owned.command(input.command as Command, input.value as string | undefined),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              void owned.close('error');
              reject(new SessionError('Runtime control timed out; the handle is closing.', 504));
            }, options.controlMs ?? 15000);
          }),
        ]);
        json(response, 200, result);
      } finally {
        clearTimeout(timer);
      }
      return true;
    } catch (error) {
      json(response, error instanceof SessionError ? error.status : 500, {
        error:
          error instanceof SessionError
            ? error.message
            : 'The host could not complete this request. Inspect the session log.',
      });
      return true;
    }
  };
  return Object.assign(handler, { dispose });
}
