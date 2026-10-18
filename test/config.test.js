const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadRepositoryList } = require('../source/config');

test('loads the Brian list schema against a chosen root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-config-'));
  try {
    const list = path.join(root, 'repo_paths.json');
    fs.writeFileSync(list, JSON.stringify({ expected_repo_count: 2, repos: [
      { path: '.', group: 'governance', remote: 'https://example.com/root.git' },
      { path: 'projects/one', group: 'dated-project' },
    ] }));
    const result = loadRepositoryList(list, root);
    assert.deepEqual(result.targets.map(x => x.path), [root, path.join(root, 'projects', 'one')]);
    assert.equal(result.targets[0].expectedRemote, 'https://example.com/root.git');
    assert.equal(result.targets[1].group, 'dated-project');
    assert.deepEqual(result.warnings, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('rejects duplicate and escaping list paths instead of scanning another directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-config-'));
  try {
    const list = path.join(root, 'repo_paths.json');
    fs.writeFileSync(list, JSON.stringify({ repos: [{ path: '../outside' }] }));
    assert.throws(() => loadRepositoryList(list, root), /outside root/i);
    fs.writeFileSync(list, JSON.stringify({ repos: [{ path: 'one' }, { path: 'one' }] }));
    assert.throws(() => loadRepositoryList(list, root), /duplicate/i);
    assert.throws(() => loadRepositoryList(path.join(root, 'missing.json'), root), /ENOENT/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
