const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { format } = require('./l10n');

// Extension-authored row notes. They are stored in English (cache data, guide §2.3);
// refresh-note.js translates them at render time. {0} marks a value filled in here.
const NOTE = Object.freeze({
  missingPath: 'Configured path does not exist',
  noGitEntry: 'No .git entry at this path',
  ownership: 'Git rejected this repository because of ownership',
  gitCannotRead: 'Git cannot read this repository (exit {0})',
  notRoot: 'Path is not this Git repository root',
  noOrigin: 'Expected origin is not configured',
  originMismatch: 'origin URL differs from the repository list',
  remoteNotConfigured: 'Remote {0} is not configured',
  noCommit: 'HEAD has no commit',
  cannotReadStatus: 'Cannot read working tree status',
  detached: 'No current branch to compare',
  timedOut: 'Remote query timed out',
  remoteBranchMissing: '{0} does not exist',
  remoteFailed: 'Remote query failed (Git exit {0})',
  uncommitted: 'Uncommitted changes present',
  unfetched: 'Remote commit is not present locally',
  cannotCompare: 'Cannot compare commit history',
  invalidCompare: 'Invalid commit comparison',
});
const NOTE_TEMPLATES = Object.freeze(Object.values(NOTE));

function runGit(directory, args, { timeoutMs = 10000, signal, remote = false } = {}) {
  return new Promise(resolve => {
    const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    const commandArgs = remote
      ? ['-c', 'credential.interactive=never', '-c', 'http.lowSpeedLimit=1000', '-c', `http.lowSpeedTime=${timeoutSeconds}`, '-C', directory, ...args]
      : ['-C', directory, ...args];
    const child = spawn('git', commandArgs, {
      shell: false,
      windowsHide: true,
      env: remote
        ? { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' }
        : { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let resolved = false;
    const finish = result => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const onAbort = () => { timedOut = true; child.kill(); };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    child.stdout.on('data', data => { stdout += data.toString(); if (stdout.length > 1024 * 1024) child.kill(); });
    child.stderr.on('data', data => { stderr += data.toString(); if (stderr.length > 1024 * 1024) child.kill(); });
    child.on('error', error => finish({ code: -1, stdout, stderr: error.message, timedOut }));
    child.on('close', code => finish({ code: code ?? -1, stdout, stderr, timedOut }));
  });
}

function normalizeRemote(value) {
  return String(value || '').trim().replace(/[\\/]+$/, '').replace(/\.git$/i, '').toLowerCase();
}

function interpretWorktree(result) {
  if (result.code !== 0) return { dirty: null, warning: 'Cannot read working tree status' };
  if (result.stderr.trim()) return { dirty: null, warning: 'Git reported a warning; working tree count is incomplete' };
  return { dirty: result.stdout.split(/\r?\n/).filter(Boolean).length, warning: '' };
}

function baseRow(target) {
  return {
    path: target.path, label: target.label || target.path, group: target.group || '',
    branch: '', compareTarget: '', dirty: 0, worktreeWarning: '', ahead: 0, behind: 0,
    status: '', note: '', localSha: '', remoteSha: '', lastCommit: '',
    checkedAt: new Date().toISOString(), stale: false,
  };
}

async function inspectRepository(target, options = {}) {
  const row = baseRow(target);
  const directory = path.resolve(target.path);
  if (!fs.existsSync(directory)) return { ...row, status: 'MISSING_PATH', note: NOTE.missingPath };
  if (!fs.existsSync(path.join(directory, '.git'))) return { ...row, status: 'NOT_A_REPO', note: NOTE.noGitEntry };
  const local = args => runGit(directory, args, { timeoutMs: 10000, signal: options.signal });
  const top = await local(['rev-parse', '--show-toplevel']);
  if (top.code !== 0) {
    const ownership = /dubious ownership/i.test(top.stderr);
    return { ...row, status: 'LOCAL_ERROR', note: ownership ? NOTE.ownership : format(NOTE.gitCannotRead, [top.code]) };
  }
  const canonicalTop = fs.realpathSync.native(path.resolve(top.stdout.trim()));
  const canonicalDirectory = fs.realpathSync.native(directory);
  const sameRoot = process.platform === 'win32'
    ? canonicalTop.toLowerCase() === canonicalDirectory.toLowerCase()
    : canonicalTop === canonicalDirectory;
  if (!sameRoot) {
    return { ...row, status: 'NOT_A_REPO', note: NOTE.notRoot };
  }
  const branchResult = await local(['symbolic-ref', '--quiet', '--short', 'HEAD']);
  row.branch = branchResult.code === 0 ? branchResult.stdout.trim() : '';
  const origin = await local(['remote', 'get-url', 'origin']);
  if (target.expectedRemote && origin.code !== 0) {
    return { ...row, status: 'NO_REMOTE', note: NOTE.noOrigin };
  }
  if (target.expectedRemote && origin.code === 0 && normalizeRemote(origin.stdout) !== normalizeRemote(target.expectedRemote)) {
    return { ...row, status: 'REMOTE_MISMATCH', note: NOTE.originMismatch };
  }
  const configuredRemote = row.branch ? await local(['config', '--get', `branch.${row.branch}.remote`]) : { code: 1 };
  const configuredMerge = row.branch ? await local(['config', '--get', `branch.${row.branch}.merge`]) : { code: 1 };
  const hasUpstream = configuredRemote.code === 0 && configuredRemote.stdout.trim() !== '.'
    && configuredMerge.code === 0 && configuredMerge.stdout.trim().startsWith('refs/heads/');
  const remoteName = hasUpstream ? configuredRemote.stdout.trim() : 'origin';
  const remoteRef = hasUpstream ? configuredMerge.stdout.trim() : row.branch ? `refs/heads/${row.branch}` : '';
  if (remoteRef) row.compareTarget = `${remoteName}/${remoteRef.slice('refs/heads/'.length)}`;
  const remoteUrl = remoteName === 'origin' ? origin : await local(['remote', 'get-url', remoteName]);
  if (remoteUrl.code !== 0) return { ...row, status: 'NO_REMOTE', note: format(NOTE.remoteNotConfigured, [remoteName]) };
  const head = await local(['rev-parse', 'HEAD']);
  if (head.code !== 0) return { ...row, status: 'NO_COMMITS', note: NOTE.noCommit };
  const localFullSha = head.stdout.trim();
  row.localSha = localFullSha.slice(0, 8);
  const status = await local(['status', '--porcelain']);
  if (status.code !== 0) return { ...row, status: 'LOCAL_ERROR', note: NOTE.cannotReadStatus };
  const worktree = interpretWorktree(status);
  row.dirty = worktree.dirty;
  row.worktreeWarning = worktree.warning;
  const date = await local(['log', '-1', '--date=iso-strict', '--format=%ad']);
  if (date.code === 0) row.lastCommit = date.stdout.trim();
  if (!row.branch) return { ...row, status: 'DETACHED_HEAD', note: NOTE.detached };

  const timeoutMs = options.timeoutMs || 20000;
  const query = await runGit(directory, ['ls-remote', '--exit-code', remoteName, remoteRef], {
    timeoutMs, signal: options.signal, remote: true,
  });
  if (query.timedOut) return { ...row, status: 'REMOTE_UNREACHABLE', note: NOTE.timedOut };
  if (query.code === 2) return { ...row, status: 'REMOTE_BRANCH_MISSING', note: format(NOTE.remoteBranchMissing, [row.compareTarget]) };
  if (query.code !== 0) return { ...row, status: 'REMOTE_UNREACHABLE', note: format(NOTE.remoteFailed, [query.code]) };
  const match = query.stdout.split(/\r?\n/).map(line => line.split(/\s+/)).find(parts => parts[1] === remoteRef && /^[0-9a-f]{40,64}$/i.test(parts[0] || ''));
  if (!match) return { ...row, status: 'REMOTE_BRANCH_MISSING', note: format(NOTE.remoteBranchMissing, [row.compareTarget]) };
  const remoteFullSha = match[0];
  row.remoteSha = remoteFullSha.slice(0, 8);
  if (remoteFullSha === localFullSha) return { ...row, status: 'IN_SYNC', note: row.dirty ? NOTE.uncommitted : '' };
  const object = await local(['cat-file', '-e', `${remoteFullSha}^{commit}`]);
  if (object.code !== 0) return { ...row, status: 'DIFFERS_UNFETCHED', note: NOTE.unfetched };
  const counts = await local(['rev-list', '--left-right', '--count', `HEAD...${remoteFullSha}`]);
  if (counts.code !== 0) return { ...row, status: 'LOCAL_ERROR', note: NOTE.cannotCompare };
  const [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number);
  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) return { ...row, status: 'LOCAL_ERROR', note: NOTE.invalidCompare };
  row.ahead = ahead;
  row.behind = behind;
  row.status = ahead && behind ? 'DIVERGED' : ahead ? 'AHEAD' : behind ? 'BEHIND' : 'IN_SYNC';
  return row;
}

module.exports = { runGit, inspectRepository, normalizeRemote, interpretWorktree, NOTE_TEMPLATES };
