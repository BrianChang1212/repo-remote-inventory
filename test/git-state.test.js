const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { inspectRepository, runGit, interpretWorktree } = require('../source/git-state');

test('treats a successful Git status with unreadable directories as incomplete', () => {
  const result = interpretWorktree({ code: 0, stdout: '', stderr: 'warning: could not open directory: Permission denied' });
  assert.equal(result.dirty, null);
  assert.match(result.warning, /incomplete/i);
});

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

test('compares live remote state without changing tracking refs or the worktree', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-git-'));
  try {
    const bare = path.join(root, 'remote.git');
    const repo = path.join(root, 'repo');
    const other = path.join(root, 'other');
    fs.mkdirSync(bare); fs.mkdirSync(repo);
    git(root, 'init', '--bare', bare);
    git(root, 'init', '-b', 'main', repo);
    git(repo, 'config', 'user.name', 'Fixture');
    git(repo, 'config', 'user.email', 'fixture@example.invalid');
    fs.writeFileSync(path.join(repo, 'file.txt'), 'base\n');
    git(repo, 'add', 'file.txt'); git(repo, 'commit', '-m', 'base');
    git(repo, 'remote', 'add', 'origin', bare);
    git(repo, 'push', '-u', 'origin', 'main');
    const indexBefore = fs.statSync(path.join(repo, '.git', 'index')).mtimeMs;
    const top = await runGit(repo, ['rev-parse', '--show-toplevel']);
    assert.equal(fs.realpathSync.native(path.resolve(top.stdout.trim())).toLowerCase(), fs.realpathSync.native(repo).toLowerCase(), JSON.stringify(top));
    const target = { path: repo, label: 'repo', group: '', expectedRemote: bare };
    let state = await inspectRepository(target, { timeoutMs: 5000 });
    assert.equal(state.status, 'IN_SYNC', JSON.stringify(state));
    assert.equal(fs.statSync(path.join(repo, '.git', 'index')).mtimeMs, indexBefore);
    assert.equal(state.compareTarget, 'origin/main');
    assert.equal(state.dirty, 0);
    fs.writeFileSync(path.join(repo, 'untracked.txt'), 'work');
    state = await inspectRepository(target, { timeoutMs: 5000 });
    assert.equal(state.status, 'IN_SYNC');
    assert.equal(state.dirty, 1);
    fs.writeFileSync(path.join(repo, 'file.txt'), 'ahead\n');
    git(repo, 'add', 'file.txt'); git(repo, 'commit', '-m', 'ahead');
    state = await inspectRepository(target, { timeoutMs: 5000 });
    assert.equal(state.status, 'AHEAD');
    assert.equal(state.ahead, 1);
    assert.equal(state.behind, 0);
    git(root, 'clone', '-b', 'main', bare, other);
    git(other, 'config', 'user.name', 'Fixture');
    git(other, 'config', 'user.email', 'fixture@example.invalid');
    fs.writeFileSync(path.join(other, 'file.txt'), 'remote\n');
    git(other, 'add', 'file.txt'); git(other, 'commit', '-m', 'remote');
    git(other, 'push', 'origin', 'main');
    const trackingBefore = git(repo, 'rev-parse', 'refs/remotes/origin/main');
    state = await inspectRepository(target, { timeoutMs: 5000 });
    assert.equal(state.status, 'DIFFERS_UNFETCHED');
    assert.equal(git(repo, 'rev-parse', 'refs/remotes/origin/main'), trackingBefore);
    assert.equal(git(repo, 'status', '--porcelain').split(/\r?\n/).length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('reports missing and mismatched remotes without querying them', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-git-'));
  try {
    git(root, 'init', '-b', 'main');
    assert.equal((await inspectRepository({ path: root, label: '.' })).status, 'NO_REMOTE');
    git(root, 'config', 'user.name', 'Fixture');
    git(root, 'config', 'user.email', 'fixture@example.invalid');
    fs.writeFileSync(path.join(root, 'file.txt'), 'one');
    git(root, 'add', 'file.txt'); git(root, 'commit', '-m', 'one');
    const target = { path: root, label: '.', expectedRemote: '' };
    const missing = await inspectRepository(target);
    assert.equal(missing.status, 'NO_REMOTE', JSON.stringify(missing));
    git(root, 'remote', 'add', 'origin', path.join(root, 'unknown.git'));
    assert.equal((await inspectRepository({ ...target, expectedRemote: 'https://example.com/repo.git' })).status, 'REMOTE_MISMATCH');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('uses an upstream branch name that differs from the local branch', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-git-'));
  try {
    const bare = path.join(root, 'remote.git');
    const repo = path.join(root, 'repo');
    fs.mkdirSync(bare); fs.mkdirSync(repo);
    git(root, 'init', '--bare', bare);
    git(root, 'init', '-b', 'main', repo);
    git(repo, 'config', 'user.name', 'Fixture');
    git(repo, 'config', 'user.email', 'fixture@example.invalid');
    fs.writeFileSync(path.join(repo, 'file.txt'), 'one');
    git(repo, 'add', 'file.txt'); git(repo, 'commit', '-m', 'one');
    git(repo, 'remote', 'add', 'origin', bare);
    git(repo, 'push', '-u', 'origin', 'main');
    git(repo, 'branch', '-m', 'local-work');
    git(repo, 'config', 'branch.local-work.remote', 'origin');
    git(repo, 'config', 'branch.local-work.merge', 'refs/heads/main');
    const row = await inspectRepository({ path: repo, label: 'repo' }, { timeoutMs: 5000 });
    assert.equal(row.status, 'IN_SYNC');
    assert.equal(row.branch, 'local-work');
    assert.equal(row.compareTarget, 'origin/main');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
