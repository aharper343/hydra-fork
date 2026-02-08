# Hydra

**Multi-Agent AI Orchestrator** for Claude, Gemini, and Codex.

```
   \\ | //
    \\|//
   _\\|//_
  |  \|/  |
  |  /|\  |
  \_/ | \_/
    |   |
    |___|

  H Y D R A
```

Hydra coordinates three AI coding agents (Claude Code, Gemini CLI, Codex CLI) through a shared task queue, affinity-based routing, and multi-round deliberation. Built for Windows with PowerShell, zero external dependencies beyond Node.js and picocolors.

## Quick Start

```powershell
# 1. Clone and install
cd E:\Dev\Hydra
npm install

# 2. Initialize for your project
cd E:\Dev\YourProject
node E:/Dev/Hydra/lib/orchestrator-client.mjs init

# 3. Launch everything (daemon + 3 agent heads + operator)
pwsh -File E:/Dev/Hydra/bin/hydra.ps1
```

## Features

- **Three orchestration modes**: Auto (triage + delegate), Council (multi-round deliberation), Dispatch (headless pipeline)
- **Affinity-based task routing**: 7 task types x 3 agents = intelligent work assignment
- **Per-agent model switching**: `hydra model claude=sonnet` to trade quality for speed/cost
- **Token usage monitoring**: Reads Claude Code's stats cache, auto-switches models at critical levels
- **Metrics dashboard**: Per-agent call counts, response times, estimated tokens, success rates
- **Contingency planning**: When approaching rate limits, offers model switching, agent handoff, or progress saving
- **HTTP daemon**: Shared state management with event sourcing, auto-archiving, and cycle detection
- **PowerShell-native**: Branded multi-terminal launcher with per-agent polling heads
- **Project-agnostic**: Works with any Node.js, Rust, Go, or Python project

## Architecture

```
                    +-----------+
                    |  Operator |  (interactive console)
                    +-----+-----+
                          |
                    +-----v-----+
                    |   Daemon  |  (HTTP state manager)
                    +--+--+--+--+
                       |  |  |
              +--------+  |  +--------+
              v           v           v
         +---------+ +---------+ +---------+
         | Claude  | | Gemini  | |  Codex  |
         | (Opus)  | | (Pro)   | |(GPT-5.3)|
         +---------+ +---------+ +---------+
         Architect    Analyst     Implementer
```

## Project Structure

```
hydra/
  bin/
    hydra.ps1               # Main launcher (daemon + heads + operator)
    hydra-head.ps1           # Agent polling head
    hydra-launch.ps1         # Multi-terminal launcher
    hydra-stats.ps1          # Stats dashboard shortcut
    install-hydra-profile.ps1 # PowerShell profile installer
  lib/
    hydra-agents.mjs         # Agent registry, model management
    hydra-config.mjs         # Project detection, config loading
    hydra-context.mjs        # Tiered context builders
    hydra-council.mjs        # Multi-round deliberation
    hydra-dispatch.mjs       # Single-shot pipeline
    hydra-metrics.mjs        # Call metrics collection
    hydra-operator.mjs       # Interactive command center
    hydra-ui.mjs             # Terminal UI components
    hydra-usage.mjs          # Token usage monitor
    hydra-utils.mjs          # Shared utilities
    orchestrator-client.mjs  # CLI client for daemon
    orchestrator-daemon.mjs  # HTTP server + state manager
    sync.mjs                 # Legacy sync CLI
  docs/
    INSTALL.md               # Installation guide
    USAGE.md                 # Command reference
    ARCHITECTURE.md          # System design
    CONTRIBUTING.md          # Extension guide
  hydra.config.json          # Model + usage configuration
  package.json
```

## Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start the daemon |
| `npm run go` | Launch operator console |
| `npm run stats` | View metrics dashboard |
| `npm run usage` | Check token usage |
| `npm run model` | Show/set active models |
| `npm run council` | Full multi-round deliberation |
| `npm run dispatch` | Headless pipeline |

## Documentation

- [Installation](docs/INSTALL.md)
- [Usage & Commands](docs/USAGE.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Contributing](docs/CONTRIBUTING.md)

## Requirements

- Node.js 20+
- PowerShell 7+ (for launchers)
- At least one AI CLI: `claude`, `gemini`, or `codex`

## License

Private project.
