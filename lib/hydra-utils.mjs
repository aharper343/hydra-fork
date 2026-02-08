#!/usr/bin/env node
/**
 * Hydra shared utilities.
 *
 * Consolidates duplicated helpers from hydra-council, hydra-operator, hydra-dispatch,
 * orchestrator-daemon, and orchestrator-client into one importable module.
 */

import fs from 'fs';
import { spawnSync } from 'child_process';
import { KNOWN_OWNERS } from './hydra-agents.mjs';

const ORCH_TOKEN = process.env.AI_ORCH_TOKEN || '';
const NETWORK_RETRY_COUNT = 4;
const NETWORK_RETRY_DELAY_MS = 300;
const DEFAULT_TIMEOUT_MS = 1000 * 60 * 7;

// --- Timestamp ---

export function nowIso() {
  return new Date().toISOString();
}

export function runId(prefix = 'HYDRA') {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${prefix}_${yyyy}${mm}${dd}_${hh}${min}${ss}`;
}

// --- CLI Argument Parsing ---

export function parseArgs(argv) {
  const options = {};
  const positionals = [];
  for (const token of argv.slice(2)) {
    if (token.includes('=')) {
      const [rawKey, ...rawValue] = token.split('=');
      const key = rawKey.trim();
      if (key) {
        options[key] = rawValue.join('=').trim();
      }
    } else {
      positionals.push(token);
    }
  }
  return { options, positionals };
}

export function parseArgsWithCommand(argv) {
  const [command = 'help', ...rest] = argv.slice(2);
  const options = {};
  const positionals = [];
  for (const token of rest) {
    if (token.includes('=')) {
      const [rawKey, ...rawValue] = token.split('=');
      const key = rawKey.trim();
      if (key) {
        options[key] = rawValue.join('=').trim();
      }
    } else {
      positionals.push(token);
    }
  }
  return { command, options, positionals };
}

export function getOption(options, key, fallback = '') {
  if (options[key] !== undefined) {
    return String(options[key]);
  }
  return fallback;
}

export function requireOption(options, key, help = '') {
  const value = getOption(options, key, '');
  if (!value) {
    const suffix = help ? `\n${help}` : '';
    throw new Error(`Missing required option "${key}".${suffix}`);
  }
  return value;
}

export function getPrompt(options, positionals) {
  if (options.prompt) {
    return String(options.prompt);
  }
  if (positionals.length > 0) {
    return positionals.join(' ');
  }
  return '';
}

export function boolFlag(value, fallback = false) {
  if (value === undefined || value === '') {
    return fallback;
  }
  const normalized = String(value).toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

export function parseList(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map((x) => String(x).trim()).filter(Boolean);
  }
  return String(value)
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// --- Text Helpers ---

export function short(text, max = 300) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) {
    return cleaned;
  }
  return `${cleaned.slice(0, max - 3)}...`;
}

// --- JSON Parsing ---

export function parseJsonLoose(text) {
  if (!text || !String(text).trim()) {
    return null;
  }
  const raw = String(text).trim();

  try {
    return JSON.parse(raw);
  } catch {
    // continue
  }

  const blockMatch = raw.match(/```json\s*([\s\S]*?)\s*```/i);
  if (blockMatch) {
    try {
      return JSON.parse(blockMatch[1]);
    } catch {
      // continue
    }
  }

  const objMatch = raw.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch {
      // continue
    }
  }

  return null;
}

// --- Process Execution ---

export function runProcess(command, args, timeoutMs = DEFAULT_TIMEOUT_MS, extraOpts = {}) {
  const spawnOpts = {
    cwd: extraOpts.cwd || process.cwd(),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 8,
    windowsHide: true,
    shell: process.platform === 'win32',
  };
  // Allow callers to pipe data to stdin (used for long prompts on Windows)
  if (extraOpts.input !== undefined) {
    spawnOpts.input = extraOpts.input;
  }
  const result = spawnSync(command, args, spawnOpts);

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';

  if (result.error) {
    return {
      ok: false,
      exitCode: result.status,
      stdout,
      stderr,
      error: result.error.message,
      timedOut: Boolean(result.signal === 'SIGTERM'),
    };
  }

  return {
    ok: result.status === 0,
    exitCode: result.status,
    stdout,
    stderr,
    error: '',
    timedOut: Boolean(result.signal === 'SIGTERM'),
  };
}

// --- HTTP Client (with retry) ---

export async function request(method, baseUrl, route, body = null) {
  const headers = {
    Accept: 'application/json',
  };
  if (ORCH_TOKEN) {
    headers['x-ai-orch-token'] = ORCH_TOKEN;
  }
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
  }

  let response;
  let lastNetworkError = null;

  for (let attempt = 1; attempt <= NETWORK_RETRY_COUNT; attempt += 1) {
    try {
      response = await fetch(`${baseUrl}${route}`, {
        method,
        headers,
        body: body === null ? undefined : JSON.stringify(body),
      });
      lastNetworkError = null;
      break;
    } catch (error) {
      lastNetworkError = error;
      if (attempt >= NETWORK_RETRY_COUNT) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, NETWORK_RETRY_DELAY_MS * attempt));
    }
  }

  if (lastNetworkError) {
    throw new Error(
      `Unable to reach Hydra daemon at ${baseUrl}. Start it with "npm run hydra:start" or set url=http://127.0.0.1:4173.`
    );
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }

  return payload;
}

// --- Filesystem ---

export function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// --- Task Normalization ---

export function sanitizeOwner(owner) {
  const candidate = String(owner || '').toLowerCase();
  if (KNOWN_OWNERS.has(candidate)) {
    return candidate;
  }
  return 'unassigned';
}

export function normalizeTask(item, fallbackOwner = 'unassigned') {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const title = String(item.title || item.task || '').trim();
  if (!title) {
    return null;
  }
  const owner = sanitizeOwner(item.owner || fallbackOwner);
  const done = String(item.definition_of_done || item.done || item.acceptance || '').trim();
  const rationale = String(item.rationale || item.why || '').trim();
  return { owner, title, done, rationale };
}

export function dedupeTasks(tasks) {
  const out = [];
  const seen = new Set();
  for (const task of tasks) {
    if (!task) {
      continue;
    }
    const key = `${task.owner}::${String(task.title || '').toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(task);
  }
  return out;
}
