/**
 * Shared Guardrails — Safety prompt builder, violation scanner, and branch checks
 * used by both nightly and evolve pipelines.
 *
 * Each pipeline passes its own config (runner name, protected files, extra rules).
 */

import spawn from 'cross-spawn';

/**
 * Verify the current git branch matches the expected branch.
 * @param {string} projectRoot
 * @param {string} expectedBranch
 * @returns {{ ok: boolean, currentBranch: string }}
 */
export function verifyBranch(projectRoot, expectedBranch) {
  const result = spawn.sync('git', ['branch', '--show-current'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 5_000,
  });
  const current = (result.stdout || '').trim();
  return { ok: current === expectedBranch, currentBranch: current };
}

/**
 * Check if working tree is clean.
 * @param {string} projectRoot
 * @returns {boolean}
 */
export function isCleanWorkingTree(projectRoot) {
  const result = spawn.sync('git', ['status', '--porcelain'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 5_000,
  });
  return !(result.stdout || '').trim();
}

/**
 * Build the safety rules block injected into autonomous agent prompts.
 *
 * @param {string} branchName - Current branch name
 * @param {object} opts
 * @param {string} opts.runner - Runner name (e.g., 'nightly runner', 'evolve runner')
 * @param {string} opts.reportName - Report name (e.g., 'morning report', 'session report')
 * @param {Set<string>} opts.protectedFiles - Set of protected file paths
 * @param {string[]} opts.blockedCommands - Array of blocked commands
 * @param {string[]} [opts.extraRules] - Additional scope rules
 * @param {{ pipeline: string, agent?: string }} [opts.attribution] - Commit attribution metadata
 * @returns {string}
 */
export function buildSafetyPrompt(branchName, {
  runner,
  reportName,
  protectedFiles,
  blockedCommands,
  extraRules = [],
  attribution,
}) {
  const extraSection = extraRules.length > 0
    ? '\n' + extraRules.map(r => `- ${r}`).join('\n')
    : '';

  let attributionSection = '';
  if (attribution) {
    const trailerLines = [`Originated-By: ${attribution.pipeline}`];
    if (attribution.agent) trailerLines.push(`Executed-By: ${attribution.agent}`);
    attributionSection = `

### Commit Attribution
- Include these git trailers at the end of every commit message:
${trailerLines.map(t => `  ${t}`).join('\n')}
- Trailers go after a blank line at the end of the commit message body`;
  }

  return `## SAFETY RULES (NON-NEGOTIABLE)
These rules are enforced by the ${runner}. Violations are flagged in the ${reportName}.

### Branch Isolation
- You are on branch: \`${branchName}\`
- ONLY commit to this branch
- NEVER run: git push, git checkout dev, git checkout staging, git checkout main
- NEVER run: git merge into dev/staging/main, git rebase

### Protected Files — DO NOT MODIFY
${[...protectedFiles].map(f => `- \`${f}\``).join('\n')}

### Blocked Commands — NEVER EXECUTE
${blockedCommands.map(c => `- \`${c}\``).join('\n')}

### Scope
- Focus ONLY on your assigned task
- Do NOT fix unrelated issues (note them in your commit message instead)
- Do NOT add documentation, changelog entries, or version bumps
- Do NOT install new npm packages without clear necessity${extraSection}${attributionSection}`;
}

/**
 * Scan a branch's diff against the base branch for guardrail violations.
 *
 * @param {string} projectRoot
 * @param {string} branchName
 * @param {object} opts
 * @param {string} [opts.baseBranch='dev'] - Base branch to diff against
 * @param {Set<string>} opts.protectedFiles - Set of protected file paths
 * @param {RegExp[]} opts.protectedPatterns - Array of protected path patterns
 * @param {boolean} [opts.checkDeletedTests=false] - Whether to flag deleted test files
 * @returns {Array<{type: string, detail: string, severity: string}>}
 */
export function scanBranchViolations(projectRoot, branchName, {
  baseBranch = 'dev',
  protectedFiles,
  protectedPatterns,
  checkDeletedTests = false,
}) {
  const violations = [];

  const diffResult = spawn.sync('git', ['diff', '--name-only', `${baseBranch}...${branchName}`], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 10_000,
  });

  if (diffResult.status !== 0 || !diffResult.stdout) {
    return violations;
  }

  const changedFiles = diffResult.stdout.trim().split('\n').filter(Boolean);

  for (const file of changedFiles) {
    const normalized = file.replace(/\\/g, '/');

    if (protectedFiles.has(normalized)) {
      violations.push({
        type: 'protected_file',
        detail: `Modified protected file: ${file}`,
        severity: 'critical',
      });
    }

    for (const pattern of protectedPatterns) {
      if (pattern.test(normalized)) {
        violations.push({
          type: 'protected_pattern',
          detail: `Modified file matching protected pattern: ${file}`,
          severity: 'warning',
        });
        break;
      }
    }
  }

  if (checkDeletedTests) {
    const deletedResult = spawn.sync('git', ['diff', '--name-only', '--diff-filter=D', `${baseBranch}...${branchName}`], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 10_000,
    });

    if (deletedResult.status === 0 && deletedResult.stdout) {
      const deletedFiles = deletedResult.stdout.trim().split('\n').filter(Boolean);
      for (const file of deletedFiles) {
        if (/\.test\.|\.spec\.|__tests__/.test(file)) {
          violations.push({
            type: 'deleted_test',
            detail: `Deleted test file: ${file}`,
            severity: 'critical',
          });
        }
      }
    }
  }

  return violations;
}
