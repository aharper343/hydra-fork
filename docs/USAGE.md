# Usage & Command Reference

## Daemon Commands

### Start Daemon
```powershell
node lib/orchestrator-daemon.mjs start [host=127.0.0.1] [port=4173]
# or: npm start
```

### Check Status
```powershell
node lib/orchestrator-daemon.mjs status [url=http://127.0.0.1:4173]
```

### Stop Daemon
```powershell
node lib/orchestrator-daemon.mjs stop [url=http://127.0.0.1:4173]
# or: npm run stop
```

## Client Commands

All client commands use: `node lib/orchestrator-client.mjs <command> [key=value]`

### Dashboard & State

| Command | Description |
|---------|-------------|
| `summary` | Full dashboard with tasks, agents, handoffs |
| `status` | Daemon health check |
| `state` | Raw sync state JSON |
| `stats` | Agent metrics & usage dashboard |
| `events [limit=50]` | Recent daemon events |

### Task Management

| Command | Description |
|---------|-------------|
| `task:add title=... [owner=...] [status=todo] [type=...] [files=...] [notes=...] [blockedBy=...]` | Create a task |
| `task:update taskId=... [status=...] [owner=...] [notes=...] [files=...] [blockedBy=...]` | Update a task |
| `task:route taskId=...` | Get best agent for a task |
| `claim agent=... [taskId=... \| title=...]` | Claim/create a task |
| `verify taskId=...` | Run tsc verification |

### Agent Coordination

| Command | Description |
|---------|-------------|
| `next agent=NAME` | Suggested next action for an agent |
| `prompt agent=NAME` | Context prompt for an agent |
| `handoff from=... to=... summary=... [nextStep=...] [tasks=...]` | Create handoff |
| `handoff:ack handoffId=... agent=...` | Acknowledge handoff |

### Session & Decisions

| Command | Description |
|---------|-------------|
| `session:start focus=... [owner=human] [participants=...] [branch=...]` | Start coordination session |
| `decision:add title=... [owner=...] [rationale=...] [impact=...]` | Record a decision |
| `blocker:add title=... [owner=...] [nextStep=...]` | Record a blocker |

### Model Management

```powershell
# Show active models
node lib/orchestrator-client.mjs model

# Switch Claude to Sonnet
node lib/orchestrator-client.mjs model claude=sonnet

# Switch multiple agents
node lib/orchestrator-client.mjs model claude=sonnet gemini=flash

# Reset to default
node lib/orchestrator-client.mjs model claude=default
```

**Shorthand aliases:**
- Claude: `opus`, `sonnet`, `haiku`, `default`, `fast`, `cheap`
- Gemini: `pro`, `flash`, `default`, `fast`
- Codex: `gpt-5`, `o4-mini`, `default`, `fast`

### Utility

| Command | Description |
|---------|-------------|
| `init` | Initialize Hydra for the current project |
| `archive` | Archive completed tasks/handoffs |
| `archive:status` | Show archive stats |

Add `json=true` to any command for raw JSON output.

## Operator Console

Interactive command center for dispatching prompts:

```powershell
node lib/hydra-operator.mjs             # Interactive mode
node lib/hydra-operator.mjs prompt="..." # One-shot mode
# or: npm run go
```

### Interactive Commands

| Command | Description |
|---------|-------------|
| `:help` | Show help |
| `:status` | Dashboard with agents & tasks |
| `:mode auto` | Mini-round triage then delegate/escalate |
| `:mode handoff` | Direct handoffs (fast, no triage) |
| `:mode council` | Full council deliberation |
| `:mode dispatch` | Headless pipeline |
| `:model` | Show active models |
| `:model claude=sonnet` | Switch agent model |
| `:usage` | Token usage & contingencies |
| `:stats` | Agent metrics & performance |
| `:quit` | Exit console |
| `<any text>` | Dispatch as prompt |

### Operator Modes

- **auto** (default): Runs a mini-round triage, then either delegates via handoff or escalates to full council
- **handoff**: Direct delegation to all agents (fastest, no triage)
- **council**: Full multi-round deliberation (Claude propose -> Gemini critique -> Claude refine -> Codex implement)
- **dispatch**: Headless pipeline (Claude coordinate -> Gemini critique -> Codex synthesize)

## Council Mode

Full multi-round deliberation:

```powershell
node lib/hydra-council.mjs prompt="..." [rounds=2] [mode=live|preview] [publish=true|false]
# or: npm run council -- prompt="..."
```

Options:
- `rounds=2` — Number of deliberation rounds (1-4)
- `mode=preview` — Dry run without calling agents
- `publish=true` — Push decisions/tasks to daemon
- `emit=json` — Output raw JSON instead of summary
- `save=true` — Save run report to coordination/runs/

## Dispatch Mode

Single-pass headless pipeline:

```powershell
node lib/hydra-dispatch.mjs prompt="..." [mode=live|preview] [save=true]
# or: npm run dispatch -- prompt="..."
```

## Usage Monitor

Standalone token usage monitoring:

```powershell
node lib/hydra-usage.mjs
# or: npm run usage
```

Reads `~/.claude/stats-cache.json` and reports:
- Token consumption vs daily budget
- Per-model breakdown
- Activity stats (messages, sessions, tool calls)
- Contingency options at warning/critical levels

Exit code: 0 if normal/warning, 1 if critical.

## Config File

`hydra.config.json` at the Hydra root:

```json
{
  "version": 1,
  "models": {
    "claude": {
      "default": "claude-opus-4-6",
      "fast": "claude-sonnet-4-5-20250929",
      "cheap": "claude-haiku-4-5-20251001",
      "active": "default"
    },
    "gemini": {
      "default": "gemini-2.5-pro",
      "fast": "gemini-2.5-flash",
      "active": "default"
    },
    "codex": {
      "default": "gpt-5",
      "fast": "o4-mini",
      "active": "default"
    }
  },
  "usage": {
    "warningThresholdPercent": 80,
    "criticalThresholdPercent": 90,
    "claudeStatsPath": "auto",
    "dailyTokenBudget": {
      "claude-opus-4-6": 2000000,
      "claude-sonnet-4-5-20250929": 5000000
    }
  },
  "stats": {
    "retentionDays": 30
  }
}
```

### Model Resolution Priority

1. Environment variable: `HYDRA_CLAUDE_MODEL=sonnet`
2. Config file: `models.claude.active`
3. Default: `models.claude.default`

### Usage Thresholds

- **Warning** (default 80%): One-line alert before agent calls
- **Critical** (default 90%): Auto-switch to fast model, show contingency menu

## PowerShell Launcher

Full multi-terminal launch:

```powershell
pwsh -File bin/hydra.ps1 [-Prompt "..."]
```

This starts:
1. Daemon (if not running)
2. Three agent head terminals (Claude, Gemini, Codex)
3. Operator console

One-shot mode: `pwsh -File bin/hydra.ps1 -Prompt "Your objective"`
