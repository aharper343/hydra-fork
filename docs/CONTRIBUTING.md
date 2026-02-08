# Contributing to Hydra

## Adding a New Agent

1. **Register in `lib/hydra-agents.mjs`**:

```js
export const AGENTS = {
  // ... existing agents ...
  newagent: {
    label: 'NewAgent 1.0',
    cli: 'newagent',
    invoke: {
      nonInteractive: (prompt) => ['newagent', ['-p', prompt, '--json']],
      interactive: (prompt) => ['newagent', [prompt]],
    },
    contextBudget: 100_000,
    contextTier: 'minimal', // minimal | medium | large
    strengths: ['...'],
    weaknesses: ['...'],
    councilRole: 'specialist',
    taskAffinity: {
      planning: 0.5,
      architecture: 0.5,
      review: 0.5,
      refactor: 0.5,
      implementation: 0.5,
      analysis: 0.5,
      testing: 0.5,
    },
    rolePrompt: 'You are a specialist agent...',
    timeout: 5 * 60 * 1000,
  },
};
```

2. **Add to `KNOWN_OWNERS`**: Already auto-derived from `AGENTS` keys.

3. **Add model config in `hydra.config.json`**:

```json
"newagent": {
  "default": "newagent-v1",
  "fast": "newagent-mini",
  "active": "default"
}
```

4. **Add model aliases in `hydra-agents.mjs`**:

```js
const MODEL_ALIASES = {
  // ...
  newagent: { v1: 'newagent-v1', mini: 'newagent-mini' },
};

const MODEL_CLI_FLAGS = {
  // ...
  newagent: (modelId) => ['--model', modelId],
};
```

5. **Add context tier in `lib/hydra-context.mjs`** if needed.

6. **Add color in `lib/hydra-ui.mjs`**:

```js
const AGENT_COLORS = { /* ... */ newagent: pc.blue };
const AGENT_ICONS = { /* ... */ newagent: '\u2605' }; // ★
```

7. **Add to PowerShell head** in `bin/hydra-head.ps1` (ValidateSet and switch cases).

## Adding a New Model

1. **Add to `hydra.config.json`**:

```json
"claude": {
  "default": "claude-opus-4-6",
  "fast": "claude-sonnet-4-5-20250929",
  "cheap": "claude-haiku-4-5-20251001",
  "experimental": "claude-opus-4-7",  // new preset
  "active": "default"
}
```

2. **Add alias in `hydra-agents.mjs`**:

```js
const MODEL_ALIASES = {
  claude: {
    // ...
    experimental: 'claude-opus-4-7',
  },
};
```

3. **Add budget in config** (if Claude model):

```json
"dailyTokenBudget": {
  "claude-opus-4-7": 3000000
}
```

Users can then: `hydra model claude=experimental`

## Adding a Daemon Endpoint

1. **Add route handler** in `lib/orchestrator-daemon.mjs` inside the `http.createServer` callback:

```js
if (method === 'GET' && route === '/my-endpoint') {
  const data = /* compute response */;
  sendJson(res, 200, { ok: true, data });
  return;
}

// For write endpoints (after auth check):
if (method === 'POST' && route === '/my-endpoint') {
  const body = await readJsonBody(req);
  const result = await enqueueMutation('my-endpoint', (state) => {
    // mutate state
    return /* result */;
  });
  sendJson(res, 200, { ok: true, result });
  return;
}
```

2. **Add client command** in `lib/orchestrator-client.mjs`:

```js
case 'my-command': {
  const data = await request('GET', baseUrl, '/my-endpoint');
  if (jsonMode) { print(data); return; }
  // Pretty-print
  return;
}
```

3. **Add help text** in the `printHelp()` function.

## Adding an Operator Command

1. **Add to help text** in `lib/hydra-operator.mjs` `printHelp()`:

```js
console.log(`  ${ACCENT(':mycommand')}           Description`);
```

2. **Add handler** in the `rl.on('line', ...)` callback:

```js
if (line === ':mycommand' || line.startsWith(':mycommand ')) {
  // Handle command
  rl.prompt();
  return;
}
```

## Code Style

- **ES Modules**: All `.mjs` files use `import`/`export`
- **No build step**: All code runs directly with Node.js
- **Minimal dependencies**: Only `picocolors` for terminal colors
- **Windows-first**: All paths use forward slashes, stdin piping for long prompts
- **ANSI formatting**: Use `hydra-ui.mjs` exports (SUCCESS, ERROR, WARNING, DIM, ACCENT, etc.)
- **Error handling**: Non-critical errors (metrics, usage checks) are silently caught; critical errors throw
- **State mutations**: Always go through `enqueueMutation()` in the daemon
- **JSON output**: All daemon endpoints return `{ ok: true/false, ... }`

## Testing

Currently no automated tests. To verify changes:

1. Start daemon: `npm start`
2. Run a dispatch: `npm run dispatch -- prompt="test" mode=preview`
3. Check stats: `npm run stats`
4. Check model switching: `npm run model -- claude=sonnet` then `npm run model`
5. Check usage: `npm run usage`
