const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start: realStart, defaultResolveTargets } = require('../source/extension');
const { format } = require('../source/l10n');
const zhBundle = require('../l10n/bundle.l10n.zh-tw.json');

test('notifications, sidebar status, panel title, and webview HTML go through vscode.l10n.t', async () => {
  const calls = [];
  const errors = [];
  let panel;
  const view = { visible: false, onDidChangeVisibility() { return { dispose() {} }; } };
  const vscode = {
    l10n: { t(message, ...args) { calls.push(message); return format(zhBundle[message] ?? message, args); } },
    env: { language: 'zh-tw' },
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
    window: {
      createTreeView: () => view,
      showErrorMessage: async message => { errors.push(message); },
      createWebviewPanel: (_id, title) => {
        panel = { title, webview: { cspSource: 'vscode-webview:', postMessage: async () => {}, onDidReceiveMessage: () => ({ dispose() {} }) }, reveal() {}, onDidDispose() {}, onDidChangeViewState: () => ({ dispose() {} }) };
        return panel;
      },
    },
    workspace: {
      workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/workspace' } }],
      getConfiguration: () => ({ get(key, fallback) { return key === 'autoRefreshOnOpen' ? false : fallback; } }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
    },
    commands: { executeCommand: async () => {}, registerCommand: () => ({ dispose() {} }) },
    ViewColumn: { Active: -1 },
  };
  const extension = start(vscode, { subscriptions: [] }, {
    resolveTargets: async () => { throw new Error('fatal: not a git repository'); },
  });
  assert.match(view.webview.html, /<html lang="zh-Hant">/);
  assert.match(view.webview.html, new RegExp(zhBundle['Refresh all']));
  await extension.refreshAll();
  assert.ok(calls.includes('Repo Remote Inventory: {0}'));
  assert.deepEqual(errors, [format(zhBundle['Repo Remote Inventory: {0}'], ['fatal: not a git repository'])]);
  assert.equal(view.message, format(zhBundle['Refresh failed: {0}'], ['fatal: not a git repository']));
  extension.openDashboard();
  assert.equal(panel.title, zhBundle['Repository Inventory']);
  assert.match(panel.webview.html, /<html lang="zh-Hant">/);
  assert.match(panel.webview.html, new RegExp(zhBundle['Clear filter']));

  const remote = { ...vscode, workspace: { ...vscode.workspace, workspaceFolders: [{ uri: { scheme: 'vscode-remote', fsPath: '/x' } }] } };
  await assert.rejects(defaultResolveTargets(remote), { message: zhBundle['Remote workspaces are not supported in this release. Choose a local scan directory.'] });
});

function start(vscode, context, dependencies) {
  const view = vscode.window.createTreeView();
  const onDidChangeVisibility = view.onDidChangeVisibility.bind(view);
  view.onDidChangeVisibility = handler => onDidChangeVisibility(event => {
    view.visible = event.visible;
    handler(event);
  });
  view.webview = {
    cspSource: 'vscode-webview:',
    postMessage(message) {
      if (message.type === 'state') {
        view.message = message.message;
        view.description = message.autoMode ? 'Auto' : 'Manual';
      }
      return Promise.resolve(true);
    },
    onDidReceiveMessage: () => ({ dispose() {} }),
  };
  vscode.window.registerWebviewViewProvider = (_id, provider) => {
    provider.resolveWebviewView(view);
    view.webview.onDidReceiveMessageHandler?.({ command: 'ready' });
    return { dispose() {} };
  };
  view.webview.onDidReceiveMessage = handler => {
    view.webview.onDidReceiveMessageHandler = handler;
    return { dispose() {} };
  };
  return realStart(vscode, context, dependencies);
}

test('opening the view refreshes by default, while manual refresh works when automatic refresh is disabled', async () => {
  const commands = new Map();
  let visibilityChanged;
  let autoRefresh = true;
  let scans = 0;
  const scanOptions = [];
  let holdNext = false;
  let releaseScan;
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
        update: async (_key, value) => { autoRefresh = value; },
      }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
    },
    commands: { executeCommand: async () => {}, registerCommand(name, action) { commands.set(name, action); return { dispose() {} }; } },
    ConfigurationTarget: { Global: 1 },
  };
  const extension = start(vscode, { subscriptions: [] }, {
    resolveTargets: async () => ({ targets: [{ path: '/workspace/repo', label: 'repo' }], warnings: [] }),
    scanTargets: async (targets, options) => {
      scans++; scanOptions.push(options);
      if (holdNext) await new Promise(resolve => { releaseScan = resolve; });
      return targets.map(target => ({ ...target, status: 'IN_SYNC' }));
    },
  });
  visibilityChanged({ visible: true });
  await extension.whenIdle();
  assert.equal(scans, 1);
   await commands.get('repoRemoteInventory.toggleAutoRefresh')();
  visibilityChanged({ visible: true });
  await extension.whenIdle();
  assert.equal(scans, 1);
  await commands.get('repoRemoteInventory.refreshAll')();
  assert.equal(scans, 2);
  await commands.get('repoRemoteInventory.refreshRepository')({ path: '/workspace/repo' });
  assert.equal(scans, 3);
  assert.equal(scanOptions[2].onlyPath, '/workspace/repo');
  holdNext = true;
  const fullRefresh = commands.get('repoRemoteInventory.refreshAll')();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(commands.get('repoRemoteInventory.refreshAll')(), fullRefresh);
  assert.equal(extension.provider.rows[0].stale, true);
  void commands.get('repoRemoteInventory.refreshRepository')({ path: '/workspace/repo' });
  void commands.get('repoRemoteInventory.refreshRepository')({ path: '/workspace/repo' });
  assert.deepEqual(scanOptions[3].priority, ['/workspace/repo']);
  releaseScan();
  await fullRefresh;
  assert.equal(scans, 4);
});

test('a repository-list warning remains visible after the scan completes', async () => {
  let visibleHandler;
  const view = { visible: false, onDidChangeVisibility(handler) { visibleHandler = handler; return { dispose() {} }; } };
  const vscode = {
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
    window: {
      createTreeView: () => view, showErrorMessage: async () => {},
      createWebviewPanel: () => ({ webview: { cspSource: 'vscode-webview:', postMessage: async () => {}, onDidReceiveMessage: () => ({ dispose() {} }) }, reveal() {}, onDidDispose() {}, onDidChangeViewState: () => ({ dispose() {} }) }),
    },
    workspace: {
      workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/workspace' } }],
      getConfiguration: () => ({ get(_key, fallback) { return fallback; } }),
      onDidChangeConfiguration: () => ({ dispose() {} }),
    },
    commands: { executeCommand: async () => {}, registerCommand: () => ({ dispose() {} }) },
    ViewColumn: { Active: -1 },
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

test('manual to automatic switch persists globally and immediately refreshes', async () => {
  const commands = new Map();
  let mode = false;
  let scans = 0;
  const saved = new Map();
  let panel;
  const config = { get(key, fallback) { return key === 'autoRefreshOnOpen' ? mode : fallback; }, async update(_key, value, target) { assert.equal(target, 1); mode = value; } };
  const view = { visible: false, onDidChangeVisibility() { return { dispose() {} }; } };
  const vscode = {
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
    window: { createTreeView: () => view, showErrorMessage: async () => {}, createWebviewPanel: (_id, _title, _column, options) => {
      panel = { options, webview: { cspSource: 'vscode-webview:', postMessage: async () => {}, onDidReceiveMessage: () => ({ dispose() {} }) }, reveal() {}, onDidDispose: () => ({ dispose() {} }), onDidChangeViewState: () => ({ dispose() {} }) };
      return panel;
    } },
    workspace: { workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/workspace' } }], getConfiguration: () => config, onDidChangeConfiguration: () => ({ dispose() {} }) },
    commands: { executeCommand: async () => {}, registerCommand(name, action) { commands.set(name, action); return { dispose() {} }; } },
    ConfigurationTarget: { Global: 1 },
    ViewColumn: { Active: -1 },
  };
  const extension = start(vscode, { subscriptions: [], globalState: { get: key => saved.get(key), update: async (key, value) => saved.set(key, value) } }, {
    resolveTargets: async () => ({ targets: [{ path: '/repo' }], warnings: [] }),
    scanTargets: async targets => { scans++; return targets.map(target => ({ ...target, status: 'IN_SYNC', checkedAt: '2026-10-20T00:00:00Z' })); },
  });
  await commands.get('repoRemoteInventory.enableAutoRefresh')();
  await extension.whenIdle();
  assert.equal(mode, true);
  assert.equal(view.description, 'Auto');
  assert.equal(scans, 1);
  assert.equal(saved.size, 1);
  assert.equal(saved.values().next().value[0].status, 'IN_SYNC');
  extension.openDashboard();
  assert.equal(panel.options.enableScripts, true);
});

test('opening the dashboard during a sidebar scan shares the in-flight scan', async () => {
  let visibility;
  let scans = 0;
  let releaseScan;
  const view = { visible: false, onDidChangeVisibility(handler) { visibility = handler; return { dispose() {} }; } };
  const vscode = {
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
    window: { createTreeView: () => view, showErrorMessage: async () => {}, createWebviewPanel: () => ({ webview: { cspSource: 'vscode-webview:', postMessage: async () => {}, onDidReceiveMessage: () => ({ dispose() {} }) }, reveal() {}, onDidDispose() {}, onDidChangeViewState: () => ({ dispose() {} }) }) },
    workspace: { workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/workspace' } }], getConfiguration: () => ({ get: (_key, fallback) => fallback }), onDidChangeConfiguration: () => ({ dispose() {} }) },
    commands: { executeCommand: async () => {}, registerCommand: () => ({ dispose() {} }) },
    ViewColumn: { Active: -1 },
  };
  const extension = start(vscode, { subscriptions: [], globalState: { get: () => [], update: async () => {} } }, {
    resolveTargets: async () => ({ targets: [{ path: '/repo' }], warnings: [] }),
    scanTargets: async targets => { scans++; await new Promise(resolve => { releaseScan = resolve; }); return targets.map(target => ({ ...target, status: 'IN_SYNC' })); },
  });
  visibility({ visible: true });
  extension.openDashboard();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scans, 1);
  releaseScan();
  await extension.whenIdle();
  assert.equal(scans, 1);
});

test('reselecting a hidden dashboard refreshes again in auto mode', async () => {
  let viewStateChanged;
  let scans = 0;
  const view = { visible: false, onDidChangeVisibility() { return { dispose() {} }; } };
  const panel = {
    visible: true,
    webview: { cspSource: 'vscode-webview:', postMessage: async () => {}, onDidReceiveMessage: () => ({ dispose() {} }) },
    reveal() {},
    onDidDispose() {},
    onDidChangeViewState(handler) { viewStateChanged = handler; return { dispose() {} }; },
  };
  const vscode = {
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
    window: { createTreeView: () => view, showErrorMessage: async () => {}, createWebviewPanel: () => panel },
    workspace: { workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/workspace' } }], getConfiguration: () => ({ get: (_key, fallback) => fallback }), onDidChangeConfiguration: () => ({ dispose() {} }) },
    commands: { executeCommand: async () => {}, registerCommand: () => ({ dispose() {} }) },
    ViewColumn: { Active: -1 },
  };
  const extension = start(vscode, { subscriptions: [], globalState: { get: () => [], update: async () => {} } }, {
    resolveTargets: async () => ({ targets: [{ path: '/repo' }], warnings: [] }),
    scanTargets: async targets => { scans++; return targets.map(target => ({ ...target, status: 'IN_SYNC' })); },
  });
  extension.openDashboard();
  await extension.whenIdle();
  assert.equal(scans, 1);
  panel.visible = false;
  viewStateChanged({ webviewPanel: panel });
  assert.equal(scans, 1);
  panel.visible = true;
  viewStateChanged({ webviewPanel: panel });
  await extension.whenIdle();
  assert.equal(scans, 2);
});

test('manual startup restores a stale snapshot without resolving targets or querying remotes', async () => {
  const cached = [{ path: '/repo', status: 'IN_SYNC', checkedAt: '2026-10-19T12:00:00Z' }];
  let resolved = 0;
  const view = { visible: false, onDidChangeVisibility() { return { dispose() {} }; } };
  const vscode = {
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
    window: { createTreeView: () => view, showErrorMessage: async () => {}, createWebviewPanel: () => ({ webview: { cspSource: 'vscode-webview:', postMessage: async () => {}, onDidReceiveMessage: () => ({ dispose() {} }) }, reveal() {}, onDidDispose() {}, onDidChangeViewState: () => ({ dispose() {} }) }) },
    workspace: { workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/workspace' } }], getConfiguration: () => ({ get(key, fallback) { return key === 'autoRefreshOnOpen' ? false : fallback; } }), onDidChangeConfiguration: () => ({ dispose() {} }) },
    commands: { executeCommand: async () => {}, registerCommand: () => ({ dispose() {} }) },
    ViewColumn: { Active: -1 },
  };
  const extension = start(vscode, { subscriptions: [], globalState: { get: async () => cached, update: async () => {} } }, {
    resolveTargets: async () => { resolved++; return { targets: [], warnings: [] }; },
    scanTargets: async () => { throw new Error('manual mode must not query'); },
  });
  assert.equal(view.description, 'Manual');
  await extension.whenIdle();
  extension.openDashboard();
  await extension.whenIdle();
  assert.equal(resolved, 0);
  assert.equal(extension.provider.rows[0].stale, true);
  assert.equal(extension.provider.rows[0].checkedAt, cached[0].checkedAt);
});

test('changing scan root in manual mode replaces the view with that scope cache only', async () => {
  let root = '/workspace/one';
  let changed;
  let cacheRead = 0;
  let targetResolutions = 0;
  const view = { visible: false, onDidChangeVisibility() { return { dispose() {} }; } };
  const vscode = {
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
    window: { createTreeView: () => view, showErrorMessage: async () => {} },
    workspace: {
      workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/workspace' } }],
      getConfiguration: () => ({ get(key, fallback) { return key === 'rootPath' ? root : key === 'autoRefreshOnOpen' ? false : fallback; } }),
      onDidChangeConfiguration(handler) { changed = handler; return { dispose() {} }; },
    },
    commands: { executeCommand: async () => {}, registerCommand: () => ({ dispose() {} }) },
  };
  const extension = start(vscode, { subscriptions: [], globalState: { get: async () => (++cacheRead === 1 ? [{ path: '/one', label: 'one', status: 'IN_SYNC', lastSuccessAt: '2026-10-19T00:00:00Z' }] : [{ path: '/two', label: 'two', status: 'AHEAD', lastSuccessAt: '2026-10-20T00:00:00Z' }]), update: async () => {} } }, {
    resolveTargets: async () => { targetResolutions++; return { targets: [], warnings: [] }; },
  });
  await extension.whenIdle();
  assert.equal(extension.provider.rows[0].label, 'one');
  root = '/workspace/two';
  changed({ affectsConfiguration: key => key === 'repoRemoteInventory.rootPath' });
  await extension.whenIdle();
  assert.equal(extension.provider.rows.length, 1);
  assert.equal(extension.provider.rows[0].label, 'two');
  assert.equal(extension.provider.rows[0].stale, true);
  assert.equal(targetResolutions, 0);
});

test('a delayed cache read from an older scope cannot replace the latest scope', async () => {
  let root = '/workspace/one';
  let changed;
  let read = 0;
  let releaseOldRead;
  const view = { visible: false, onDidChangeVisibility() { return { dispose() {} }; } };
  const vscode = {
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
    window: { createTreeView: () => view, showErrorMessage: async () => {} },
    workspace: {
      workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/workspace' } }],
      getConfiguration: () => ({ get(key, fallback) { return key === 'rootPath' ? root : key === 'autoRefreshOnOpen' ? false : fallback; } }),
      onDidChangeConfiguration(handler) { changed = handler; return { dispose() {} }; },
    },
    commands: { executeCommand: async () => {}, registerCommand: () => ({ dispose() {} }) },
  };
  const extension = start(vscode, { subscriptions: [], globalState: {
    get: async () => {
      read++;
      if (read === 1) return [{ path: '/one', label: 'one', status: 'IN_SYNC' }];
      if (read === 2) return new Promise(resolve => { releaseOldRead = resolve; });
      return [{ path: '/three', label: 'three', status: 'BEHIND' }];
    }, update: async () => {},
  } }, {});
  await extension.whenIdle();
  root = '/workspace/two';
  changed({ affectsConfiguration: key => key === 'repoRemoteInventory.rootPath' });
  root = '/workspace/three';
  changed({ affectsConfiguration: key => key === 'repoRemoteInventory.rootPath' });
  await extension.whenIdle();
  releaseOldRead([{ path: '/two', label: 'two', status: 'AHEAD' }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(extension.provider.rows[0].label, 'three');
});

test('choosing a new root waits for an old scan and then scans the new root', async () => {
  let root = '/workspace/one';
  let changed;
  let scanCount = 0;
  const releases = [];
  const commands = new Map();
  const view = { visible: false, onDidChangeVisibility() { return { dispose() {} }; } };
  const config = {
    get(key, fallback) { return key === 'rootPath' ? root : key === 'autoRefreshOnOpen' ? false : fallback; },
    async update(key, value) { root = value; changed({ affectsConfiguration: name => name === `repoRemoteInventory.${key}` }); },
  };
  const vscode = {
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
    window: { createTreeView: () => view, showErrorMessage: async () => {}, showOpenDialog: async () => [{ fsPath: '/workspace/two' }] },
    workspace: { workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/workspace' } }], getConfiguration: () => config, onDidChangeConfiguration(handler) { changed = handler; return { dispose() {} }; } },
    commands: { executeCommand: async () => {}, registerCommand(name, action) { commands.set(name, action); return { dispose() {} }; } },
    ConfigurationTarget: { Global: 1 },
  };
  const extension = start(vscode, { subscriptions: [], globalState: { get: () => [], update: async () => {} } }, {
    resolveTargets: async () => ({ targets: [{ path: root }], warnings: [] }),
    scanTargets: async targets => {
      scanCount++;
      await new Promise(resolve => releases.push(resolve));
      return targets.map(target => ({ ...target, status: 'IN_SYNC' }));
    },
  });
  const oldScan = extension.refreshAll();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scanCount, 1);
  const choosing = commands.get('repoRemoteInventory.chooseRoot')();
  releases[0]();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scanCount, 2);
  releases[1]();
  await Promise.all([oldScan, choosing]);
  assert.equal(extension.provider.rows[0].path, '/workspace/two');
});
