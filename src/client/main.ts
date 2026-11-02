import './style.css';
import './course-theme.css';
import './course-theme.js';
import { QUIZ, type Command, type Metadata, type Snapshot } from '../shared/lesson.js';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let state: Snapshot | undefined;
let pending = false;
let pollPending = false;
let generation = 0;
const commandButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-command]')];
const text = (id: string, value: string) => {
  $(id).textContent = value;
};
function notice(message = '') {
  text('notice', message);
  $('notice').hidden = !message;
}
async function api<T>(path: string, input?: unknown): Promise<T> {
  const response = await fetch(
    path,
    input === undefined
      ? { cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result as T;
}
function enabled() {
  const active = state && ['ready', 'running'].includes(state.status);
  const busy = pending || Boolean(state?.pendingControl);
  $('create').toggleAttribute('disabled', pending);
  for (const id of ['send', 'set-model'])
    $(id).toggleAttribute('disabled', !active || busy || state?.status === 'running');
  for (const button of commandButtons)
    button.disabled =
      !active ||
      busy ||
      (state?.status === 'running' &&
        !['mcp-status', 'agents', 'usage'].includes(button.dataset.command!));
  $('close').toggleAttribute('disabled', !state || ['closed', 'error'].includes(state.status));
  $('export').toggleAttribute('disabled', !state);
}
function render(next: Snapshot) {
  state = next;
  text('status', next.status);
  $('status').dataset.status = next.status;
  text('handle-id', `q · ${next.id.slice(0, 8)} · ${next.mode}`);
  text('model-current', `Model: ${next.model}`);
  text('messages', String(next.messageCount));
  text('turns', String(next.turnCount));
  text('closes', String(next.closeCount));
  text(
    'result',
    next.lastResult ||
      (next.status === 'running'
        ? 'Waiting for a turn result…'
        : next.status === 'closed'
          ? 'The handle is closed. Create another session to continue.'
          : 'The retained handle is ready for input.'),
  );
  text(
    'result-note',
    next.lastTurnOk === false
      ? 'The SDK reported a failed turn. Inspect its result before continuing.'
      : 'A result finishes a turn. The streaming-input session can stay open until close().',
  );
  text(
    'mode-label',
    next.mode === 'practice' ? 'Practice mode · scripted adapter' : 'Live mode · real SDK query',
  );
  text(
    'mode-explanation',
    next.mode === 'practice'
      ? 'No Claude process or API call runs. Events, usage, and control responses are teaching fixtures.'
      : 'Controls target the retained SDK query. Sending turns makes billable model requests with your server-side key.',
  );
  text('mode-tag', next.mode === 'practice' ? 'FIXTURE DATA' : 'REAL MODEL CHARGES');
  for (const element of document.querySelectorAll<HTMLElement>('[data-stage]'))
    element.classList.toggle(
      'active',
      element.dataset.stage ===
        (['closed', 'error'].includes(next.status)
          ? 'close'
          : next.status === 'running'
            ? 'observe'
            : next.events.some((e) => e.category === 'control')
              ? 'control'
              : 'create'),
    );
  const log = $('events');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  const previous = log.dataset.sequence;
  const latest = next.events.at(-1)?.sequence;
  if (previous !== String(latest)) {
    log.replaceChildren();
    for (const event of next.events) {
      const entry = document.createElement('article');
      entry.className = `event ${event.category}`;
      const heading = document.createElement('div');
      heading.className = 'event-heading';
      const title = document.createElement('b');
      title.textContent = event.title;
      const time = document.createElement('time');
      time.textContent = new Date(event.time).toLocaleTimeString();
      heading.append(title, time);
      const detail = document.createElement('p');
      detail.textContent = event.detail;
      entry.append(heading, detail);
      if (event.data !== undefined) {
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = 'Selected fields';
        const pre = document.createElement('pre');
        pre.textContent = JSON.stringify(event.data, null, 2);
        details.append(summary, pre);
        entry.append(details);
      }
      log.append(entry);
    }
    log.dataset.sequence = String(latest);
    if (atBottom) log.scrollTop = log.scrollHeight;
  }
  if (next.usage) {
    text('cost', `$${next.usage.costUsd.toFixed(4)}`);
    text('tokens', `${next.usage.inputTokens} in / ${next.usage.outputTokens} out`);
    text('usage-json', JSON.stringify(next.usage, null, 2));
    text('usage-label', next.mode === 'practice' ? 'FICTIONAL VALUES' : 'ESTIMATED USAGE');
  } else {
    text('cost', '—');
    text('tokens', '—');
    text('usage-json', 'No result yet.');
    text('usage-label', 'Awaiting a result');
  }
  enabled();
}
async function refresh() {
  if (!state || pollPending || ['closed', 'error'].includes(state.status)) return;
  pollPending = true;
  const id = state.id;
  const ownGeneration = generation;
  try {
    const next = await api<Snapshot>(`/api/session?id=${encodeURIComponent(id)}`);
    if (state?.id === id && generation === ownGeneration) render(next);
  } catch (error) {
    if (state?.id === id && generation === ownGeneration) notice((error as Error).message);
  } finally {
    pollPending = false;
  }
}
$('create').addEventListener('click', async () => {
  pending = true;
  generation++;
  enabled();
  notice();
  try {
    render(await api<Snapshot>('/api/session', { mode: $<HTMLSelectElement>('mode').value }));
  } catch (error) {
    notice((error as Error).message);
  } finally {
    pending = false;
    enabled();
  }
});
async function command(command: Command, value?: string) {
  if (!state || (pending && command !== 'close')) return;
  const id = state.id;
  const ownGeneration = ++generation;
  pending = true;
  enabled();
  notice();
  try {
    const next = await api<Snapshot>('/api/command', {
      id,
      command,
      ...(value === undefined ? {} : { value }),
    });
    if (state?.id === id && generation === ownGeneration) render(next);
  } catch (error) {
    if (generation === ownGeneration) notice((error as Error).message);
  } finally {
    if (generation === ownGeneration) {
      pending = false;
      enabled();
      void refresh();
    }
  }
}
$('send').addEventListener(
  'click',
  () => void command('send', $<HTMLTextAreaElement>('prompt').value),
);
$('close').addEventListener('click', () => void command('close'));
$('set-model').addEventListener(
  'click',
  () => void command('set-model', $<HTMLInputElement>('model').value),
);
for (const button of commandButtons)
  button.addEventListener('click', () => void command(button.dataset.command as Command));
$('export').addEventListener('click', () => {
  if (!state) return;
  const url = URL.createObjectURL(
    new Blob([JSON.stringify({ fixtureData: state.mode === 'practice', ...state }, null, 2)], {
      type: 'application/json',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'lesson-03-query-lifecycle.json';
  link.click();
  URL.revokeObjectURL(url);
});
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      $(item.getAttribute('aria-controls')!).hidden = !selected;
    }
  });
  tab.addEventListener('keydown', (event) => {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : null;
    if (next !== null) {
      event.preventDefault();
      tabs[next]!.click();
      tabs[next]!.focus();
    }
  });
});
QUIZ.forEach((item, index) => {
  const field = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = `${index + 1}. ${item.question}`;
  field.append(legend);
  item.answers.forEach((answer, choice) => {
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = `q${index}`;
    radio.value = String(choice);
    radio.required = true;
    label.append(radio, document.createTextNode(answer));
    field.append(label);
  });
  $('questions').append(field);
});
$('quiz-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData($<HTMLFormElement>('quiz-form'));
  const score = QUIZ.filter((item, index) => Number(data.get(`q${index}`)) === item.correct).length;
  text(
    'quiz-score',
    `${score} / ${QUIZ.length} correct${score === QUIZ.length ? ' · You understand the lifecycle.' : ' · Revisit the runtime guide and try again.'}`,
  );
});
void api<Metadata>('/api/meta')
  .then((meta) => {
    text(
      'live-note',
      meta.liveAvailable
        ? 'Live mode is available. Your API key stays on the server.'
        : 'Practice is ready. Live requires ANTHROPIC_API_KEY in the server .env file and a restart.',
    );
    $<HTMLSelectElement>('mode').options[1]!.disabled = !meta.liveAvailable;
    text('usage-correction', meta.usageCorrection);
    for (const method of meta.methods) {
      const card = document.createElement('article');
      card.className = 'panel method-card';
      const kind = document.createElement('small');
      kind.textContent = method.kind;
      const title = document.createElement('h3');
      title.textContent = method.name;
      const detail = document.createElement('p');
      detail.textContent = method.purpose;
      card.append(kind, title, detail);
      $('method-cards').append(card);
    }
  })
  .catch((error) => notice(error.message));
const interval = setInterval(() => {
  if (!pending) void refresh();
}, 500);
window.addEventListener('pagehide', () => {
  clearInterval(interval);
  if (state && !['closed', 'error'].includes(state.status))
    navigator.sendBeacon(
      '/api/command',
      new Blob([JSON.stringify({ id: state.id, command: 'close' })], { type: 'application/json' }),
    );
});
