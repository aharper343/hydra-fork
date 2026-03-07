# Hydra Setup & Init — CLI Awareness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give users a `hydra setup` command that registers the Hydra MCP server globally into Claude Code, Gemini CLI, and Codex CLI, plus a `hydra init` command that generates project-level HYDRA.md coordination instructions.

**Architecture:** A single new module `lib/hydra-setup.mjs` handles both commands. It detects installed CLIs, reads/merges their config files, writes MCP server entries idempotently, and generates HYDRA.md from a template. The CLI entry point (`bin/hydra-cli.mjs`) routes `hydra setup` and `hydra init` to this module.

**Tech Stack:** Node.js ESM, fs/path/os stdlib, existing `hydra-sync-md.mjs` for HYDRA.md→agent file sync, existing `hydra-exec.mjs` for CLI routing.

---

## Reference: MCP Config Formats

### Claude Code
- **File:** `~/.claude.json` (NOT `~/.claude/settings.json`)
- **Key:** top-level `"mcpServers"`
- **Format:**
```json
{
  "mcpServers": {
    "hydra": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/hydra-mcp-server.mjs"],
      "env": {}
    }
  }
}
```
- **CLI alternative:** `claude mcp add hydra -s user -- node /path/to/hydra-mcp-server.mjs`

### Gemini CLI
- **File:** `~/.gemini/settings.json`
- **Key:** top-level `"mcpServers"`
- **Format:**
```json
{
  "mcpServers": {
    "hydra": {
      "command": "node",
      "args": ["/path/to/hydra-mcp-server.mjs"],
      "timeout": 600000,
      "description": "Hydra multi-agent orchestration"
    }
  }
}
```
- **CLI alternative:** `gemini mcp add hydra --scope user -- node /path/to/hydra-mcp-server.mjs`

### Codex CLI
- **File:** `~/.codex/config.toml` (MCP servers section)
- **CLI:** `codex mcp add hydra -- node /path/to/hydra-mcp-server.mjs`
- No documented TOML schema for manual MCP entry — prefer using `codex mcp add` CLI.

---

## Task 1: Create `lib/hydra-setup.mjs` — CLI Detection & MCP Registration

**Files:**
- Create: `lib/hydra-setup.mjs`
- Test: `test/hydra-setup.test.mjs`

### Step 1: Write the failing tests

```javascript
// test/hydra-setup.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  detectInstalledCLIs,
  buildMcpServerEntry,
  readJsonFile,
  mergeClaudeConfig,
  mergeGeminiConfig,
  resolveHydraRoot,
} from '../lib/hydra-setup.mjs';

describe('hydra-setup', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydra-setup-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('buildMcpServerEntry', () => {
    it('returns stdio entry with node command and hydra-mcp-server path', () => {
      const entry = buildMcpServerEntry('/opt/hydra');
      assert.equal(entry.type, 'stdio');
      assert.equal(entry.command, 'node');
      assert.ok(entry.args[0].includes('hydra-mcp-server.mjs'));
    });
  });

  describe('mergeClaudeConfig', () => {
    it('adds hydra to empty config', () => {
      const configPath = path.join(tmpDir, '.claude.json');
      fs.writeFileSync(configPath, '{}');
      const entry = buildMcpServerEntry('/opt/hydra');
      const result = mergeClaudeConfig(configPath, entry);
      assert.equal(result.action, 'added');

      const written = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.ok(written.mcpServers.hydra);
      assert.equal(written.mcpServers.hydra.command, 'node');
    });

    it('skips if hydra already registered', () => {
      const configPath = path.join(tmpDir, '.claude.json');
      const existing = { mcpServers: { hydra: { type: 'stdio', command: 'node', args: ['/old/path'] } } };
      fs.writeFileSync(configPath, JSON.stringify(existing));
      const entry = buildMcpServerEntry('/opt/hydra');
      const result = mergeClaudeConfig(configPath, entry);
      assert.equal(result.action, 'exists');
    });

    it('preserves other mcpServers entries', () => {
      const configPath = path.join(tmpDir, '.claude.json');
      const existing = { mcpServers: { other: { command: 'python' } }, someKey: 42 };
      fs.writeFileSync(configPath, JSON.stringify(existing));
      const entry = buildMcpServerEntry('/opt/hydra');
      mergeClaudeConfig(configPath, entry);

      const written = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.ok(written.mcpServers.other);
      assert.equal(written.someKey, 42);
    });
  });

  describe('mergeGeminiConfig', () => {
    it('creates settings.json with mcpServers if file missing', () => {
      const configPath = path.join(tmpDir, 'settings.json');
      const entry = buildMcpServerEntry('/opt/hydra');
      const result = mergeGeminiConfig(configPath, entry);
      assert.equal(result.action, 'added');

      const written = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.ok(written.mcpServers.hydra);
    });

    it('skips if hydra already registered', () => {
      const configPath = path.join(tmpDir, 'settings.json');
      fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { hydra: { command: 'node' } } }));
      const entry = buildMcpServerEntry('/opt/hydra');
      const result = mergeGeminiConfig(configPath, entry);
      assert.equal(result.action, 'exists');
    });
  });

  describe('readJsonFile', () => {
    it('returns empty object for missing file', () => {
      const result = readJsonFile(path.join(tmpDir, 'nope.json'));
      assert.deepEqual(result, {});
    });

    it('reads valid JSON', () => {
      const p = path.join(tmpDir, 'test.json');
      fs.writeFileSync(p, '{"a":1}');
      assert.deepEqual(readJsonFile(p), { a: 1 });
    });
  });
});
```

### Step 2: Run tests to verify they fail

Run: `node --test test/hydra-setup.test.mjs`
Expected: FAIL — module `../lib/hydra-setup.mjs` not found

### Step 3: Write the implementation

```javascript
// lib/hydra-setup.mjs
#!/usr/bin/env node
/**
 * hydra setup — registers Hydra MCP server globally into Claude Code, Gemini CLI, and Codex CLI.
 * hydra init  — generates HYDRA.md in a target project directory.
 *
 * Usage:
 *   node lib/hydra-setup.mjs [setup|init] [options]
 *   hydra setup [--uninstall] [--force]
 *   hydra init [path]
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { syncHydraMd } from './hydra-sync-md.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Resolve the Hydra installation root (parent of lib/). */
export function resolveHydraRoot() {
  return path.resolve(__dirname, '..');
}

/** Resolve the absolute path to the MCP server entry point. */
export function resolveMcpServerPath(hydraRoot) {
  return path.join(hydraRoot, 'lib', 'hydra-mcp-server.mjs');
}

/** Resolve the node executable path (full path on Windows for reliability). */
export function resolveNodePath() {
  return process.execPath;
}

/** Build the MCP server entry object for registration. */
export function buildMcpServerEntry(hydraRoot) {
  return {
    type: 'stdio',
    command: 'node',
    args: [resolveMcpServerPath(hydraRoot).replace(/\\/g, '/')],
    env: {},
  };
}

/** Safely read a JSON file, returning {} if missing or invalid. */
export function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

/** Write JSON with 2-space indent. */
function writeJsonFile(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ── CLI Detection ────────────────────────────────────────────────────────────

/** Check if a command is available in PATH. */
function commandExists(cmd) {
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    execFileSync(which, [cmd], { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Detect which AI CLIs are installed. Returns { claude, gemini, codex }. */
export function detectInstalledCLIs() {
  return {
    claude: commandExists('claude'),
    gemini: commandExists('gemini'),
    codex: commandExists('codex'),
  };
}

// ── Config Paths ─────────────────────────────────────────────────────────────

function getClaudeConfigPath() {
  return path.join(os.homedir(), '.claude.json');
}

function getGeminiConfigPath() {
  return path.join(os.homedir(), '.gemini', 'settings.json');
}

// ── Merge Functions ──────────────────────────────────────────────────────────

/**
 * Add hydra MCP server to Claude Code's ~/.claude.json.
 * @returns {{ action: 'added'|'exists'|'updated' }}
 */
export function mergeClaudeConfig(configPath, mcpEntry, opts = {}) {
  const config = readJsonFile(configPath);

  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  if (config.mcpServers.hydra && !opts.force) {
    return { action: 'exists' };
  }

  const action = config.mcpServers.hydra ? 'updated' : 'added';
  config.mcpServers.hydra = mcpEntry;
  writeJsonFile(configPath, config);
  return { action };
}

/**
 * Add hydra MCP server to Gemini CLI's ~/.gemini/settings.json.
 * @returns {{ action: 'added'|'exists'|'updated' }}
 */
export function mergeGeminiConfig(configPath, mcpEntry, opts = {}) {
  const config = readJsonFile(configPath);

  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  if (config.mcpServers.hydra && !opts.force) {
    return { action: 'exists' };
  }

  // Gemini uses a slightly different schema (no "type" field, has "description")
  const geminiEntry = {
    command: mcpEntry.command,
    args: mcpEntry.args,
    timeout: 600000,
    description: 'Hydra multi-agent orchestration',
  };

  const action = config.mcpServers.hydra ? 'updated' : 'added';
  config.mcpServers.hydra = geminiEntry;
  writeJsonFile(configPath, config);
  return { action };
}

/**
 * Register hydra MCP server in Codex CLI via `codex mcp add`.
 * @returns {{ action: 'added'|'exists'|'error', error?: string }}
 */
export function registerCodexMcp(mcpServerPath, opts = {}) {
  // Check if already registered
  try {
    const listResult = spawnSync('codex', ['mcp', 'list', '--json'], {
      stdio: 'pipe',
      timeout: 10000,
      encoding: 'utf8',
    });
    if (listResult.stdout) {
      const servers = JSON.parse(listResult.stdout);
      const hasHydra = Array.isArray(servers)
        ? servers.some((s) => s.name === 'hydra' || s === 'hydra')
        : false;
      if (hasHydra && !opts.force) {
        return { action: 'exists' };
      }
    }
  } catch {
    // Continue — try to add anyway
  }

  const result = spawnSync('codex', ['mcp', 'add', 'hydra', '--', 'node', mcpServerPath], {
    stdio: 'pipe',
    timeout: 15000,
    encoding: 'utf8',
  });

  if (result.status === 0) {
    return { action: 'added' };
  }

  return {
    action: 'error',
    error: (result.stderr || result.stdout || 'Unknown error').trim(),
  };
}

/**
 * Remove hydra MCP server from Claude Code.
 * @returns {{ action: 'removed'|'not_found' }}
 */
export function unmergeClaudeConfig(configPath) {
  const config = readJsonFile(configPath);
  if (!config.mcpServers?.hydra) {
    return { action: 'not_found' };
  }
  delete config.mcpServers.hydra;
  writeJsonFile(configPath, config);
  return { action: 'removed' };
}

/**
 * Remove hydra MCP server from Gemini CLI.
 * @returns {{ action: 'removed'|'not_found' }}
 */
export function unmergeGeminiConfig(configPath) {
  const config = readJsonFile(configPath);
  if (!config.mcpServers?.hydra) {
    return { action: 'not_found' };
  }
  delete config.mcpServers.hydra;
  writeJsonFile(configPath, config);
  return { action: 'removed' };
}

/**
 * Remove hydra MCP server from Codex CLI.
 * @returns {{ action: 'removed'|'not_found'|'error', error?: string }}
 */
export function unregisterCodexMcp() {
  const result = spawnSync('codex', ['mcp', 'remove', 'hydra'], {
    stdio: 'pipe',
    timeout: 10000,
    encoding: 'utf8',
  });
  if (result.status === 0) {
    return { action: 'removed' };
  }
  if ((result.stderr || '').includes('not found') || (result.stdout || '').includes('not found')) {
    return { action: 'not_found' };
  }
  return { action: 'error', error: (result.stderr || '').trim() };
}

// ── HYDRA.md Template ────────────────────────────────────────────────────────

/**
 * Generate the HYDRA.md template content for a project.
 * @param {object} opts
 * @param {string} opts.projectName - Display name for the project
 * @param {string} opts.daemonUrl - Daemon URL (default http://127.0.0.1:4173)
 * @returns {string}
 */
export function generateHydraMdTemplate(opts = {}) {
  const projectName = opts.projectName || path.basename(process.cwd());
  const daemonUrl = opts.daemonUrl || 'http://127.0.0.1:4173';

  return `# Hydra Coordination — ${projectName}

This project uses [Hydra](https://github.com/PrimeLocus/Hydra) for multi-agent orchestration.
The Hydra daemon runs at \`${daemonUrl}\` and coordinates tasks across agents.

## Coordination Protocol

You have access to Hydra MCP tools. Use them to coordinate with other agents:

1. **Check for pending handoffs** before starting work:
   - Use \`hydra_handoffs_pending\` with your agent name
   - Acknowledge handoffs with \`hydra_handoffs_ack\`

2. **Claim tasks** before working on them:
   - Use \`hydra_tasks_list\` to see open tasks
   - Use \`hydra_tasks_claim\` to atomically claim a task (prevents double-work)
   - Use \`hydra_tasks_update\` to report progress and results

3. **Check system status** for context:
   - Use \`hydra_status\` to check daemon health
   - Read \`hydra://activity\` resource for recent events

4. **Cross-verify with other agents** when appropriate:
   - Use \`hydra_ask\` to get a second opinion from Gemini or Codex
   - Use \`hydra_council_request\` for complex decisions needing multi-agent deliberation

## @claude

You are the **architect** in this Hydra setup. Your strengths:
- System design, planning, and architectural decisions
- Complex reasoning and nuanced analysis
- Code review with deep context understanding

When you receive a handoff, check if it includes a task ID and claim it.
After completing work, use \`hydra_tasks_update\` to report results.
If a task is complex, consider requesting a council deliberation.

## @gemini

You are the **analyst** in this Hydra setup. Your strengths:
- Code review and critique
- Research and analysis
- Identifying edge cases and potential issues
- Security review

When reviewing code, be specific about issues and suggest fixes.
After analysis, update the task with your findings.

## @codex

You are the **implementer** in this Hydra setup. Your strengths:
- Fast code generation and refactoring
- Writing tests
- Prototyping and quick iteration
- Following specifications precisely

When implementing, claim the task first, then report results when done.
Include what you changed and any tests you added.
`;
}

// ── Main CLI ─────────────────────────────────────────────────────────────────

const ACTION_ICONS = { added: '+', exists: '=', updated: '~', removed: '-', not_found: '.', error: '!' };

function printResult(cli, result) {
  const icon = ACTION_ICONS[result.action] || '?';
  const label = { added: 'registered', exists: 'already registered', updated: 'updated', removed: 'removed', not_found: 'not found', error: 'error' };
  const msg = label[result.action] || result.action;
  console.log(`  [${icon}] ${cli}: ${msg}${result.error ? ` — ${result.error}` : ''}`);
}

async function runSetup(args) {
  const force = args.includes('--force');
  const uninstall = args.includes('--uninstall');

  const hydraRoot = resolveHydraRoot();
  const mcpEntry = buildMcpServerEntry(hydraRoot);
  const mcpServerPath = resolveMcpServerPath(hydraRoot).replace(/\\/g, '/');
  const clis = detectInstalledCLIs();

  const detected = Object.entries(clis).filter(([, v]) => v).map(([k]) => k);
  if (detected.length === 0) {
    console.log('No AI CLIs detected (claude, gemini, codex). Nothing to configure.');
    console.log('Install at least one CLI and re-run `hydra setup`.');
    return;
  }

  console.log(`Detected CLIs: ${detected.join(', ')}`);
  console.log(`Hydra MCP server: ${mcpServerPath}`);
  console.log(uninstall ? '\nRemoving Hydra MCP registration...' : '\nRegistering Hydra MCP server...');

  if (clis.claude) {
    const configPath = getClaudeConfigPath();
    const result = uninstall
      ? unmergeClaudeConfig(configPath)
      : mergeClaudeConfig(configPath, mcpEntry, { force });
    printResult('Claude Code', result);
  }

  if (clis.gemini) {
    const configPath = getGeminiConfigPath();
    const result = uninstall
      ? unmergeGeminiConfig(configPath)
      : mergeGeminiConfig(configPath, mcpEntry, { force });
    printResult('Gemini CLI', result);
  }

  if (clis.codex) {
    const result = uninstall
      ? unregisterCodexMcp()
      : registerCodexMcp(mcpServerPath, { force });
    printResult('Codex CLI', result);
  }

  console.log(uninstall ? '\nDone. Restart any open CLI sessions.' : '\nDone. New CLI sessions will have access to Hydra MCP tools.');
}

async function runInit(args) {
  const targetDir = args[0] ? path.resolve(args[0]) : process.cwd();
  const hydraMdPath = path.join(targetDir, 'HYDRA.md');

  if (fs.existsSync(hydraMdPath)) {
    console.log(`HYDRA.md already exists at ${hydraMdPath}`);
    console.log('Use --force to overwrite, or edit it directly.');
    if (!args.includes('--force')) return;
  }

  const projectName = path.basename(targetDir);
  const content = generateHydraMdTemplate({ projectName });
  fs.writeFileSync(hydraMdPath, content, 'utf8');
  console.log(`Created ${hydraMdPath}`);

  // Run sync to generate per-agent files
  const { synced } = syncHydraMd(targetDir);
  if (synced.length > 0) {
    console.log(`Generated: ${synced.join(', ')}`);
  }

  console.log('\nDone. Agents working in this project will see Hydra coordination instructions.');
  console.log('Edit HYDRA.md to customize per-agent behavior, then re-run `hydra init` or `:sync`.');
}

export async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'setup';
  const args = argv.slice(1);

  switch (command) {
    case 'setup':
      await runSetup(args);
      break;
    case 'init':
      await runInit(args);
      break;
    case '--help':
    case '-h':
      console.log([
        'hydra setup — Register Hydra MCP server in AI CLIs',
        '',
        'Commands:',
        '  hydra setup              Register MCP server globally in all detected CLIs',
        '  hydra setup --uninstall  Remove MCP registration from all CLIs',
        '  hydra setup --force      Overwrite existing registration',
        '  hydra init [path]        Generate HYDRA.md in target project',
        '  hydra init --force       Overwrite existing HYDRA.md',
      ].join('\n'));
      break;
    default:
      console.error(`Unknown command: ${command}. Run \`hydra setup --help\`.`);
      process.exit(1);
  }
}

// CLI entry point
const isDirectRun = process.argv[1] && (
  process.argv[1].replace(/\\/g, '/').endsWith('hydra-setup.mjs')
);
if (isDirectRun) {
  main().catch((err) => {
    console.error(`Setup failed: ${err.message}`);
    process.exit(1);
  });
}
```

### Step 4: Run tests to verify they pass

Run: `node --test test/hydra-setup.test.mjs`
Expected: All 6 tests PASS

### Step 5: Commit

```bash
git add lib/hydra-setup.mjs test/hydra-setup.test.mjs
git commit -m "feat: add hydra-setup module for CLI MCP registration and project init"
```

---

## Task 2: Wire `hydra setup` and `hydra init` into CLI entry point

**Files:**
- Modify: `bin/hydra-cli.mjs` (add `setup` and `init` subcommand routing)
- Modify: `lib/hydra-exec.mjs` (add `hydra-setup.mjs` to internal module loaders for standalone builds)
- Modify: `package.json` (add `setup` and `init` npm scripts)

### Step 1: Write the failing test

```javascript
// Add to existing test or verify manually:
// Running `node bin/hydra-cli.mjs setup --help` should print setup help.
// Running `node bin/hydra-cli.mjs init --help` should print init help.
```

This task is wiring-only — the logic is already tested in Task 1. Verify by running the commands.

### Step 2: Modify `bin/hydra-cli.mjs`

In `parseCommonArgs`, before the main loop, add early detection of `setup` and `init` subcommands. Add this block near the top of `async function main()`, right after the `HYDRA_INTERNAL_FLAG` check (line 350):

```javascript
  // Subcommands that bypass the operator
  const subcommand = argv[0]?.toLowerCase();
  if (subcommand === 'setup' || subcommand === 'init') {
    const { main: setupMain } = await import('../lib/hydra-setup.mjs');
    if (subcommand === 'init') {
      await setupMain(['init', ...argv.slice(1)]);
    } else {
      await setupMain(['setup', ...argv.slice(1)]);
    }
    return;
  }
```

### Step 3: Modify `lib/hydra-exec.mjs`

Add the setup module to `INTERNAL_MODULE_LOADERS` (for standalone .exe builds):

```javascript
  'lib/hydra-setup.mjs': () => import('./hydra-setup.mjs'),
```

### Step 4: Modify `package.json`

Add scripts:

```json
"setup": "node lib/hydra-setup.mjs setup",
"init": "node lib/hydra-setup.mjs init"
```

### Step 5: Update help text in `bin/hydra-cli.mjs`

In `printHelp()`, add setup/init to the usage output:

```javascript
    '  hydra setup              Register Hydra MCP server in AI CLIs',
    '  hydra setup --uninstall  Remove MCP registration',
    '  hydra init [path]        Generate HYDRA.md for a project',
```

### Step 6: Verify by running

Run: `node bin/hydra-cli.mjs setup --help`
Expected: Prints setup help text.

Run: `node bin/hydra-cli.mjs init --help`
Expected: Prints init help text.

### Step 7: Commit

```bash
git add bin/hydra-cli.mjs lib/hydra-exec.mjs package.json
git commit -m "feat: wire hydra setup/init subcommands into CLI entry point"
```

---

## Task 3: Create the Hydra repo's own `HYDRA.md` template

**Files:**
- Create: `HYDRA.md` (project root)

### Step 1: Write HYDRA.md

This is the real coordination file for the Hydra project itself, and serves as a reference for `hydra init`. Unlike the generic template in `generateHydraMdTemplate()`, this one is specific to Hydra development.

```markdown
# Hydra Coordination

This project uses Hydra for multi-agent orchestration. The daemon coordinates
tasks at `http://127.0.0.1:4173`.

## Coordination Protocol

You have access to Hydra MCP tools (`hydra_*`). Use them to coordinate:

1. **Check for handoffs** — `hydra_handoffs_pending` with your agent name
2. **Claim tasks** — `hydra_tasks_claim` before starting work
3. **Report results** — `hydra_tasks_update` when done
4. **Get second opinions** — `hydra_ask` for cross-agent review
5. **Council deliberation** — `hydra_council_request` for complex decisions

## Branch Rules

- Work on `dev`. Never commit to `master` unless explicitly told.
- Update CLAUDE.md/README.md when architecture or features change.

## @claude

You are the **architect**. Focus on design, planning, complex reasoning, and code review.
Claim tasks via `hydra_tasks_claim`. Report results via `hydra_tasks_update`.
For complex tasks, consider `hydra_council_request`.

## @gemini

You are the **analyst**. Focus on code review, critique, research, and security analysis.
Be specific about issues. Update tasks with findings via `hydra_tasks_update`.

## @codex

You are the **implementer**. Focus on code generation, refactoring, tests, and prototyping.
Claim tasks first, implement, then report what changed via `hydra_tasks_update`.
```

### Step 2: Run sync to generate per-agent files

Run: `node -e "import('./lib/hydra-sync-md.mjs').then(m => console.log(m.syncHydraMd('.')))"`
Expected: `{ synced: ['CLAUDE.md', 'GEMINI.md', 'AGENTS.md'], skipped: false }`

**Important:** The synced CLAUDE.md will replace the existing hand-written one. Since the hand-written CLAUDE.md contains essential architecture docs, we should NOT let the sync overwrite it. Instead, the HYDRA.md shared section should include the essential content, OR we modify the sync to append rather than replace.

**Decision:** The existing `CLAUDE.md` is comprehensive and hand-maintained. HYDRA.md sync should only generate `GEMINI.md` and `AGENTS.md` — the existing `CLAUDE.md` stays hand-maintained. Modify the sync call in operator/daemon to skip CLAUDE.md if it doesn't have the auto-generated header.

Actually, the simpler approach: don't create a HYDRA.md in the Hydra repo itself yet. The Hydra repo already has a comprehensive hand-maintained CLAUDE.md. Instead, just create the GEMINI.md and AGENTS.md manually from the relevant parts of CLAUDE.md, or rely on the existing `getAgentInstructionFile()` fallback which returns CLAUDE.md for all agents when HYDRA.md doesn't exist.

**Revised approach:** Ship the template generator in `hydra-setup.mjs` (already done in Task 1). Skip creating a HYDRA.md for the Hydra repo itself — the existing CLAUDE.md is the authority. Create minimal GEMINI.md and AGENTS.md that point to CLAUDE.md for architecture reference but add the coordination protocol.

### Step 2 (revised): Create GEMINI.md and AGENTS.md for the Hydra repo

Create `GEMINI.md`:
```markdown
# Hydra — Gemini Agent Instructions

You are the **analyst** in this Hydra orchestration system.

## Coordination

You have access to Hydra MCP tools. Check `hydra_handoffs_pending` for work
assigned to you. Claim tasks with `hydra_tasks_claim` before starting.
Report results with `hydra_tasks_update`.

## Architecture Reference

See CLAUDE.md in this repo for full architecture documentation.
Key points: ESM-only, picocolors for colors, agent names lowercase (claude/gemini/codex).

## Your Role

- Code review and critique
- Research and analysis
- Security review
- Identifying edge cases
```

Create `AGENTS.md`:
```markdown
# Hydra — Codex Agent Instructions

You are the **implementer** in this Hydra orchestration system.

## Coordination

You have access to Hydra MCP tools. Check `hydra_handoffs_pending` for work.
Claim tasks with `hydra_tasks_claim` before starting.
Report results with `hydra_tasks_update`.

## Architecture Reference

See CLAUDE.md in this repo for full architecture documentation.
Key points: ESM-only, picocolors for colors, agent names lowercase (claude/gemini/codex).

## Your Role

- Code generation and refactoring
- Writing tests (node:test + node:assert/strict)
- Prototyping and iteration
- Following specifications precisely
```

### Step 3: Commit

```bash
git add GEMINI.md AGENTS.md
git commit -m "feat: add Gemini and Codex agent instruction files for Hydra repo"
```

---

## Task 4: Update documentation

**Files:**
- Modify: `CLAUDE.md` — add `hydra-setup.mjs` to Key Modules, add `setup`/`init` to Commands
- Modify: `README.md` — add setup instructions for CLI awareness
- Modify: `docs/USAGE.md` — add MCP setup section

### Step 1: Add to CLAUDE.md Commands section

Under `## Commands`, add:
```
npm run setup                # Register Hydra MCP server in all detected AI CLIs
npm run init                 # Generate HYDRA.md in current project
```

### Step 2: Add to CLAUDE.md Key Modules

Add a bullet for `hydra-setup.mjs`:
```
- **`hydra-setup.mjs`** — CLI awareness setup. Detects installed AI CLIs (Claude Code, Gemini CLI, Codex CLI), registers Hydra MCP server globally, generates project-level HYDRA.md. Exports `detectInstalledCLIs()`, `buildMcpServerEntry()`, `mergeClaudeConfig()`, `mergeGeminiConfig()`, `registerCodexMcp()`, `generateHydraMdTemplate()`, `main()`. Subcommands: `setup` (global MCP registration), `init` (project HYDRA.md generation). Config file targets: `~/.claude.json`, `~/.gemini/settings.json`, `~/.codex/config.toml`.
```

### Step 3: Add to README.md

Add a "Setup" or "CLI Integration" section:
```markdown
## CLI Integration

After installing Hydra, register its MCP server with your AI CLIs:

\`\`\`bash
hydra setup
\`\`\`

This detects installed CLIs (Claude Code, Gemini CLI, Codex CLI) and registers
the Hydra MCP server globally. New CLI sessions will have access to Hydra
coordination tools (`hydra_ask`, `hydra_tasks_claim`, `hydra_status`, etc.).

To make a project Hydra-aware (generates coordination instructions for each agent):

\`\`\`bash
cd /path/to/your/project
hydra init
\`\`\`

To remove the MCP registration:

\`\`\`bash
hydra setup --uninstall
\`\`\`
```

### Step 4: Commit

```bash
git add CLAUDE.md README.md docs/USAGE.md
git commit -m "docs: add hydra setup/init to CLAUDE.md, README.md, and USAGE.md"
```

---

## Task 5: End-to-end verification

### Step 1: Run unit tests

Run: `node --test test/hydra-setup.test.mjs`
Expected: All tests PASS

### Step 2: Run full test suite

Run: `npm test`
Expected: No regressions

### Step 3: Test `hydra setup` dry behavior

Run: `node bin/hydra-cli.mjs setup --help`
Expected: Prints help text

### Step 4: Test `hydra init` in a temp directory

Run: `node bin/hydra-cli.mjs init /tmp/test-hydra-init`
Expected: Creates HYDRA.md, CLAUDE.md, GEMINI.md, AGENTS.md in /tmp/test-hydra-init

### Step 5: Verify setup detects CLIs

Run: `node bin/hydra-cli.mjs setup`
Expected: Detects installed CLIs, registers (or reports already registered)

### Step 6: Final commit if any fixes needed

```bash
git add -A && git commit -m "fix: address issues found during e2e verification"
```
