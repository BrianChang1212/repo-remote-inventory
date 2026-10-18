const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { discoverRepositories } = require('../source/discovery');

test('discovers the root and nested Git roots while honoring exclusions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-discover-'));
  try {
    fs.mkdirSync(path.join(root, '.git'));
    fs.mkdirSync(path.join(root, 'projects', 'one', '.git'), { recursive: true });
    fs.mkdirSync(path.join(root, 'node_modules', 'library', '.git'), { recursive: true });
    fs.mkdirSync(path.join(root, 'projects', 'two'), { recursive: true });
    fs.writeFileSync(path.join(root, 'projects', 'two', '.git'), 'gitdir: elsewhere');
    const targets = await discoverRepositories(root, { excludes: ['node_modules'] });
    assert.deepEqual(targets.map(x => x.path).sort(), [root, path.join(root, 'projects', 'one'), path.join(root, 'projects', 'two')].sort());
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('reports an inaccessible child directory while retaining reachable repositories', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-discover-'));
  try {
    fs.mkdirSync(path.join(root, 'visible', '.git'), { recursive: true });
    fs.mkdirSync(path.join(root, 'blocked'));
    const warnings = [];
    const targets = await discoverRepositories(root, {
      readDirectory: async (directory, options) => {
        if (directory === path.join(root, 'blocked')) throw new Error('access denied');
        return fs.promises.readdir(directory, options);
      },
      onWarning: warning => warnings.push(warning),
    });
    assert.deepEqual(targets.map(target => target.label), ['visible']);
    assert.match(warnings.join('\n'), /blocked.*access denied/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
