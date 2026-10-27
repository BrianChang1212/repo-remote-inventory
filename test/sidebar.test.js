const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { sidebarHtml } = require('../source/sidebar');
const { start } = require('../source/extension');
const { format } = require('../source/l10n');
const bundle = require('../l10n/bundle.l10n.zh-tw.json');
const { assertGuideCss } = require('./style-assertions');

const zhT = (message, ...args) => format(bundle[message] ?? message, args);
const CJK = /[\u3400-\u9fff]/;

function runSidebar(html) {
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  const elements = new Map(['#repositories', '#summary', '#mode', '#status'].map(id => [id, { innerHTML: '', textContent: '', setAttribute() {} }]));
  let onMessage;
  vm.runInNewContext(script, {
    document: { querySelector: id => elements.get(id), addEventListener() {} },
    window: { addEventListener(type, handler) { if (type === 'message') onMessage = handler; } },
    acquireVsCodeApi: () => ({ postMessage() {} }),
  });
  onMessage({ data: { type: 'state', autoMode: true, rows: [
    { path: '/a', label: 'alpha', status: 'IN_SYNC', stale: true, dirty: 2, branch: 'main', checkedAt: '2026-10-21T03:00:00Z' },
    { path: '/b', label: 'beta', status: 'BEHIND', worktreeWarning: 'x' },
  ] } });
  return elements;
}

test('sidebar renders English text, lang="en", and no Chinese by default', () => {
  const html = sidebarHtml({ cspSource: 'vscode-webview:' }, true);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Remote inventory/);
  assert.match(html, />Refresh all</);
  assert.doesNotMatch(html, CJK);
  const elements = runSidebar(html);
  assert.match(elements.get('#summary').innerHTML, /TOTAL[\s\S]*2/);
  assert.equal(elements.get('#mode').textContent, 'Auto refresh: On');
  assert.match(elements.get('#repositories').innerHTML, /2 dirty/);
  assert.match(elements.get('#repositories').innerHTML, /Compare target/);
  assert.match(elements.get('#repositories').innerHTML, /\d{2}-\d{2} \d{2}:\d{2}/);
  assert.doesNotMatch(elements.get('#repositories').innerHTML + elements.get('#summary').innerHTML, CJK);
});

test('sidebar renders zh-tw text from the host string table with lang="zh-Hant"', () => {
  const html = sidebarHtml({ cspSource: 'vscode-webview:' }, true, { t: zhT, language: 'zh-tw' });
  assert.match(html, /<html lang="zh-Hant">/);
  assert.match(html, new RegExp(bundle['Remote inventory']));
  assert.match(html, new RegExp(`>${bundle['Refresh all']}<`));
  assert.doesNotMatch(html, />Refresh all<|>Repositories<|Local worktrees and remote branch status/);
  const elements = runSidebar(html);
  assert.match(elements.get('#summary').innerHTML, new RegExp(bundle.TOTAL));
  assert.equal(elements.get('#mode').textContent, bundle['Auto refresh: On']);
  const rows = elements.get('#repositories').innerHTML;
  assert.match(rows, new RegExp(format(bundle['{0} dirty'], [2])));
  assert.match(rows, new RegExp(bundle['Compare target']));
  assert.match(rows, new RegExp(bundle['Refresh repository']));
  assert.doesNotMatch(rows, /Compare target|Refresh repository|Dirty unknown|Clean worktree/);
});

test('sidebar CSS uses the guide variables with light and high contrast overrides', () => {
  assertGuideCss(sidebarHtml({ cspSource: 'vscode-webview:' }, true), 'sideBar');
});

test('sidebar renders a keyboard accessible card interface', () => {
  const html = sidebarHtml({ cspSource: 'vscode-webview:' }, true);
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
  assert.match(elements.get('#repositories').innerHTML, /Stale/);
  assert.doesNotMatch(elements.get('#repositories').innerHTML, /STALE|DIRTY/);
  assert.match(elements.get('#repositories').innerHTML, /2 dirty/);
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
