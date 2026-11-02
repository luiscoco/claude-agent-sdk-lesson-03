import { randomUUID } from 'node:crypto';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Command, Mode, Snapshot } from '../shared/lesson.js';
import type { Runtime } from './port.js';
import { createLessonServer } from './live.js';
export class SessionError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}
const object = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;
const redact = (text: string) => text.replace(/sk-ant-[\w-]+/g, '[redacted]').slice(0, 3000);
export class Session {
  readonly state: Snapshot;
  readonly consumed: Promise<void>;
  private sequence = 0;
  private hosted: ReturnType<typeof createLessonServer> | undefined;
  private turnTimer?: ReturnType<typeof setTimeout>;
  private closePromise?: Promise<void>;
  private finishing = false;
  constructor(
    readonly runtime: Runtime,
    mode: Mode,
    private turnTimeoutMs = 90000,
  ) {
    this.state = {
      id: randomUUID(),
      mode,
      status: 'starting',
      events: [],
      messageCount: 0,
      turnCount: 0,
      closeCount: 0,
      lastResult: null,
      lastTurnOk: null,
      usage: null,
      model: mode === 'practice' ? 'fixture-model' : process.env.ANTHROPIC_MODEL || 'SDK default',
      mcpAttached: false,
      pendingControl: false,
    };
    this.log(
      'host',
      'Handle retained',
      mode === 'practice'
        ? 'Scripted practice adapter. No SDK subprocess or model request runs.'
        : 'Real SDK query created with an open async input queue.',
    );
    this.consumed = this.consume();
  }
  snapshot(): Snapshot {
    return structuredClone(this.state);
  }
  private log(
    category: Snapshot['events'][number]['category'],
    title: string,
    detail: string,
    data?: unknown,
  ) {
    this.state.events.push({
      sequence: ++this.sequence,
      time: new Date().toISOString(),
      category,
      title,
      detail: redact(detail),
      ...(data === undefined ? {} : { data }),
    });
    if (this.state.events.length > 100) this.state.events.shift();
  }
  private async consume() {
    try {
      for await (const message of this.runtime.handle) {
        if (this.finishing) break;
        this.state.messageCount++;
        this.observe(message);
      }
      if (!this.finishing) {
        if (this.state.status === 'running') throw new Error('The stream ended before a result.');
        this.log(
          'host',
          'Stream ended',
          'The query stream finished; the host is releasing its resources.',
        );
        await this.close();
      }
    } catch (error) {
      if (!this.finishing) {
        this.log('error', 'Stream failed', error instanceof Error ? error.message : 'Stream error');
        await this.close('error');
      }
    }
  }
  private observe(message: SDKMessage) {
    if (message.type === 'result') {
      clearTimeout(this.turnTimer);
      this.state.turnCount++;
      this.state.lastTurnOk = message.subtype === 'success' && !message.is_error;
      this.state.lastResult = redact(
        message.subtype === 'success' ? message.result : message.errors.join('\n'),
      );
      this.state.usage = {
        costUsd: number(message.total_cost_usd),
        inputTokens: number(message.usage.input_tokens),
        outputTokens: number(message.usage.output_tokens),
        modelUsage: message.modelUsage,
        note: 'Latest snapshot: cost and modelUsage are cumulative estimates for this query. usage tokens describe this main-loop turn. Never sum cumulative snapshots. Practice values are fictional.',
      };
      this.state.status = 'ready';
      this.log('message', `result · ${message.subtype}`, this.state.lastResult, {
        type: 'result',
        subtype: message.subtype,
        is_error: message.is_error,
      });
    } else {
      const raw = message as unknown as Record<string, unknown>;
      const subtype = typeof raw.subtype === 'string' ? raw.subtype : '';
      if (message.type === 'system' && subtype === 'init') this.state.status = 'ready';
      const content = object(raw.message).content;
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .map((block) =>
                  object(block).type === 'text'
                    ? object(block).text
                    : `[${String(object(block).type)}]`,
                )
                .join('\n')
            : 'Typed runtime event observed.';
      this.log('message', `${message.type}${subtype ? ` · ${subtype}` : ''}`, String(text), {
        type: message.type,
        ...(subtype ? { subtype } : {}),
      });
    }
  }
  async command(command: Command, value?: string) {
    if (command === 'close') {
      await this.close();
      return this.snapshot();
    }
    if (this.finishing) throw new SessionError('This session is closed. Create a new handle.');
    if (this.state.status === 'starting') throw new SessionError('Wait for initialization.');
    if (this.state.pendingControl) throw new SessionError('A runtime control is already pending.');
    if (this.state.status === 'running' && !['mcp-status', 'agents', 'usage'].includes(command))
      throw new SessionError('Wait for the turn result or close the session.');
    this.state.pendingControl = true;
    try {
      switch (command) {
        case 'send': {
          if (!value || value.trim().length < 10 || value.length > 2000)
            throw new SessionError('Use a prompt between 10 and 2,000 characters.', 400);
          this.state.status = 'running';
          this.state.lastResult = null;
          this.state.lastTurnOk = null;
          this.turnTimer = setTimeout(() => {
            this.log(
              'error',
              'Turn timed out',
              'The host is closing this query after its turn timeout.',
            );
            void this.close('error');
          }, this.turnTimeoutMs);
          this.turnTimer.unref();
          this.runtime.send(value.trim());
          this.log('host', 'Input queued', 'The host supplied a turn to the retained query.');
          break;
        }
        case 'set-model': {
          if (!value || !/^[a-zA-Z0-9._:/-]{1,120}$/.test(value))
            throw new SessionError(
              'Enter a model identifier of 1–120 letters, numbers, or . _ : / -.',
              400,
            );
          await this.runtime.handle.setModel(value);
          if (this.finishing) break;
          this.state.model = value;
          this.log(
            'control',
            'setModel()',
            `Requested model for subsequent responses: ${value}. Runtime acceptance does not guarantee provider availability.`,
          );
          break;
        }
        case 'attach-mcp':
        case 'detach-mcp': {
          const attach = command === 'attach-mcp';
          if (attach && !this.hosted) this.hosted = createLessonServer();
          const result = await this.runtime.handle.setMcpServers(
            attach ? { course: this.hosted! } : {},
          );
          if (this.finishing) break;
          if (Object.keys(result.errors).length)
            throw new Error(
              'The MCP update reported connection errors. Inspect status before continuing.',
            );
          this.state.mcpAttached = attach;
          if (!attach) {
            await this.hosted?.instance.close();
            this.hosted = undefined;
          }
          this.log(
            'control',
            'setMcpServers()',
            'Changed this app’s dynamic MCP set. Plugin-owned and settings-defined servers follow separate rules.',
            { added: result.added, removed: result.removed, errors: result.errors },
          );
          break;
        }
        case 'mcp-status': {
          const servers = await this.runtime.handle.mcpServerStatus();
          this.log(
            'control',
            'mcpServerStatus()',
            'Connection health is separate from permission to execute a tool.',
            servers.map((s) => ({
              name: s.name,
              status: s.status,
              tools: s.tools?.map((t) => ({ name: t.name })),
            })),
          );
          break;
        }
        case 'agents': {
          const agents = await this.runtime.handle.supportedAgents();
          this.log(
            'control',
            'supportedAgents()',
            'Discovery only. This action does not launch subagents.',
            agents.map((a) => ({ name: a.name, description: a.description })),
          );
          break;
        }
        case 'reload-plugins': {
          const result = await this.runtime.handle.reloadPlugins({ holdOnCacheImpact: true });
          this.log(
            'control',
            'reloadPlugins()',
            result.held
              ? 'Reload was held because of cache impact; no forced reload was requested.'
              : 'The runtime returned its refreshed plugin inventory.',
            {
              held: result.held ?? false,
              plugins: result.plugins.map((p) => ({ name: p.name })),
              errorCount: result.error_count,
            },
          );
          break;
        }
        case 'context': {
          const context = await this.runtime.handle.getContextUsage({ detail: 'summary' });
          this.log(
            'control',
            'getContextUsage()',
            'Summary detail: last-response usage and local estimates. This is a context-window view, not billing.',
            {
              totalTokens: context.totalTokens,
              maxTokens: context.maxTokens,
              percentage: context.percentage,
              model: context.model,
              categories: context.categories.map((c) => ({
                name: c.name,
                tokens: c.tokens,
                kind: c.kind,
              })),
            },
          );
          break;
        }
        case 'usage':
          this.log(
            'control',
            'Latest result usage',
            'No getUsage() call: this SDK version exposes usage on result messages. Read the latest cumulative snapshot.',
            this.state.usage,
          );
          break;
        default:
          throw new SessionError('Unknown command.', 400);
      }
      return this.snapshot();
    } catch (error) {
      if (command === 'send') {
        clearTimeout(this.turnTimer);
        if (!this.finishing) this.state.status = 'ready';
      }
      this.log(
        'error',
        'Control rejected',
        error instanceof Error ? error.message : 'Runtime control failed.',
      );
      throw error instanceof SessionError
        ? error
        : new SessionError('The runtime control failed. Inspect the event log.', 502);
    } finally {
      this.state.pendingControl = false;
    }
  }
  close(status: 'closed' | 'error' = 'closed'): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.finishing = true;
    this.state.status = status;
    clearTimeout(this.turnTimer);
    this.state.closeCount++;
    this.closePromise = (async () => {
      try {
        this.runtime.handle.close();
      } catch (error) {
        this.log(
          'error',
          'close() failed',
          error instanceof Error ? error.message : 'Close failed',
        );
      } finally {
        await this.runtime
          .dispose()
          .catch(() =>
            this.log('error', 'Host disposal failed', 'A host resource could not be released.'),
          );
        await this.hosted?.instance.close().catch(() => {});
        this.log(
          'host',
          'close()',
          'Query close called once. Input, abort signal, turn timer, and host-owned MCP server disposed.',
        );
      }
    })();
    return this.closePromise;
  }
}
