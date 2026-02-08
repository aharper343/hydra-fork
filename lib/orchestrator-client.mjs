#!/usr/bin/env node
/**
 * CLI client for the local orchestrator daemon.
 */

import {
  parseArgsWithCommand,
  getOption,
  requireOption,
  parseList,
  request,
} from './hydra-utils.mjs';
import {
  hydraLogoCompact,
  renderDashboard,
  label,
  agentBadge,
  relativeTime,
  sectionHeader,
  divider,
  SUCCESS,
  ERROR,
  WARNING,
  DIM,
  ACCENT,
} from './hydra-ui.mjs';
import pc from 'picocolors';

const DEFAULT_URL = process.env.AI_ORCH_URL || 'http://127.0.0.1:4173';

function print(data) {
  console.log(JSON.stringify(data, null, 2));
}

function printHelp() {
  console.log('');
  console.log(hydraLogoCompact());
  console.log(DIM('  CLI client for the Hydra orchestrator daemon'));
  console.log('');
  console.log(`${pc.bold('Usage:')}  node orchestrator-client.mjs <command> [key=value]`);
  console.log('');
  console.log(pc.bold('Commands:'));
  console.log(`  ${ACCENT('status')}              Show daemon health`);
  console.log(`  ${ACCENT('summary')}             Dashboard with tasks, agents, handoffs`);
  console.log(`  ${ACCENT('state')}               Raw sync state JSON`);
  console.log(`  ${ACCENT('next')} agent=NAME      Suggested next action for agent`);
  console.log(`  ${ACCENT('prompt')} agent=NAME    Context prompt for agent`);
  console.log(`  ${ACCENT('session:start')} ...    Start a coordination session`);
  console.log(`  ${ACCENT('task:add')} title=...   Add a task`);
  console.log(`  ${ACCENT('task:route')} taskId=   Route task to best agent`);
  console.log(`  ${ACCENT('claim')} agent=...      Claim a task`);
  console.log(`  ${ACCENT('task:update')} ...      Update task status/notes`);
  console.log(`  ${ACCENT('decision:add')} ...     Record a decision`);
  console.log(`  ${ACCENT('blocker:add')} ...      Record a blocker`);
  console.log(`  ${ACCENT('handoff')} ...          Create agent handoff`);
  console.log(`  ${ACCENT('handoff:ack')} ...      Acknowledge a handoff`);
  console.log(`  ${ACCENT('events')} [limit=50]    Recent daemon events`);
  console.log(`  ${ACCENT('verify')} taskId=...    Run tsc verification`);
  console.log(`  ${ACCENT('archive')}              Archive completed items`);
  console.log(`  ${ACCENT('archive:status')}       Show archive stats`);
  console.log(`  ${ACCENT('stop')}                 Stop the daemon`);
  console.log('');
  console.log(DIM('  Add json=true to any command for raw JSON output'));
  console.log('');
}

async function main() {
  const { command, options } = parseArgsWithCommand(process.argv);
  const baseUrl = getOption(options, 'url', DEFAULT_URL);
  const jsonMode = getOption(options, 'json', 'false') === 'true';

  try {
    switch (command) {
      case 'help':
      case '--help':
      case '-h':
        printHelp();
        return;
      case 'status': {
        const data = await request('GET', baseUrl, '/health');
        if (jsonMode) { print(data); return; }
        console.log('');
        console.log(hydraLogoCompact());
        console.log(label('Status', data.running ? SUCCESS('running') : ERROR('stopped')));
        console.log(label('PID', pc.white(String(data.pid || '?'))));
        console.log(label('Uptime', pc.white(`${data.uptimeSec || 0}s`)));
        console.log(label('Project', pc.white(String(data.project || '?'))));
        console.log(label('Events', pc.white(String(data.eventsRecorded || 0))));
        console.log(label('Last event', relativeTime(data.lastEventAt)));
        console.log(label('State updated', relativeTime(data.stateUpdatedAt)));
        console.log('');
        return;
      }
      case 'summary': {
        const data = await request('GET', baseUrl, '/summary');
        if (jsonMode) { print(data); return; }
        const agentNextMap = {};
        for (const agent of ['claude', 'gemini', 'codex']) {
          try {
            const nextData = await request('GET', baseUrl, `/next?agent=${encodeURIComponent(agent)}`);
            agentNextMap[agent] = nextData.next;
          } catch { agentNextMap[agent] = { action: 'unknown' }; }
        }
        console.log('');
        console.log(renderDashboard(data.summary, agentNextMap));
        return;
      }
      case 'state':
        print(await request('GET', baseUrl, '/state'));
        return;
      case 'next': {
        const agent = requireOption(options, 'agent');
        const data = await request('GET', baseUrl, `/next?agent=${encodeURIComponent(agent)}`);
        if (jsonMode) { print(data); return; }
        const next = data.next;
        console.log('');
        console.log(`  ${agentBadge(agent)}  ${pc.white(next.action)}`);
        console.log(label('Message', next.message || 'n/a'));
        if (next.task) {
          console.log(label('Task', `${pc.bold(next.task.id)} ${DIM(next.task.title || '')}`));
        }
        if (next.handoff) {
          console.log(label('Handoff', `${pc.bold(next.handoff.id)} from ${next.handoff.from}`));
        }
        console.log('');
        return;
      }
      case 'prompt': {
        const agent = requireOption(options, 'agent');
        print(await request('GET', baseUrl, `/prompt?agent=${encodeURIComponent(agent)}`));
        return;
      }
      case 'session:start': {
        const focus = requireOption(options, 'focus', 'Example: focus="Fix onboarding deadlock"');
        const payload = {
          focus,
          owner: getOption(options, 'owner', 'human'),
          participants: parseList(getOption(options, 'participants', 'human,codex,claude,gemini')),
          branch: getOption(options, 'branch', ''),
        };
        print(await request('POST', baseUrl, '/session/start', payload));
        return;
      }
      case 'task:add': {
        const payload = {
          title: requireOption(options, 'title'),
          owner: getOption(options, 'owner', 'unassigned'),
          status: getOption(options, 'status', 'todo'),
          type: getOption(options, 'type', ''),
          files: parseList(getOption(options, 'files', '')),
          notes: getOption(options, 'notes', ''),
          blockedBy: parseList(getOption(options, 'blockedBy', '')),
        };
        print(await request('POST', baseUrl, '/task/add', payload));
        return;
      }
      case 'task:route': {
        const payload = {
          taskId: requireOption(options, 'taskId'),
        };
        print(await request('POST', baseUrl, '/task/route', payload));
        return;
      }
      case 'claim': {
        const payload = {
          agent: requireOption(options, 'agent'),
          taskId: getOption(options, 'taskId', ''),
          title: getOption(options, 'title', ''),
          files: parseList(getOption(options, 'files', '')),
          notes: getOption(options, 'notes', ''),
        };
        print(await request('POST', baseUrl, '/task/claim', payload));
        return;
      }
      case 'task:update': {
        const payload = {
          taskId: requireOption(options, 'taskId'),
        };
        if (options.status !== undefined) {
          payload.status = getOption(options, 'status');
        }
        if (options.owner !== undefined) {
          payload.owner = getOption(options, 'owner');
        }
        if (options.notes !== undefined) {
          payload.notes = getOption(options, 'notes');
        }
        if (options.files !== undefined) {
          payload.files = parseList(getOption(options, 'files'));
        }
        if (options.title !== undefined) {
          payload.title = getOption(options, 'title');
        }
        if (options.blockedBy !== undefined) {
          payload.blockedBy = parseList(getOption(options, 'blockedBy'));
        }

        print(await request('POST', baseUrl, '/task/update', payload));
        return;
      }
      case 'decision:add': {
        const payload = {
          title: requireOption(options, 'title'),
          owner: getOption(options, 'owner', 'human'),
          rationale: getOption(options, 'rationale', ''),
          impact: getOption(options, 'impact', ''),
        };
        print(await request('POST', baseUrl, '/decision', payload));
        return;
      }
      case 'blocker:add': {
        const payload = {
          title: requireOption(options, 'title'),
          owner: getOption(options, 'owner', 'human'),
          nextStep: getOption(options, 'nextStep', ''),
        };
        print(await request('POST', baseUrl, '/blocker', payload));
        return;
      }
      case 'handoff': {
        const payload = {
          from: requireOption(options, 'from'),
          to: requireOption(options, 'to'),
          summary: requireOption(options, 'summary'),
          nextStep: getOption(options, 'nextStep', ''),
          tasks: parseList(getOption(options, 'tasks', '')),
        };
        print(await request('POST', baseUrl, '/handoff', payload));
        return;
      }
      case 'handoff:ack': {
        const payload = {
          handoffId: requireOption(options, 'handoffId'),
          agent: requireOption(options, 'agent'),
        };
        print(await request('POST', baseUrl, '/handoff/ack', payload));
        return;
      }
      case 'events': {
        const limit = Number.parseInt(getOption(options, 'limit', '50'), 10);
        print(await request('GET', baseUrl, `/events?limit=${Number.isFinite(limit) ? limit : 50}`));
        return;
      }
      case 'verify': {
        const payload = {
          taskId: requireOption(options, 'taskId'),
        };
        print(await request('POST', baseUrl, '/verify', payload));
        return;
      }
      case 'archive':
        print(await request('POST', baseUrl, '/state/archive', {}));
        return;
      case 'archive:status':
        print(await request('GET', baseUrl, '/state/archive'));
        return;
      case 'stop':
        print(await request('POST', baseUrl, '/shutdown', {}));
        return;
      default:
        throw new Error(`Unknown command "${command}". Run with "help".`);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
