#!/usr/bin/env node
/**
 * Hydra Operator Console (hydra:go)
 *
 * One-terminal command center for dispatching prompts to Claude/Gemini/Codex.
 * Dispatch is recorded as Hydra handoffs so each agent can pull with hydra:next.
 * Supports modes: auto (mini-round triage), handoff (direct), council (full deliberation).
 *
 * Usage:
 *   node hydra-operator.mjs prompt="Investigate auth deadlock"
 *   node hydra-operator.mjs              # interactive mode
 *   node hydra-operator.mjs mode=dispatch prompt="..."  # dispatch pipeline
 */

import readline from 'readline';
import path from 'path';
import { spawnSync } from 'child_process';
import { getProjectContext } from './hydra-context.mjs';
import { getAgent, AGENT_NAMES } from './hydra-agents.mjs';
import { resolveProject, HYDRA_ROOT } from './hydra-config.mjs';
import {
  parseArgs,
  getPrompt,
  parseList,
  boolFlag,
  short,
  request,
  normalizeTask,
} from './hydra-utils.mjs';
import {
  hydraLogoCompact,
  renderDashboard,
  agentBadge,
  label,
  sectionHeader,
  divider,
  colorAgent,
  SUCCESS,
  ERROR,
  WARNING,
  DIM,
  ACCENT,
} from './hydra-ui.mjs';
import pc from 'picocolors';

const config = resolveProject();
const DEFAULT_URL = process.env.AI_ORCH_URL || 'http://127.0.0.1:4173';

function buildAgentMessage(agent, userPrompt) {
  const agentConfig = getAgent(agent);
  const rolePrompt = agentConfig ? agentConfig.rolePrompt : 'Contribute effectively to this objective.';
  const agentLabel = agentConfig ? agentConfig.label : agent.toUpperCase();

  return [
    `Hydra dispatch for ${agentLabel}:`,
    `Primary objective: ${userPrompt}`,
    '',
    rolePrompt,
    '',
    agent === 'codex' ? 'You will receive precise task specs. Execute efficiently and report what you changed.' : '',
    agent === 'gemini' ? 'Cite specific file paths and line numbers in all findings.' : '',
    agent === 'claude' ? 'Create detailed task specs for Codex (file paths, signatures, DoD) in your handoffs.' : '',
    '',
    'If blocked or unclear, ask direct questions immediately.',
    'When done with current chunk, create a Hydra handoff with exact next step.',
    '',
    getProjectContext(agent, {}, config),
  ].filter(Boolean).join('\n');
}

function buildMiniRoundBrief(agent, userPrompt, report) {
  const agentConfig = getAgent(agent);
  const tasks = Array.isArray(report?.tasks) ? report.tasks.map(normalizeTask).filter(Boolean) : [];
  const questions = Array.isArray(report?.questions) ? report.questions : [];
  const consensus = String(report?.consensus || '').trim();

  const myTasks = tasks.filter((task) => task.owner === agent || task.owner === 'unassigned');
  const myQuestions = questions.filter((q) => q && (q.to === agent || q.to === 'human'));

  const taskText =
    myTasks.length === 0
      ? '- No explicit task assigned. Start by proposing first concrete step.'
      : myTasks
          .map((task) => `- ${task.title}${task.done ? ` (DoD: ${task.done})` : ''}${task.rationale ? ` [${task.rationale}]` : ''}`)
          .join('\n');

  const questionText =
    myQuestions.length === 0
      ? '- none'
      : myQuestions
          .map((q) => {
            const to = String(q.to || 'human');
            const question = String(q.question || '').trim();
            return question ? `- to ${to}: ${question}` : null;
          })
          .filter(Boolean)
          .join('\n');

  return [
    `Hydra mini-round delegation for ${agentConfig ? agentConfig.label : agent.toUpperCase()}.`,
    '',
    agentConfig ? agentConfig.rolePrompt : '',
    '',
    getProjectContext(agent, {}, config),
    '',
    `Objective: ${userPrompt}`,
    `Recommendation: ${report?.recommendedMode || 'handoff'} (${report?.recommendationRationale || 'n/a'})`,
    `Consensus: ${consensus || 'No explicit consensus text.'}`,
    'Assigned tasks:',
    taskText,
    'Open questions:',
    questionText,
    'Next step: execute first task and publish milestone/blocker via Hydra handoff.',
  ].filter(Boolean).join('\n');
}

async function publishMiniRoundDelegation({ baseUrl, from, agents, promptText, report }) {
  const normalizedTasks = (Array.isArray(report?.tasks) ? report.tasks : []).map(normalizeTask).filter(Boolean);
  const tasksToCreate =
    normalizedTasks.length > 0
      ? normalizedTasks
      : agents.map((agent) => ({
          owner: agent,
          title: `Execute ${agent} contribution for: ${short(promptText, 120)}`,
          done: '',
          rationale: 'Generated fallback task because mini-round had no explicit allocations.',
        }));

  const createdTasks = [];
  for (const task of tasksToCreate) {
    const created = await request('POST', baseUrl, '/task/add', {
      title: task.title,
      owner: task.owner,
      status: 'todo',
      notes: task.rationale ? `Mini-round rationale: ${task.rationale}` : '',
    });
    createdTasks.push(created.task);
  }

  const decision = await request('POST', baseUrl, '/decision', {
    title: `Hydra Mini Round: ${short(promptText, 90)}`,
    owner: from,
    rationale: short(report?.consensus || 'Mini-round completed without explicit consensus.', 600),
    impact: `recommended=${report?.recommendedMode || 'handoff'}; tasks=${createdTasks.length}`,
  });

  const handoffs = [];
  for (const agent of agents) {
    const agentTaskIds = createdTasks.filter((task) => task.owner === agent || task.owner === 'unassigned').map((task) => task.id);
    const summary = buildMiniRoundBrief(agent, promptText, report);
    const handoff = await request('POST', baseUrl, '/handoff', {
      from,
      to: agent,
      summary,
      nextStep: 'Acknowledge and execute top-priority delegated task.',
      tasks: agentTaskIds,
    });
    handoffs.push(handoff.handoff);
  }

  return {
    decision: decision.decision,
    tasks: createdTasks,
    handoffs,
  };
}

async function dispatchPrompt({ baseUrl, from, agents, promptText }) {
  const records = [];
  for (const agent of agents) {
    const summary = buildAgentMessage(agent, promptText);
    const payload = {
      from,
      to: agent,
      summary,
      nextStep: 'Start work and report first milestone via hydra:handoff.',
      tasks: [],
    };
    const result = await request('POST', baseUrl, '/handoff', payload);
    records.push({
      agent,
      handoffId: result?.handoff?.id || null,
      summary,
    });
  }
  return records;
}

function runCouncilPrompt({ baseUrl, promptText, rounds = 2, preview = false }) {
  const councilScript = path.join(HYDRA_ROOT, 'lib', 'hydra-council.mjs');
  const args = [councilScript, `prompt=${promptText}`, `url=${baseUrl}`, `rounds=${rounds}`];
  if (preview) {
    args.push('mode=preview', 'publish=false');
  } else {
    args.push('publish=true');
  }

  const result = spawnSync('node', args, {
    cwd: config.projectRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 8,
    windowsHide: true,
  });

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function runCouncilJson({ baseUrl, promptText, rounds = 1, preview = false, publish = false }) {
  const councilScript = path.join(HYDRA_ROOT, 'lib', 'hydra-council.mjs');
  const args = [
    councilScript,
    `prompt=${promptText}`,
    `url=${baseUrl}`,
    `rounds=${rounds}`,
    'emit=json',
    'save=false',
    `publish=${publish ? 'true' : 'false'}`,
  ];
  if (preview) {
    args.push('mode=preview', 'publish=false');
  }

  const result = spawnSync('node', args, {
    cwd: config.projectRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
    windowsHide: true,
  });

  if (result.status !== 0) {
    return {
      ok: false,
      status: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      report: null,
    };
  }

  try {
    const parsed = JSON.parse(result.stdout || '{}');
    return {
      ok: true,
      status: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      report: parsed.report || null,
    };
  } catch (error) {
    return {
      ok: false,
      status: result.status,
      stdout: result.stdout || '',
      stderr: `Failed to parse council JSON: ${error.message}`,
      report: null,
    };
  }
}

async function runAutoPrompt({ baseUrl, from, agents, promptText, miniRounds, councilRounds, preview }) {
  const triage = runCouncilJson({
    baseUrl,
    promptText,
    rounds: miniRounds,
    preview,
    publish: false,
  });

  if (!triage.ok || !triage.report) {
    throw new Error(triage.stderr || triage.stdout || `Mini-round exited with status ${triage.status}`);
  }

  const recommended = String(triage.report.recommendedMode || 'handoff').toLowerCase();
  if (preview) {
    return {
      mode: 'preview',
      recommended,
      triage: triage.report,
      published: null,
      escalatedToCouncil: recommended === 'council',
    };
  }

  if (recommended === 'council') {
    const council = runCouncilPrompt({
      baseUrl,
      promptText,
      rounds: councilRounds,
      preview: false,
    });
    if (!council.ok) {
      throw new Error(council.stderr || council.stdout || `Council exited with status ${council.status}`);
    }
    return {
      mode: 'council',
      recommended,
      triage: triage.report,
      published: null,
      escalatedToCouncil: true,
      councilOutput: council.stdout.trim(),
    };
  }

  const published = await publishMiniRoundDelegation({
    baseUrl,
    from,
    agents,
    promptText,
    report: triage.report,
  });

  return {
    mode: 'handoff',
    recommended,
    triage: triage.report,
    published,
    escalatedToCouncil: false,
  };
}

async function printStatus(baseUrl, agents) {
  const summary = await request('GET', baseUrl, '/summary');
  const agentNextMap = {};
  for (const agent of agents) {
    try {
      const next = await request('GET', baseUrl, `/next?agent=${encodeURIComponent(agent)}`);
      agentNextMap[agent] = next.next;
    } catch { agentNextMap[agent] = { action: 'unknown' }; }
  }
  console.log('');
  console.log(renderDashboard(summary.summary, agentNextMap));
}

function printHelp() {
  console.log('');
  console.log(hydraLogoCompact());
  console.log(DIM('  Operator Console'));
  console.log('');
  console.log(pc.bold('Interactive commands:'));
  console.log(`  ${ACCENT(':help')}                 Show help`);
  console.log(`  ${ACCENT(':status')}               Dashboard with agents & tasks`);
  console.log(`  ${ACCENT(':mode auto')}            Mini-round triage then delegate/escalate`);
  console.log(`  ${ACCENT(':mode handoff')}         Direct handoffs (fast, no triage)`);
  console.log(`  ${ACCENT(':mode council')}         Full council deliberation`);
  console.log(`  ${ACCENT(':mode dispatch')}        Headless pipeline (Claude\u2192Gemini\u2192Codex)`);
  console.log(`  ${ACCENT(':quit')}                 Exit operator console`);
  console.log(`  ${DIM('<any text>')}             Dispatch as shared prompt`);
  console.log('');
  console.log(pc.bold('One-shot mode:'));
  console.log(DIM('  npm run hydra:go -- prompt="Your objective"'));
  console.log(DIM('  npm run hydra:go -- mode=council prompt="Your objective"'));
  console.log('');
}

async function interactiveLoop({
  baseUrl,
  from,
  agents,
  initialMode,
  councilRounds,
  councilPreview,
  autoMiniRounds,
  autoCouncilRounds,
  autoPreview,
}) {
  let mode = initialMode;
  printHelp();
  console.log(label('Mode', ACCENT(mode)));
  console.log('');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${ACCENT('hydra')}${DIM('>')} `,
  });

  rl.prompt();

  rl.on('line', async (lineRaw) => {
    const line = String(lineRaw || '').trim();

    try {
      if (!line) {
        rl.prompt();
        return;
      }
      if (line === ':quit' || line === ':exit') {
        rl.close();
        return;
      }
      if (line === ':help') {
        printHelp();
        rl.prompt();
        return;
      }
      if (line === ':status') {
        await printStatus(baseUrl, agents);
        rl.prompt();
        return;
      }
      if (line.startsWith(':mode ')) {
        const nextMode = line.slice(':mode '.length).trim().toLowerCase();
        if (!['auto', 'handoff', 'council', 'dispatch'].includes(nextMode)) {
          console.log('Invalid mode. Use :mode auto, :mode handoff, :mode council, or :mode dispatch');
          rl.prompt();
          return;
        }
        mode = nextMode;
        console.log(label('Mode', ACCENT(mode)));
        rl.prompt();
        return;
      }

      if (mode === 'auto') {
        const auto = await runAutoPrompt({
          baseUrl,
          from,
          agents,
          promptText: line,
          miniRounds: autoMiniRounds,
          councilRounds: autoCouncilRounds,
          preview: autoPreview,
        });
        console.log(sectionHeader('Auto Triage'));
        console.log(label('Recommended', ACCENT(auto.recommended)));
        console.log(label('Rationale', DIM(auto.triage.recommendationRationale || 'n/a')));
        if (auto.escalatedToCouncil) {
          console.log(label('Route', WARNING('escalated to full council')));
          if (auto.councilOutput) {
            console.log(auto.councilOutput);
          }
        } else if (auto.published) {
          console.log(label('Route', SUCCESS('delegated via mini-round')));
          console.log(label('Tasks created', pc.white(String(auto.published.tasks.length))));
          console.log(label('Handoffs queued', pc.white(String(auto.published.handoffs.length))));
        } else {
          console.log(label('Route', DIM('preview only')));
        }
      } else if (mode === 'council') {
        const council = runCouncilPrompt({
          baseUrl,
          promptText: line,
          rounds: councilRounds,
          preview: councilPreview,
        });
        if (!council.ok) {
          throw new Error(council.stderr || council.stdout || `Council exited with status ${council.status}`);
        }
        console.log('\nCouncil completed:');
        console.log(council.stdout.trim());
      } else if (mode === 'dispatch') {
        console.log('Dispatch mode: run `npm run hydra:go -- mode=dispatch prompt="..."` for headless pipeline.');
      } else {
        const records = await dispatchPrompt({
          baseUrl,
          from,
          agents,
          promptText: line,
        });

        console.log(sectionHeader('Dispatched'));
        for (const item of records) {
          console.log(`  ${agentBadge(item.agent)}  ${DIM('handoff=')}${pc.bold(item.handoffId || '?')}`);
        }
        console.log('');
        console.log(DIM('  Pull commands:'));
        for (const agent of agents) {
          console.log(DIM(`    npm run hydra:next -- agent=${agent}`));
        }
      }
    } catch (error) {
      console.error(`Error: ${error.message}`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('Hydra operator console closed.');
    process.exit(0);
  });
}

async function main() {
  const { options, positionals } = parseArgs(process.argv);
  const baseUrl = String(options.url || DEFAULT_URL);
  const from = String(options.from || 'human').toLowerCase();
  const agents = parseList(options.agents || 'claude,gemini,codex');
  const mode = String(options.mode || 'auto').toLowerCase();
  const councilRounds = Math.max(1, Math.min(4, Number.parseInt(String(options.councilRounds || '2'), 10) || 2));
  const councilPreview = boolFlag(options.councilPreview, false);
  const autoMiniRounds = Math.max(1, Math.min(2, Number.parseInt(String(options.autoMiniRounds || '1'), 10) || 1));
  const autoCouncilRounds = Math.max(1, Math.min(4, Number.parseInt(String(options.autoCouncilRounds || String(councilRounds)), 10) || councilRounds));
  const autoPreview = boolFlag(options.autoPreview, false);
  const promptText = getPrompt(options, positionals);
  const interactive = !promptText;

  try {
    await request('GET', baseUrl, '/health');
  } catch (error) {
    console.error(`Hydra daemon unreachable at ${baseUrl}: ${error.message}`);
    console.error('Start daemon first: npm run hydra:start');
    process.exit(1);
  }

  if (interactive) {
    await interactiveLoop({
      baseUrl,
      from,
      agents,
      initialMode: mode,
      councilRounds,
      councilPreview,
      autoMiniRounds,
      autoCouncilRounds,
      autoPreview,
    });
    return;
  }

  if (mode === 'auto') {
    const auto = await runAutoPrompt({
      baseUrl,
      from,
      agents,
      promptText,
      miniRounds: autoMiniRounds,
      councilRounds: autoCouncilRounds,
      preview: autoPreview,
    });
    console.log(sectionHeader('Auto Triage Complete'));
    console.log(label('Recommended', ACCENT(auto.recommended)));
    console.log(label('Rationale', DIM(auto.triage.recommendationRationale || 'n/a')));
    if (auto.escalatedToCouncil) {
      console.log(label('Route', WARNING('council')));
    } else if (auto.published) {
      console.log(label('Route', SUCCESS('delegated')));
      console.log(label('Tasks created', pc.white(String(auto.published.tasks.length))));
      console.log(label('Handoffs queued', pc.white(String(auto.published.handoffs.length))));
    } else {
      console.log(label('Route', DIM('preview')));
    }
  } else if (mode === 'council') {
    const council = runCouncilPrompt({
      baseUrl,
      promptText,
      rounds: councilRounds,
      preview: councilPreview,
    });
    if (!council.ok) {
      throw new Error(council.stderr || council.stdout || `Council exited with status ${council.status}`);
    }
    console.log(council.stdout.trim());
  } else if (mode === 'dispatch') {
    // Headless dispatch pipeline: spawn hydra-dispatch.mjs
    const dispatchScript = path.join(HYDRA_ROOT, 'lib', 'hydra-dispatch.mjs');
    const args = [dispatchScript, `prompt=${promptText}`, `url=${baseUrl}`];
    if (boolFlag(options.preview, false)) {
      args.push('mode=preview');
    }
    const result = spawnSync('node', args, {
      cwd: config.projectRoot,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 8,
      windowsHide: true,
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      process.exit(result.status || 1);
    }
  } else {
    const records = await dispatchPrompt({
      baseUrl,
      from,
      agents,
      promptText,
    });

    console.log(sectionHeader('Dispatch Complete'));
    for (const item of records) {
      console.log(`  ${agentBadge(item.agent)}  ${DIM('handoff=')}${pc.bold(item.handoffId || '?')}`);
    }
    console.log('');
    console.log(DIM('  Pull commands:'));
    for (const agent of agents) {
      console.log(DIM(`    npm run hydra:next -- agent=${agent}`));
    }
  }
}

main().catch((error) => {
  console.error(`Hydra operator failed: ${error.message}`);
  process.exit(1);
});
