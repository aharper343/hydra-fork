# Architecture

## Module Dependency Graph

```
hydra-config.mjs ──────────────────────────────┐
       │                                        │
       v                                        v
hydra-agents.mjs ──> hydra-metrics.mjs    hydra-usage.mjs
       │                    │                   │
       v                    v                   │
hydra-utils.mjs <───────────┘                   │
       │                                        │
       ├──────────┬──────────┐                  │
       v          v          v                  │
hydra-dispatch  hydra-council  hydra-operator <─┘
       │          │          │
       v          v          v
hydra-context.mjs   hydra-ui.mjs
                         │
                         v
                    picocolors

orchestrator-daemon.mjs ──> hydra-agents, hydra-ui, hydra-config,
                            hydra-metrics, hydra-usage

orchestrator-client.mjs ──> hydra-utils, hydra-ui, hydra-agents,
                            hydra-usage
```

## Data Flow

### Prompt Dispatch (Auto Mode)

```
User prompt
     │
     v
[Operator] ──> mini-round triage (1 fast council round)
     │
     ├── recommendation=handoff ──> create daemon handoffs for each agent
     │                                    │
     │                              [Agent Heads] poll /next, pick up handoffs
     │
     └── recommendation=council ──> full council deliberation
                                         │
                                    Claude (propose)
                                         │
                                    Gemini (critique)
                                         │
                                    Claude (refine)
                                         │
                                    Codex (implement)
                                         │
                                    publish tasks/decisions/handoffs
```

### Agent Invocation

```
modelCall(agent, prompt, timeout)
     │
     ├── recordCallStart(agent, model)  [metrics]
     │
     ├── resolve model flags from config/env
     │
     ├── Windows? ──> pipe via stdin (8191 char limit workaround)
     │   │
     │   └── codex? ──> exec mode with output file
     │
     └── recordCallComplete/Error  [metrics]
```

### Model Resolution

```
Priority chain:
  1. HYDRA_CLAUDE_MODEL env var
  2. hydra.config.json models.claude.active
  3. hydra.config.json models.claude.default
  4. Hardcoded in AGENTS registry

Shorthand resolution:
  "sonnet" ──> MODEL_ALIASES.claude.sonnet ──> "claude-sonnet-4-5-20250929"
  "fast"   ──> config.models.claude.fast   ──> "claude-sonnet-4-5-20250929"
```

## State Management

### Daemon Write Queue

All state mutations go through `enqueueMutation()`:

```
Request ──> enqueueMutation(label, mutator)
                │
                v
           readState() ──> mutator(state) ──> writeState(state)
                │                                    │
                v                                    v
           appendSyncLog()                    appendEvent()
                │
                v
           writeStatus()
```

This ensures serialized writes even with concurrent HTTP requests.

### State File Structure

`AI_SYNC_STATE.json`:
- `activeSession` - Current coordination session
- `tasks[]` - Task queue with status, owner, blockedBy
- `decisions[]` - Recorded decisions
- `blockers[]` - Active blockers
- `handoffs[]` - Agent handoffs (acknowledged or pending)

### Auto-Behaviors

- **Auto-unblock**: When a task completes, blocked dependents move to `todo`
- **Cycle detection**: `blockedBy` mutations are checked for circular dependencies
- **Auto-archive**: When >20 completed tasks, move to archive file
- **Auto-verify**: `tsc --noEmit` runs on task completion

## Event System

NDJSON append-only log at `AI_ORCHESTRATOR_EVENTS.ndjson`:

```json
{"id":"...", "at":"ISO", "type":"mutation", "payload":{"label":"task:add ..."}}
{"id":"...", "at":"ISO", "type":"agent_call_start", "payload":{"agent":"claude"}}
{"id":"...", "at":"ISO", "type":"daemon_start", "payload":{"host":"127.0.0.1","port":4173}}
```

Event types:
- `daemon_start`, `daemon_stop`
- `mutation` (any state change)
- `auto_archive`
- `verification_start`, `verification_complete`
- `agent_call_start`, `agent_call_complete`, `agent_call_error`

## Context Tiers

Three context levels matched to agent capabilities:

| Tier | Agent | Contents |
|------|-------|----------|
| **Minimal** | Codex | Task files + types + signatures only |
| **Medium** | Claude | Summary + priorities + git rules (Claude reads more via tools) |
| **Large** | Gemini | Full context + recent git changes + TODO.md + task files |

Context is cached for 60 seconds to avoid redundant file reads.

## Agent Affinity System

Each agent has affinity scores (0-1) for 7 task types:

| Task Type | Claude | Gemini | Codex |
|-----------|--------|--------|-------|
| planning | 0.95 | 0.50 | 0.20 |
| architecture | 0.95 | 0.55 | 0.15 |
| review | 0.85 | 0.90 | 0.40 |
| refactor | 0.80 | 0.60 | 0.70 |
| implementation | 0.60 | 0.55 | 0.95 |
| analysis | 0.75 | 0.95 | 0.30 |
| testing | 0.50 | 0.60 | 0.85 |

Task type is auto-classified from title/description via regex patterns. The `POST /task/route` endpoint uses these scores to recommend the best agent.

## Usage Monitoring

```
~/.claude/stats-cache.json
     │
     v
findStatsCache() ──> parseStatsCache()
     │
     v
checkUsage() ──> { level, percent, todayTokens, ... }
     │
     ├── normal ──> no action
     ├── warning ──> one-line alert
     └── critical ──> auto-switch model + contingency menu
```

Contingency options:
1. Switch to fast/cheap model
2. Hand off to Gemini
3. Hand off to Codex
4. Save progress and pause

## Metrics Collection

```
modelCall() ──> recordCallStart(agent, model) ──> handle
     │
     ├── success ──> recordCallComplete(handle, result)
     └── error ──> recordCallError(handle, error)
     │
     v
metricsStore.agents[name] = {
  callsTotal, callsToday, callsSuccess, callsFailed,
  estimatedTokensToday, totalDurationMs, avgDurationMs,
  lastCallAt, lastModel, history[last 20]
}
     │
     v
persistMetrics() ──> hydra-metrics.json (every 30s + on shutdown)
```

Token estimation: ~0.25 tokens per output character (rough heuristic).
