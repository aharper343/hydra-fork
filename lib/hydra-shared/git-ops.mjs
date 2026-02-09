/**
 * Shared Git Helpers — Common git operations for nightly and evolve pipelines.
 *
 * Adopts evolve's parameterized versions as the superset.
 * Nightly callers simply pass baseBranch='dev'.
 */

import { spawnSync } from 'child_process';

/**
 * Run a git command synchronously.
 * @param {string[]} args - Git arguments
 * @param {string} cwd - Working directory
 * @returns {import('child_process').SpawnSyncReturns<string>}
 */
export function git(args, cwd) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
    shell: process.platform === 'win32',
  });
}

/**
 * Get the current branch name.
 * @param {string} cwd
 * @returns {string}
 */
export function getCurrentBranch(cwd) {
  const r = git(['branch', '--show-current'], cwd);
  return (r.stdout || '').trim();
}

/**
 * Checkout a branch.
 * @param {string} cwd
 * @param {string} branch
 */
export function checkoutBranch(cwd, branch) {
  return git(['checkout', branch], cwd);
}

/**
 * Check if a branch exists.
 * @param {string} cwd
 * @param {string} branchName
 * @returns {boolean}
 */
export function branchExists(cwd, branchName) {
  const r = git(['rev-parse', '--verify', branchName], cwd);
  return r.status === 0;
}

/**
 * Create a new branch from a base branch. Deletes stale branch if it exists.
 * @param {string} cwd
 * @param {string} branchName
 * @param {string} fromBranch
 * @returns {boolean} success
 */
export function createBranch(cwd, branchName, fromBranch) {
  if (branchExists(cwd, branchName)) {
    git(['branch', '-D', branchName], cwd);
  }
  const r = git(['checkout', '-b', branchName, fromBranch], cwd);
  return r.status === 0;
}

/**
 * Check if a branch has commits beyond baseBranch.
 * @param {string} cwd
 * @param {string} branchName
 * @param {string} [baseBranch='dev']
 * @returns {boolean}
 */
export function branchHasCommits(cwd, branchName, baseBranch = 'dev') {
  const r = git(['log', `${baseBranch}..${branchName}`, '--oneline'], cwd);
  return (r.stdout || '').trim().length > 0;
}

/**
 * Get commit count and files changed for a branch vs base.
 * @param {string} cwd
 * @param {string} branchName
 * @param {string} [baseBranch='dev']
 * @returns {{ commits: number, filesChanged: number }}
 */
export function getBranchStats(cwd, branchName, baseBranch = 'dev') {
  const logResult = git(['log', `${baseBranch}..${branchName}`, '--oneline'], cwd);
  const commits = (logResult.stdout || '').trim().split('\n').filter(Boolean).length;

  const diffResult = git(['diff', '--stat', `${baseBranch}...${branchName}`], cwd);
  const statLines = (diffResult.stdout || '').trim().split('\n').filter(Boolean);
  const filesChanged = Math.max(0, statLines.length - 1);

  return { commits, filesChanged };
}

/**
 * Get the full diff between a branch and its base.
 * @param {string} cwd
 * @param {string} branchName
 * @param {string} [baseBranch='dev']
 * @returns {string}
 */
export function getBranchDiff(cwd, branchName, baseBranch = 'dev') {
  const r = git(['diff', `${baseBranch}...${branchName}`], cwd);
  return (r.stdout || '').trim();
}

/**
 * Stage all changes and commit.
 * @param {string} cwd
 * @param {string} message
 * @returns {boolean} success
 */
export function stageAndCommit(cwd, message) {
  git(['add', '-A'], cwd);
  const r = git(['commit', '-m', message, '--allow-empty'], cwd);
  return r.status === 0;
}

/**
 * Smart merge: rebase-first strategy with conflict detection.
 * @param {string} cwd
 * @param {string} branchName
 * @param {string} baseBranch
 * @param {{ log?: { info: Function, ok: Function, warn: Function } }} [opts]
 * @returns {{ ok: boolean, method: string, conflicts: string[] }}
 */
export function smartMerge(cwd, branchName, baseBranch, opts = {}) {
  const _log = opts.log || { info: () => {}, ok: () => {}, warn: () => {} };

  const isAncestor = git(['merge-base', '--is-ancestor', baseBranch, branchName], cwd);
  const baseDiverged = isAncestor.status !== 0;

  if (baseDiverged) {
    _log.info(`Base branch '${baseBranch}' has diverged — attempting rebase...`);

    const rebase = git(['rebase', baseBranch, branchName], cwd);
    if (rebase.status !== 0) {
      git(['rebase', '--abort'], cwd);
      _log.warn('Rebase had conflicts — falling back to merge...');
    } else {
      _log.ok(`Rebased ${branchName} onto ${baseBranch}`);
      checkoutBranch(cwd, baseBranch);
      const ff = git(['merge', branchName, '--ff-only'], cwd);
      if (ff.status === 0) {
        return { ok: true, method: 'rebase+ff', conflicts: [] };
      }
    }
  }

  checkoutBranch(cwd, baseBranch);
  const merge = git(['merge', branchName, '--no-edit'], cwd);
  if (merge.status === 0) {
    return { ok: true, method: baseDiverged ? 'merge' : 'fast-forward', conflicts: [] };
  }

  const conflictFiles = git(['diff', '--name-only', '--diff-filter=U'], cwd);
  const conflicts = (conflictFiles.stdout || '').trim().split('\n').filter(Boolean);
  git(['merge', '--abort'], cwd);

  return { ok: false, method: 'failed', conflicts };
}

// ── Review-specific git helpers ─────────────────────────────────────────────

/**
 * List branches matching a prefix pattern.
 * @param {string} cwd
 * @param {string} prefix - e.g. 'nightly' or 'evolve'
 * @param {string|null} [dateFilter]
 * @returns {string[]}
 */
export function listBranches(cwd, prefix, dateFilter = null) {
  const pattern = dateFilter ? `${prefix}/${dateFilter}/*` : `${prefix}/*`;
  const r = git(['branch', '--list', pattern], cwd);
  if (!r.stdout) return [];
  return r.stdout
    .split('\n')
    .map((b) => b.trim().replace(/^\*\s*/, ''))
    .filter(Boolean);
}

/**
 * Get diff stat for a branch vs base.
 * @param {string} cwd
 * @param {string} branch
 * @param {string} [baseBranch='dev']
 * @returns {string}
 */
export function getBranchDiffStat(cwd, branch, baseBranch = 'dev') {
  const r = git(['diff', '--stat', `${baseBranch}...${branch}`], cwd);
  return (r.stdout || '').trim();
}

/**
 * Get one-line commit log for a branch vs base.
 * @param {string} cwd
 * @param {string} branch
 * @param {string} [baseBranch='dev']
 * @returns {string}
 */
export function getBranchLog(cwd, branch, baseBranch = 'dev') {
  const r = git(['log', `${baseBranch}..${branch}`, '--oneline', '--no-decorate'], cwd);
  return (r.stdout || '').trim();
}

/**
 * Merge a branch into the current branch (or baseBranch).
 * @param {string} cwd
 * @param {string} branch
 * @param {string} [baseBranch='dev']
 * @returns {boolean} success
 */
export function mergeBranch(cwd, branch, baseBranch = 'dev') {
  const current = getCurrentBranch(cwd);
  if (current !== baseBranch) {
    git(['checkout', baseBranch], cwd);
  }
  const r = git(['merge', branch, '--no-edit'], cwd);
  return r.status === 0;
}

/**
 * Delete a branch (force).
 * @param {string} cwd
 * @param {string} branch
 * @returns {boolean} success
 */
export function deleteBranch(cwd, branch) {
  const r = git(['branch', '-D', branch], cwd);
  return r.status === 0;
}
