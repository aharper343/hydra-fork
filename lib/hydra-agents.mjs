#!/usr/bin/env node
/**
 * Hydra Agent Registry
 *
 * Single source of truth for agent metadata: CLI commands, flags, context limits,
 * strengths, roles, and task affinities. All other Hydra modules import from here.
 */

import os from 'os';
import path from 'path';

export const AGENTS = {
  claude: {
    label: 'Claude Code (Opus 4.6)',
    cli: 'claude',
    invoke: {
      nonInteractive: (prompt) => ['claude', ['-p', prompt, '--output-format', 'json', '--permission-mode', 'plan']],
      interactive: (prompt) => ['claude', [prompt]],
    },
    contextBudget: 180_000,
    contextTier: 'medium',
    strengths: ['architecture', 'planning', 'complex-reasoning', 'code-review', 'safety', 'ambiguity-resolution'],
    weaknesses: ['speed-on-simple-tasks'],
    councilRole: 'architect',
    taskAffinity: {
      planning: 0.95,
      architecture: 0.95,
      review: 0.85,
      refactor: 0.80,
      implementation: 0.60,
      analysis: 0.75,
      testing: 0.50,
    },
    rolePrompt:
      'You are the lead architect. Break down ambiguous requirements, design the approach, sequence work across agents, and make final decisions on trade-offs. You have full codebase access — use it to verify assumptions before delegating.',
    timeout: 7 * 60 * 1000,
  },
  gemini: {
    label: 'Gemini 2.5 Pro',
    cli: 'gemini',
    invoke: {
      nonInteractive: (prompt) => ['gemini', ['-p', prompt, '--approval-mode', 'plan', '-o', 'json']],
      interactive: (prompt) => ['gemini', ['--prompt-interactive', prompt]],
    },
    contextBudget: 900_000,
    contextTier: 'large',
    strengths: ['large-context-analysis', 'pattern-recognition', 'inconsistency-detection', 'speed', 'critique'],
    weaknesses: ['structured-output-reliability', 'hallucination-risk', 'complex-multi-step'],
    councilRole: 'analyst',
    taskAffinity: {
      planning: 0.50,
      architecture: 0.55,
      review: 0.90,
      refactor: 0.60,
      implementation: 0.55,
      analysis: 0.95,
      testing: 0.60,
    },
    rolePrompt:
      'You are the analyst and critic. Leverage your large context window to review broad swaths of code. Find inconsistencies, missed edge cases, regression risks, and pattern violations. Be specific — cite file paths and line numbers.',
    timeout: 5 * 60 * 1000,
  },
  codex: {
    label: 'Codex 5.3',
    cli: 'codex',
    invoke: {
      nonInteractive: (prompt, opts = {}) => {
        if (!opts.cwd) {
          throw new Error('Codex invoke requires opts.cwd (project root path)');
        }
        const outPath = opts.outputPath || path.join(os.tmpdir(), `hydra_codex_${Date.now()}.md`);
        return ['codex', ['exec', prompt, '-s', 'read-only', ...(outPath ? ['-o', outPath] : []), '-C', opts.cwd]];
      },
      interactive: (prompt) => ['codex', [prompt]],
    },
    contextBudget: 120_000,
    contextTier: 'minimal',
    strengths: ['fast-implementation', 'instruction-following', 'focused-coding', 'test-writing', 'sandboxed-safety'],
    weaknesses: ['no-network', 'ambiguity-handling', 'architecture', 'planning'],
    councilRole: 'implementer',
    taskAffinity: {
      planning: 0.20,
      architecture: 0.15,
      review: 0.40,
      refactor: 0.70,
      implementation: 0.95,
      analysis: 0.30,
      testing: 0.85,
    },
    rolePrompt:
      'You are the implementation specialist. You receive precise task specs with exact file paths, function signatures, and definitions of done. Execute the implementation efficiently. Do not redesign — follow the spec. Report exactly what you changed.',
    timeout: 7 * 60 * 1000,
  },
};

export const AGENT_NAMES = Object.keys(AGENTS);
export const KNOWN_OWNERS = new Set([...AGENT_NAMES, 'human', 'unassigned']);
export const TASK_TYPES = ['planning', 'architecture', 'review', 'refactor', 'implementation', 'analysis', 'testing'];

export function getAgent(name) {
  return AGENTS[name] || null;
}

export function bestAgentFor(taskType) {
  return AGENT_NAMES.reduce((best, name) =>
    (AGENTS[name].taskAffinity[taskType] || 0) > (AGENTS[best].taskAffinity[taskType] || 0) ? name : best
  );
}

export function classifyTask(title, notes = '') {
  const text = `${title} ${notes}`.toLowerCase();
  if (/plan|design|architect|break.?down|decide|strategy/.test(text)) return 'planning';
  if (/review|audit|check|verify|validate|inspect/.test(text)) return 'review';
  if (/refactor|rename|extract|consolidate|reorganize/.test(text)) return 'refactor';
  if (/test|spec|coverage|assert/.test(text)) return 'testing';
  if (/analyze|investigate|find|search|identify|scan/.test(text)) return 'analysis';
  if (/architect|schema|migration|structure/.test(text)) return 'architecture';
  return 'implementation';
}
