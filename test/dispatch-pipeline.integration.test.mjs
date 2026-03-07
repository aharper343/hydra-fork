import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyPrompt, selectTandemPair } from '../lib/hydra-utils.mjs';
import {
  createMockExecuteAgent,
  loadAgentFixture,
  makeFailureResult,
  makeSuccessResult,
} from './helpers/mock-agent.mjs';

const ALL_AGENTS = ['claude', 'gemini', 'codex'];

const [claudeFixtures, geminiFixtures, codexFixtures] = await Promise.all([
  loadAgentFixture('claude'),
  loadAgentFixture('gemini'),
  loadAgentFixture('codex'),
]);

const mockExecuteAgent = createMockExecuteAgent({
  claude: claudeFixtures,
  gemini: geminiFixtures,
  codex: codexFixtures,
});

function assertExecuteResultShape(result) {
  assert.equal(typeof result.ok, 'boolean');
  assert.equal(typeof result.output, 'string');
  assert.equal(typeof result.stdout, 'string');
  assert.equal(typeof result.stderr, 'string');
  assert.ok(result.error === null || typeof result.error === 'string');
  assert.ok(typeof result.exitCode === 'number' || result.exitCode === null);
  assert.equal(result.signal, null);
  assert.equal(typeof result.durationMs, 'number');
  assert.equal(result.timedOut, false);
}

test('loadAgentFixture resolves all static agent fixture sets with validated defaults', () => {
  assert.equal(Array.isArray(claudeFixtures), true);
  assert.equal(Array.isArray(geminiFixtures), true);
  assert.equal(Array.isArray(codexFixtures), true);
  assert.ok(claudeFixtures.length >= 3);
  assert.ok(geminiFixtures.length >= 3);
  assert.ok(codexFixtures.length >= 3);
  assert.equal(claudeFixtures.find((entry) => entry.id === 'default')?.matchPattern, null);
  assert.equal(geminiFixtures.find((entry) => entry.id === 'default')?.matchPattern, null);
  assert.equal(codexFixtures.find((entry) => entry.id === 'default')?.matchPattern, null);
  assert.equal(claudeFixtures.find((entry) => entry.id === 'architecture')?.matchPattern instanceof RegExp, true);
  assert.equal(geminiFixtures.find((entry) => entry.id === 'review')?.matchPattern instanceof RegExp, true);
  assert.equal(codexFixtures.find((entry) => entry.id === 'implementation')?.matchPattern instanceof RegExp, true);
});

describe('classifyPrompt route strategy', () => {
  it('routes a short action prompt through the single-agent path', () => {
    const result = classifyPrompt('fix the typo in README.md');

    assert.equal(result.routeStrategy, 'single');
    assert.equal(result.tandemPair, null);
    assert.equal(result.taskType, 'documentation');
  });

  it('routes a two-phase prompt through the tandem path', () => {
    const result = classifyPrompt('first analyze the auth module then fix the security issues');

    assert.equal(result.routeStrategy, 'tandem');
    assert.deepEqual(result.tandemPair, { lead: 'gemini', follow: 'claude' });
  });

  it('routes a strategic multi-objective prompt through the council path', () => {
    const prompt = [
      'Should we redesign the dispatch pipeline?',
      'Compare single, tandem, and council routing trade-offs.',
      'Decide which strategy is best for reliability.',
      'Make sure we optimize for developer productivity and failure recovery.',
    ].join(' ');

    const result = classifyPrompt(prompt);

    assert.equal(result.routeStrategy, 'council');
    assert.equal(result.tandemPair, null);
    assert.equal(result.tier, 'complex');
  });

  it('handles a prompt on the simple/moderate boundary without throwing', () => {
    const prompt = 'fix auth bug in lib/hydra-utils.mjs before release with focused regression tests today';

    assert.doesNotThrow(() => classifyPrompt(prompt));
    const result = classifyPrompt(prompt);

    assert.ok(['simple', 'moderate', 'complex'].includes(result.tier));
    assert.ok(['single', 'tandem', 'council'].includes(result.routeStrategy));
  });

  it('returns a valid classification object for an empty prompt', () => {
    const result = classifyPrompt('');

    assert.equal(result.tier, 'moderate');
    assert.equal(result.taskType, 'implementation');
    assert.equal(result.suggestedAgent, 'claude');
    assert.equal(typeof result.reason, 'string');
  });
});

describe('selectTandemPair agent pair resolution', () => {
  const expectedPairs = [
    ['implementation', { lead: 'claude', follow: 'codex' }],
    ['review', { lead: 'gemini', follow: 'claude' }],
    ['planning', { lead: 'claude', follow: 'codex' }],
    ['security', { lead: 'gemini', follow: 'claude' }],
    ['architecture', { lead: 'claude', follow: 'gemini' }],
  ];

  for (const [taskType, expectedPair] of expectedPairs) {
    it(`returns ${expectedPair.lead}/${expectedPair.follow} for ${taskType}`, () => {
      assert.deepEqual(
        selectTandemPair(taskType, expectedPair.lead, ALL_AGENTS),
        expectedPair
      );
    });
  }
});

describe('mock agent invocation', () => {
  it('returns the default fixture for an unknown prompt', async () => {
    const result = await mockExecuteAgent('claude', 'unknown random prompt', {});

    assertExecuteResultShape(result);
    assert.equal(result.ok, true);
    assert.match(result.output, /default summary/i);
  });

  it('returns the prompt-matched fixture when the prompt hits a regex', async () => {
    const result = await mockExecuteAgent('claude', 'design the system architecture', {});

    assertExecuteResultShape(result);
    assert.equal(result.ok, true);
    assert.match(result.output, /architecture review/i);
  });

  it('propagates failure fixtures with the full executeAgent result shape', async () => {
    const result = await mockExecuteAgent('gemini', 'trigger_rate_limit', {});

    assertExecuteResultShape(result);
    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.equal(result.error, 'Error: 429 Too Many Requests');
    assert.match(result.stderr, /429/i);
  });

  it('returns codex token usage when the selected fixture includes it', async () => {
    const result = await mockExecuteAgent('codex', 'implement the feature', {});

    assertExecuteResultShape(result);
    assert.equal(result.ok, true);
    assert.deepEqual(result.tokenUsage, {
      inputTokens: 220,
      outputTokens: 140,
      totalTokens: 360,
    });
  });

  it('accepts execution options without using them internally', async () => {
    const result = await mockExecuteAgent('codex', 'write the implementation', {
      cwd: process.cwd(),
      permissionMode: 'read-only',
      timeoutMs: 25_000,
    });

    assertExecuteResultShape(result);
    assert.equal(result.ok, true);
  });

  it('throws for unknown agents instead of returning undefined', async () => {
    await assert.rejects(
      mockExecuteAgent('wizard', 'cast a spell', {}),
      /Unknown mock agent "wizard"/
    );
  });

  it('throws immediately when a fixture map is missing a default entry', () => {
    assert.throws(
      () => createMockExecuteAgent({
        claude: [
          {
            id: 'only',
            matchPattern: 'implement',
            response: makeSuccessResult('No default fixture here'),
          },
        ],
      }),
      /default entry with matchPattern null/i
    );
  });

  it('uses first-match-wins when multiple regex fixtures match the same prompt', async () => {
    const customExec = createMockExecuteAgent({
      claude: [
        {
          id: 'default',
          matchPattern: null,
          response: makeSuccessResult('fallback'),
        },
        {
          id: 'broad',
          matchPattern: 'implement',
          response: makeSuccessResult('broad match wins'),
        },
        {
          id: 'specific',
          matchPattern: 'implement the feature',
          response: makeSuccessResult('specific match loses because it is later'),
        },
      ],
    });

    const result = await customExec('claude', 'implement the feature', {});

    assert.equal(result.output, 'broad match wins');
  });

  it('supports failure factories for ad hoc fixture maps', async () => {
    const customExec = createMockExecuteAgent({
      codex: [
        {
          id: 'default',
          matchPattern: null,
          response: makeFailureResult('synthetic failure', { errorCategory: 'runtime' }),
        },
      ],
    });

    const result = await customExec('codex', 'anything', {});

    assertExecuteResultShape(result);
    assert.equal(result.ok, false);
    assert.equal(result.errorCategory, 'runtime');
  });
});

describe('dispatch pipeline integration', () => {
  it('simulates a full single-route pipeline in process', async () => {
    const prompt = 'fix the typo in README.md';
    const classification = classifyPrompt(prompt);

    assert.equal(classification.routeStrategy, 'single');
    assert.equal(classification.tandemPair, null);

    const result = await mockExecuteAgent(classification.suggestedAgent, prompt, {});

    assertExecuteResultShape(result);
    assert.equal(result.ok, true);
  });

  it('simulates a full tandem pipeline with a threaded lead result', async () => {
    const prompt = 'first analyze the auth module then fix the security issues';
    const classification = classifyPrompt(prompt);
    const tandemPair = selectTandemPair(classification.taskType, classification.suggestedAgent, ALL_AGENTS);

    assert.equal(classification.routeStrategy, 'tandem');
    assert.deepEqual(tandemPair, { lead: 'gemini', follow: 'claude' });

    const leadResult = await mockExecuteAgent(tandemPair.lead, prompt, {});
    const followPrompt = `${leadResult.output}\n\n[follow]\n${prompt}`;
    const followResult = await mockExecuteAgent(tandemPair.follow, followPrompt, {});

    assertExecuteResultShape(leadResult);
    assertExecuteResultShape(followResult);
    assert.equal(leadResult.ok, true);
    assert.equal(followResult.ok, true);
    assert.ok(followPrompt.includes(leadResult.output));
  });

  it('classifies a council prompt without a tandem pair', () => {
    const prompt = [
      'Should we redesign the dispatch pipeline?',
      'Compare single, tandem, and council routing trade-offs.',
      'Decide which strategy is best for reliability.',
      'Make sure we optimize for developer productivity and failure recovery.',
    ].join(' ');

    const result = classifyPrompt(prompt);

    assert.equal(result.routeStrategy, 'council');
    assert.equal(result.tandemPair, null);
  });
});
