const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { sidebarHtml } = require('../source/sidebar');
const { start } = require('../source/extension');

test('sidebar renders a keyboard accessible graphite and green card interface', () => {
  const html = sidebarHtml({ cspSource: 'vscode-webview:' }, true);
  assert.match(html, /#76b900/);
  assert.match(html, /<details/);
  assert.match(html, /<summary/);
  assert.match(html, /id="mode"/);
  assert.match(html, /id="refresh"/);
  assert.match(html, /id="dashboard"/);
  assert.match(html, /Content-Security-Policy/);
});

test('sidebar rows escape repository text, preserve stale state, and refresh only a chosen repository', () => {
  const html = sidebarHtml({ cspSource: 'vscode-webview:' }, false);
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  const elements = new Map(['#repositories', '#summary', '#mode', '#status'].map(id => [id, { innerHTML: '', textContent: '', setAttribute() {} }]));
  const posted = [];
  let onMessage;
  const document = {
    querySelector: id => elements.get(id),
    addEventListener(type, handler) { if (type === 'click') this.onClick = handler; },
  };
  vm.runInNewContext(script, {
    document,
    window: { addEventListener(type, handler) { if (type === 'message') onMessage = handler; } },
    acquireVsCodeApi: () => ({ postMessage: message => posted.push(message) }),
  });
  onMessage({ data: { type: 'state', rows: [{ path: '/repo', label: '<img src=x>', status: 'IN_SYNC', stale: true, dirty: 2, branch: 'main' }], autoMode: false, message: 'Cached snapshot' } });
  assert.match(elements.get('#repositories').innerHTML, /&lt;img src=x&gt;/);
  assert.doesNotMatch(elements.get('#repositories').innerHTML, /<img/);
  assert.match(elements.get('#repositories').innerHTML, /STALE/);
  assert.match(elements.get('#repositories').innerHTML, /2 DIRTY/);
  assert.match(elements.get('#mode').textContent, /Off/);
  assert.equal(posted[0].command, 'ready');
  document.onClick({ target: { closest: selector => selector === '[data-action]' ? { dataset: { action: 'refreshRepository', path: '/repo' } } : null } });
  assert.equal(posted.at(-1).command, 'refreshRepository');
  assert.equal(posted.at(-1).path, '/repo');
  onMessage({ data: { type: 'state', rows: [{ path: 'D:/projects/repo', label: '.', status: 'IN_SYNC' }], autoMode: false } });
  assert.match(elements.get('#repositories').innerHTML, /<strong>repo<\/strong>/);
  onMessage({ data: { type: 'state', rows: [{ path: 'D:/projects/repo', label: 'D:/projects/repo', status: 'IN_SYNC' }], autoMode: false } });
  assert.match(elements.get('#repositories').innerHTML, /<strong>repo<\/strong>/);
  onMessage({ data: { type: 'state', rows: [{ path: 'D:\\projects\\repo', label: 'D:\\projects\\repo', status: 'IN_SYNC' }], autoMode: false } });
  assert.match(elements.get('#repositories').innerHTML, /<strong>repo<\/strong>/);
});

test('webview sidebar shares refresh commands and keeps manual open offline', async () => {
  let provider;
  let scanCount = 0;
  const commands = new Map();
  const posted = [];
  let receive;
  let visibility;
  let auto = false;
  let dashboardOpened = 0;
  let dashboardReceive;
  const scanPaths = [];
  const view = {
    visible: false,
    webview: { cspSource: 'vscode-webview:', postMessage: message => posted.push(message), onDidReceiveMessage(handler) { receive = handler; return { dispose() {} }; } },
    onDidChangeVisibility(handler) { visibility = handler; return { dispose() {} }; },
  };
  const vscode = {
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} dispose() {} },
    window: {
      registerWebviewViewProvider(_id, instance) { provider = instance; return { dispose() {} }; },
      createWebviewPanel() {
        dashboardOpened++;
        return { webview: { cspSource: 'vscode-webview:', onDidReceiveMessage(handler) { dashboardReceive = handler; return { dispose() {} }; } }, reveal() {}, onDidDispose: () => ({ dispose() {} }), onDidChangeViewState: () => ({ dispose() {} }) };
      },
      showErrorMessage: async () => {},
    },
    workspace: { workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/workspace' } }], getConfiguration: () => ({ get(key, fallback) { return key === 'autoRefreshOnOpen' ? auto : fallback; }, async update(_key, value) { auto = value; } }), onDidChangeConfiguration: () => ({ dispose() {} }) },
    commands: { executeCommand: async name => commands.get(name)?.(), registerCommand(name, action) { commands.set(name, action); return { dispose() {} }; } },
    ConfigurationTarget: { Global: 1 },
    ViewColumn: { Active: -1 },
  };
  const extension = start(vscode, { subscriptions: [] }, {
    resolveTargets: async () => ({ targets: [{ path: '/repo', label: 'repo' }], warnings: [] }),
    scanTargets: async (targets, options) => { scanCount++; scanPaths.push(options.onlyPath); return targets.map(row => ({ ...row, status: 'IN_SYNC' })); },
  });
  provider.resolveWebviewView(view);
  receive({ command: 'ready' });
  visibility({ visible: true });
  await extension.whenIdle();
  assert.equal(scanCount, 0);
  assert.equal(posted.at(-1).autoMode, false);
  await receive({ command: 'refresh' });
  await extension.whenIdle();
  assert.equal(scanCount, 1);
  await receive({ command: 'refreshRepository', path: '/repo' });
  await extension.whenIdle();
  assert.equal(scanCount, 2);
  receive({ command: 'openDashboard' });
  assert.equal(dashboardOpened, 1);
  dashboardReceive({ command: 'refreshRepository', path: '/repo' });
  await extension.whenIdle();
  assert.equal(scanPaths.at(-1), '/repo');
  assert.equal(scanCount, 3);
  receive({ command: 'refreshRepository', path: '/unlisted' });
  await extension.whenIdle();
  assert.equal(scanCount, 3);
  receive({ command: 'toggleAuto' });
  await new Promise(resolve => setImmediate(resolve));
  await extension.whenIdle();
  assert.equal(auto, true);
  assert.equal(scanCount, 4);
});
