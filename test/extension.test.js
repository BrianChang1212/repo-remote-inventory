const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start, defaultResolveTargets } = require('../source/extension');

test('opening the view refreshes by default, while manual refresh works when automatic refresh is disabled', async () => {
  const commands = new Map();
  let visibilityChanged;
  let autoRefresh = true;
  let scans = 0;
  const scanOptions = [];
  const view = {
    visible: false,
    onDidChangeVisibility(handler) { visibilityChanged = handler; return { dispose() {} }; },
  };
  const vscode = {
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
    window: { createTreeView: () => view, showErrorMessage: async () => {}, showOpenDialog: async () => [] },
    workspace: {
      workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/workspace' } }],
      getConfiguration: () => ({
        get(key, fallback) { return key === 'autoRefreshOnOpen' ? autoRefresh : fallback; },
        update: async () => {},
      }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
    },
    commands: { registerCommand(name, action) { commands.set(name, action); return { dispose() {} }; } },
  };
  const extension = start(vscode, { subscriptions: [] }, {
    resolveTargets: async () => ({ targets: [{ path: '/workspace/repo', label: 'repo' }], warnings: [] }),
    scanTargets: async (targets, options) => { scans++; scanOptions.push(options); return targets.map(target => ({ ...target, status: 'IN_SYNC' })); },
  });
  visibilityChanged({ visible: true });
  await extension.whenIdle();
  assert.equal(scans, 1);
  autoRefresh = false;
  visibilityChanged({ visible: true });
  await extension.whenIdle();
  assert.equal(scans, 1);
  await commands.get('repoRemoteInventory.refreshAll')();
  assert.equal(scans, 2);
  await commands.get('repoRemoteInventory.refreshRepository')({ path: '/workspace/repo' });
  assert.equal(scans, 3);
  assert.equal(scanOptions[2].onlyPath, '/workspace/repo');
});

test('a repository-list warning remains visible after the scan completes', async () => {
  let visibleHandler;
  const view = { visible: false, onDidChangeVisibility(handler) { visibleHandler = handler; return { dispose() {} }; } };
  const vscode = {
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
    window: { createTreeView: () => view, showErrorMessage: async () => {} },
    workspace: {
      workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/workspace' } }],
      getConfiguration: () => ({ get(_key, fallback) { return fallback; } }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
    },
    commands: { registerCommand: () => ({ dispose() {} }) },
  };
  const extension = start(vscode, { subscriptions: [] }, {
    resolveTargets: async () => ({ targets: [{ path: '/workspace/repo', label: 'repo' }], warnings: ['List count differs.'] }),
    scanTargets: async targets => targets.map(target => ({ ...target, status: 'IN_SYNC' })),
  });
  visibleHandler({ visible: true });
  await extension.whenIdle();
  assert.match(view.message, /List count differs/);
});

test('a relative scan root is resolved from the open local workspace', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-workspace-'));
  try {
    fs.mkdirSync(path.join(workspace, 'sub', '.git'), { recursive: true });
    const vscode = {
      workspace: {
        workspaceFolders: [{ uri: { scheme: 'file', fsPath: workspace } }],
        getConfiguration: () => ({ get(key, fallback) { return key === 'rootPath' ? 'sub' : fallback; } }),
      },
    };
    const result = await defaultResolveTargets(vscode);
    assert.deepEqual(result.targets.map(target => target.path), [path.join(workspace, 'sub')]);
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
});
