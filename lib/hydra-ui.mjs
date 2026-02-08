/**
 * Hydra Terminal UI - Shared visual components for the Hydra orchestration system.
 *
 * Provides branded ASCII art, agent-colored output, spinners, box drawing,
 * and dashboard rendering. All functions are pure (no side effects except spinners).
 *
 * Dependency: picocolors (zero-dep, auto-strips ANSI in non-TTY)
 */

import pc from 'picocolors';

// ─── Agent Colors ───────────────────────────────────────────────────────────

const AGENT_COLORS = {
  claude: pc.magenta,
  gemini: pc.cyan,
  codex: pc.green,
  human: pc.yellow,
  system: pc.blue,
};

const AGENT_ICONS = {
  claude: '\u2666',   // ♦
  gemini: '\u2726',   // ✦
  codex: '\u25B6',    // ▶
  human: '\u25C6',    // ◆
  system: '\u2699',   // ⚙
};

// ─── Status Colors ──────────────────────────────────────────────────────────

const STATUS_COLORS = {
  todo: pc.white,
  in_progress: pc.yellow,
  blocked: pc.red,
  done: pc.green,
  cancelled: pc.gray,
};

const STATUS_ICONS = {
  todo: '\u25CB',       // ○
  in_progress: '\u25D4', // ◔
  blocked: '\u2717',    // ✗
  done: '\u2713',       // ✓
  cancelled: '\u2500',  // ─
};

// ─── Semantic Colors ────────────────────────────────────────────────────────

export const ACCENT = pc.magenta;
export const DIM = pc.gray;
export const HIGHLIGHT = pc.bold;
export const ERROR = pc.red;
export const SUCCESS = pc.green;
export const WARNING = pc.yellow;

// ─── ASCII Logo ─────────────────────────────────────────────────────────────

export function hydraSplash() {
  const m = pc.magenta;
  const c = pc.cyan;
  const g = pc.green;
  const d = pc.gray;
  const b = pc.bold;

  return [
    '',
    `    ${m('\\\\')}\\ ${c('|')} ${g('//')}`,
    `     ${m('\\\\')}${c('|')}${g('//')}`,
    `    ${m('_')}${d('\\\\|//')}${g('_')}`,
    `   ${d('|')}  ${b(pc.white('\\|/'))}  ${d('|')}`,
    `   ${d('|')}  ${ACCENT('/|\\\\')}  ${d('|')}`,
    `   ${d('\\\\_')}${ACCENT('/ | \\\\')}${d('_/')}`,
    `     ${ACCENT('|   |')}`,
    `     ${ACCENT('|___|')}`,
    '',
    `  ${b(ACCENT('H Y D R A'))}  ${d('Multi-Agent Orchestrator')}`,
    '',
  ].join('\n');
}

export function hydraLogoCompact() {
  return `${pc.bold(ACCENT('HYDRA'))} ${DIM('|')} ${DIM('Multi-Agent Orchestrator')}`;
}

// ─── Agent Formatting ───────────────────────────────────────────────────────

export function colorAgent(name) {
  const lower = String(name || '').toLowerCase();
  const colorFn = AGENT_COLORS[lower] || pc.white;
  return colorFn(name);
}

export function agentBadge(name) {
  const lower = String(name || '').toLowerCase();
  const icon = AGENT_ICONS[lower] || '\u2022'; // •
  const colorFn = AGENT_COLORS[lower] || pc.white;
  return colorFn(`${icon} ${String(name).toUpperCase()}`);
}

// ─── Status Formatting ─────────────────────────────────────────────────────

export function colorStatus(status) {
  const lower = String(status || '').toLowerCase();
  const colorFn = STATUS_COLORS[lower] || pc.white;
  const icon = STATUS_ICONS[lower] || '\u2022';
  return colorFn(`${icon} ${status}`);
}

// ─── Task Formatting ────────────────────────────────────────────────────────

export function formatTaskLine(task) {
  if (!task) return '';
  const id = pc.bold(pc.white(task.id || '???'));
  const status = colorStatus(task.status || 'todo');
  const owner = colorAgent(task.owner || 'unassigned');
  const title = DIM(String(task.title || '').slice(0, 60));
  return `  ${id} ${status}  ${owner}  ${title}`;
}

export function formatHandoffLine(handoff) {
  if (!handoff) return '';
  const id = pc.bold(pc.white(handoff.id || '???'));
  const from = colorAgent(handoff.from || '?');
  const to = colorAgent(handoff.to || '?');
  const arrow = DIM('\u2192'); // →
  const ack = handoff.acknowledgedAt
    ? SUCCESS('\u2713 ack')
    : WARNING('pending');
  const summary = DIM(String(handoff.summary || '').slice(0, 50));
  return `  ${id} ${from} ${arrow} ${to}  ${ack}  ${summary}`;
}

// ─── Time Formatting ────────────────────────────────────────────────────────

export function relativeTime(iso) {
  if (!iso) return DIM('never');
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return DIM('future');
  const secs = Math.floor(diff / 1000);
  if (secs < 10) return DIM('just now');
  if (secs < 60) return DIM(`${secs}s ago`);
  const mins = Math.floor(secs / 60);
  if (mins < 60) return DIM(`${mins}m ago`);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return DIM(`${hours}h ago`);
  const days = Math.floor(hours / 24);
  return DIM(`${days}d ago`);
}

// ─── Layout Helpers ─────────────────────────────────────────────────────────

export function box(title, lines, width = 60) {
  const inner = Math.max(width - 2, 10);
  const titleStr = title ? ` ${title} ` : '';
  const topPad = inner - titleStr.length - 1;
  const top = `\u250C${titleStr}${'─'.repeat(Math.max(topPad, 0))}\u2510`;
  const bot = `\u2514${'─'.repeat(inner)}\u2518`;
  const body = (lines || []).map((line) => {
    // Strip ANSI for length calculation
    const stripped = stripAnsi(line);
    const pad = Math.max(inner - stripped.length, 0);
    return `\u2502${line}${' '.repeat(pad)}\u2502`;
  });
  return [top, ...body, bot].join('\n');
}

export function sectionHeader(title) {
  const bar = '─'.repeat(Math.max(50 - title.length, 4));
  return `\n${DIM('───')} ${HIGHLIGHT(title)} ${DIM(bar)}`;
}

export function divider() {
  return DIM('─'.repeat(56));
}

export function label(key, value) {
  const k = DIM(`${key}:`);
  return `  ${k} ${value}`;
}

// ─── Spinner ────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['\u2801', '\u2803', '\u2807', '\u280F', '\u281F', '\u283F', '\u287F', '\u28FF', '\u28FE', '\u28FC', '\u28F8', '\u28F0', '\u28E0', '\u28C0', '\u2880', '\u2800'];

export function createSpinner(message) {
  const isTTY = process.stderr?.isTTY;
  let frameIdx = 0;
  let interval = null;
  let currentMsg = message;

  function render() {
    if (!isTTY) return;
    const frame = ACCENT(SPINNER_FRAMES[frameIdx % SPINNER_FRAMES.length]);
    process.stderr.write(`\r${frame} ${currentMsg}`);
    frameIdx++;
  }

  function clearLine() {
    if (!isTTY) return;
    process.stderr.write('\r' + ' '.repeat(currentMsg.length + 4) + '\r');
  }

  return {
    start() {
      if (!isTTY) {
        process.stderr.write(`  ${DIM('\u2026')} ${currentMsg}\n`);
        return this;
      }
      interval = setInterval(render, 80);
      render();
      return this;
    },
    update(msg) {
      currentMsg = msg;
      return this;
    },
    succeed(msg) {
      clearLine();
      if (interval) clearInterval(interval);
      interval = null;
      process.stderr.write(`  ${SUCCESS('\u2713')} ${msg || currentMsg}\n`);
      return this;
    },
    fail(msg) {
      clearLine();
      if (interval) clearInterval(interval);
      interval = null;
      process.stderr.write(`  ${ERROR('\u2717')} ${msg || currentMsg}\n`);
      return this;
    },
    stop() {
      clearLine();
      if (interval) clearInterval(interval);
      interval = null;
      return this;
    },
  };
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

export function renderDashboard(summary, agentNextMap) {
  const lines = [];
  lines.push(hydraLogoCompact());
  lines.push(divider());

  // Session
  const session = summary?.activeSession;
  if (session) {
    lines.push(sectionHeader('Session'));
    lines.push(label('Focus', pc.white(session.focus || 'not set')));
    lines.push(label('Branch', pc.white(session.branch || '?')));
    lines.push(label('Status', colorStatus(session.status || 'active')));
    lines.push(label('Updated', relativeTime(summary.updatedAt)));
  }

  // Counts
  const counts = summary?.counts || {};
  lines.push(sectionHeader('Overview'));
  lines.push(label('Open tasks', counts.tasksOpen ?? '?'));
  lines.push(label('Open blockers', counts.blockersOpen > 0 ? ERROR(String(counts.blockersOpen)) : SUCCESS('0')));
  lines.push(label('Decisions', String(counts.decisions ?? '?')));
  lines.push(label('Handoffs', String(counts.handoffs ?? '?')));

  // Agent Status
  if (agentNextMap && Object.keys(agentNextMap).length > 0) {
    lines.push(sectionHeader('Agents'));
    for (const [agent, next] of Object.entries(agentNextMap)) {
      const action = next?.action || 'unknown';
      let desc = action;
      if (action === 'continue_task') {
        desc = `working on ${pc.bold(next.task?.id || '?')}`;
      } else if (action === 'pickup_handoff') {
        desc = WARNING(`handoff ${next.handoff?.id || '?'} waiting`);
      } else if (action === 'claim_owned_task' || action === 'claim_unassigned_task') {
        desc = `can claim ${pc.bold(next.task?.id || '?')}`;
      } else if (action === 'idle') {
        desc = DIM('idle');
      } else if (action === 'resolve_blocker') {
        desc = ERROR(`blocked on ${next.task?.id || '?'}`);
      }
      lines.push(`  ${agentBadge(agent)}  ${desc}`);
    }
  }

  // Open Tasks
  const tasks = summary?.openTasks || [];
  if (tasks.length > 0) {
    lines.push(sectionHeader('Open Tasks'));
    for (const task of tasks.slice(0, 10)) {
      lines.push(formatTaskLine(task));
    }
    if (tasks.length > 10) {
      lines.push(DIM(`  ... and ${tasks.length - 10} more`));
    }
  }

  // Open Blockers
  const blockers = summary?.openBlockers || [];
  if (blockers.length > 0) {
    lines.push(sectionHeader('Blockers'));
    for (const b of blockers) {
      lines.push(`  ${ERROR('\u2717')} ${pc.bold(b.id)} ${colorAgent(b.owner)} ${DIM(String(b.title || '').slice(0, 50))}`);
    }
  }

  // Latest Handoff
  const handoff = summary?.latestHandoff;
  if (handoff) {
    lines.push(sectionHeader('Latest Handoff'));
    lines.push(formatHandoffLine(handoff));
  }

  lines.push('');
  return lines.join('\n');
}

// ─── Agent Header ───────────────────────────────────────────────────────────

export function agentHeader(name) {
  const lower = String(name || '').toLowerCase();
  const colorFn = AGENT_COLORS[lower] || pc.white;
  const agentConfig = {
    claude: { tagline: 'Architect \u00B7 Planner \u00B7 Coordinator', icon: '\u2666' },
    gemini: { tagline: 'Analyst \u00B7 Critic \u00B7 Reviewer', icon: '\u2726' },
    codex: { tagline: 'Implementer \u00B7 Builder \u00B7 Executor', icon: '\u25B6' },
  };
  const cfg = agentConfig[lower] || { tagline: 'Agent', icon: '\u2022' };
  const lines = [
    '',
    colorFn(`  ${cfg.icon} ${String(name).toUpperCase()}`),
    DIM(`  ${cfg.tagline}`),
    colorFn('─'.repeat(42)),
    '',
  ];
  return lines.join('\n');
}

// ─── Utility: Strip ANSI ────────────────────────────────────────────────────

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return String(str || '').replace(/\x1B\[[0-9;]*m/g, '');
}
