const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { sidebarHtml } = require('../source/sidebar');
const { start } = require('../source/extension');
const { format } = require('../source/l10n');
const bundle = require('../l10n/bundle.l10n.zh-tw.json');
const { assertGuideCss } = require('./style-assertions');
const { summary } = require('../source/presentation');

const zhT = (message, ...args) => format(bundle[message] ?? message, args);
const CJK = /[\u3400-\u9fff]/;

function interactiveSidebar(rows, options = {}) {
  const html = sidebarHtml({ cspSource: 'vscode-webview:' }, false, options);
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  const elements = new Map(['#repositories', '#summary', '#mode', '#status', '#filters', '#search', '#filter-all', '#filter-attention', '#filter-sync'].map(id => [id, { innerHTML: '', textContent: '', value: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } }]));
  const handlers = {};
  const posted = [];
  let receive;
  vm.runInNewContext(script, {
    document: { querySelector: id => elements.get(id), addEventListener: (type, handler) => { handlers[type] = handler; } },
    window: { addEventListener: (_type, handler) => { receive = handler; } },
    acquireVsCodeApi: () => ({ postMessage: message => posted.push(message) }),
  });
  const update = (rows, message) => receive({ data: { type: 'state', rows, message } });
  update(rows);
  return {
    elements, posted, update,
    search(query) { elements.get('#search').value = query; handlers.input({ target: { id: 'search', value: query } }); },
    filter(filter) { handlers.click({ target: { closest: selector => selector === '[data-filter]' ? { dataset: { filter } } : null } }); },
    expand(path) { handlers.toggle({ target: { closest: () => ({ open: true, dataset: { path } }) } }); },
    refresh(path) { handlers.click({ target: { closest: selector => selector === '[data-action]' ? { dataset: { action: 'refreshRepository', path } } : null } }); },
  };
}

test('search matches repository labels and full paths without changing global counts', () => {
  const ui = interactiveSidebar([{ path: '/group/Alpha', label: 'Service', status: 'IN_SYNC' }, { path: '/other/beta', label: 'Worker', status: 'BEHIND' }]);
  ui.search('GROUP/alpha');
  assert.match(ui.elements.get('#repositories').innerHTML, />Service</);
  assert.doesNotMatch(ui.elements.get('#repositories').innerHTML, />Worker</);
  assert.match(ui.elements.get('#summary').innerHTML, /TOTAL<\/span><strong>2</);
  ui.search('wOrKeR');
  assert.match(ui.elements.get('#repositories').innerHTML, />Worker</);
  assert.doesNotMatch(ui.elements.get('#repositories').innerHTML, />Service</);
  ui.search('<img>');
  assert.match(ui.elements.get('#repositories').innerHTML, /No repositories match/);
  assert.doesNotMatch(ui.elements.get('#repositories').innerHTML, /<img>/);
  ui.update([]);
  assert.match(ui.elements.get('#repositories').innerHTML, /No repositories to display/);
});

test('plain Brian search finds the repository name without matching every shared root path', () => {
  const ui = interactiveSidebar([
    { path: 'D:/Brian', label: 'Brian', status: 'IN_SYNC' },
    { path: 'D:/Brian/projects/alpha', label: 'Alpha', status: 'IN_SYNC' },
    { path: 'D:/Brian/projects/beta', label: 'Beta', status: 'BEHIND' },
  ]);
  ui.search('Brian');
  const output = ui.elements.get('#repositories').innerHTML;
  assert.match(output, />Brian</);
  assert.doesNotMatch(output, />Alpha<|>Beta</);
  ui.search('  brian  ');
  assert.doesNotMatch(ui.elements.get('#repositories').innerHTML, />Alpha<|>Beta</);
  ui.search('D:\\BRIAN\\projects\\ALPHA');
  assert.match(ui.elements.get('#repositories').innerHTML, />Alpha</);
  assert.doesNotMatch(ui.elements.get('#repositories').innerHTML, />Brian<|>Beta</);
  ui.search('D:/Brian/projects/');
  assert.match(ui.elements.get('#repositories').innerHTML, />Alpha</);
  assert.match(ui.elements.get('#repositories').innerHTML, />Beta</);
  assert.doesNotMatch(ui.elements.get('#repositories').innerHTML, />Brian</);
});

test('last-known filters intersect search, exclude pending and preserve expansion on updates', () => {
  const rows = [
    { path: '/one/repo', label: 'repo', status: 'IN_SYNC', stale: true },
    { path: '/two/repo', label: 'repo', status: 'BEHIND', stale: true },
    { path: '/pending', status: 'PENDING', stale: true },
    { path: '/warning', status: 'IN_SYNC', worktreeWarning: 'unknown' },
  ];
  const ui = interactiveSidebar(rows);
  ui.expand('/two/repo');
  ui.filter('attention');
  assert.equal(ui.elements.get('#filter-attention').attributes['aria-pressed'], 'true');
  assert.equal(ui.elements.get('#filter-all').attributes['aria-pressed'], 'false');
  let output = ui.elements.get('#repositories').innerHTML;
  assert.match(output, /data-path="\/two\/repo" open/);
  assert.match(output, /data-path="\/warning"/);
  assert.doesNotMatch(output, /data-path="\/one\/repo"|data-path="\/pending"/);
  ui.search('/TWO/');
  ui.update(rows.map(row => ({ ...row, dirty: 1 })));
  output = ui.elements.get('#repositories').innerHTML;
  assert.match(output, /data-path="\/two\/repo" open/);
  assert.doesNotMatch(output, /data-path="\/warning"/);
  assert.equal(ui.elements.get('#search').value, '/TWO/');
  assert.equal(ui.elements.get('#filter-attention').attributes['aria-pressed'], 'true');
  ui.refresh('/two/repo');
  assert.equal(ui.posted.at(-1).path, '/two/repo');
  ui.search('');
  ui.filter('sync');
  output = ui.elements.get('#repositories').innerHTML;
  assert.match(output, /data-path="\/one\/repo"/);
  assert.doesNotMatch(output, /data-path="\/two\/repo"|data-path="\/pending"/);
  ui.filter('all');
  assert.match(ui.elements.get('#repositories').innerHTML, /data-path="\/two\/repo" open/);
  assert.match(ui.elements.get('#repositories').innerHTML, /data-path="\/pending"/);
  assert.match(sidebarHtml({ cspSource: 'vscode-webview:' }, false), /Filters use last known status/);
});

test('search and filters are localized and distinguish unmatched results from an empty inventory', () => {
  const options = { t: zhT, language: 'zh-tw' };
  const html = sidebarHtml({ cspSource: 'vscode-webview:' }, false, options);
  for (const key of ['Search repositories', 'Repository filters', 'Attention', 'In sync', 'Filters use last known status, including cached results; summary counts only confirmed results.']) {
    assert.ok(bundle[key], key);
    assert.ok(html.includes(bundle[key]), key);
  }
  const ui = interactiveSidebar([{ path: '/repo', status: 'IN_SYNC' }], options);
  ui.search('missing');
  assert.ok(ui.elements.get('#repositories').innerHTML.includes(bundle['No repositories match your search and filter.']));
  ui.update([]);
  assert.ok(ui.elements.get('#repositories').innerHTML.includes(bundle['No repositories to display.']));
});

test('refresh completion shows its unconfirmed warning only once', () => {
  const rows = [{ path: '/repo', status: 'IN_SYNC', stale: true }];
  const ui = interactiveSidebar(rows);
  ui.update(rows, summary(rows));
  assert.equal(ui.elements.get('#status').textContent.match(/1 unconfirmed/g).length, 1);
});

test('host completion and sidebar metrics agree on confirmed attention', () => {
  const rows = [
    { path: '/cached', status: 'BEHIND', stale: true },
    { path: '/waiting', status: 'PENDING' },
    { path: '/dirty', status: 'IN_SYNC', dirty: 2 },
    { path: '/warning', status: 'IN_SYNC', worktreeWarning: 'unknown' },
  ];
  const ui = interactiveSidebar(rows);
  ui.update(rows, summary(rows));
  assert.match(ui.elements.get('#status').textContent, /4 repositories · 1 needs attention/);
  assert.match(ui.elements.get('#summary').innerHTML, /TOTAL<\/span><strong>4</);
  assert.match(ui.elements.get('#summary').innerHTML, /CURRENT<\/span><strong>2</);
  assert.match(ui.elements.get('#summary').innerHTML, /ATTENTION<\/span><strong>1</);
});

function runSidebar(html, rows = [
  { path: '/a', label: 'alpha', status: 'IN_SYNC', stale: true, dirty: 2, branch: 'main', checkedAt: '2026-10-21T03:00:00Z' },
  { path: '/b', label: 'beta', status: 'BEHIND', worktreeWarning: 'x' },
]) {
  const script = html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  const elements = new Map(['#repositories', '#summary', '#mode', '#status'].map(id => [id, { innerHTML: '', textContent: '', setAttribute() {} }]));
  let onMessage;
  vm.runInNewContext(script, {
    document: { querySelector: id => elements.get(id), addEventListener() {} },
    window: { addEventListener(type, handler) { if (type === 'message') onMessage = handler; } },
    acquireVsCodeApi: () => ({ postMessage() {} }),
  });
  onMessage({ data: { type: 'state', autoMode: true, rows } });
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

test('sidebar separates confirmed attention from stale and pending results', () => {
  const html = sidebarHtml({ cspSource: 'vscode-webview:' }, false);
  const elements = runSidebar(html, [
    { path: '/stale', status: 'BEHIND', stale: true },
    { path: '/pending', status: 'PENDING' },
    { path: '/clean', status: 'IN_SYNC', dirty: 3 },
    { path: '/behind', status: 'BEHIND' },
  ]);
  assert.match(elements.get('#summary').innerHTML, /CURRENT<\/span><strong>2</);
  assert.match(elements.get('#summary').innerHTML, /ATTENTION<\/span><strong>1</);
  assert.match(elements.get('#status').textContent, /2 unconfirmed/);
  const stale = runSidebar(html, [{ path: '/a', status: 'IN_SYNC', stale: true }, { path: '/b', status: 'BEHIND', stale: true }]);
  assert.match(stale.get('#summary').innerHTML, /ATTENTION<\/span><strong>—</);
  assert.doesNotMatch(stale.get('#repositories').innerHTML, />Stale</);
  assert.match(stale.get('#status').textContent, /Last known repository results/);
});

test('path-like labels are compact while full paths and duplicate names remain identifiable', () => {
  const elements = runSidebar(sidebarHtml({ cspSource: 'vscode-webview:' }, false), [
    { path: 'D:/one/repo', label: '.agent-run/repo', status: 'IN_SYNC' },
    { path: 'D:/two/repo', label: '.agent-run\\repo', status: 'IN_SYNC' },
  ]);
  const rendered = elements.get('#repositories').innerHTML;
  assert.equal((rendered.match(/<strong>repo<\/strong>/g) || []).length, 2);
  assert.match(rendered, /data-path="D:\/one\/repo"/);
  assert.match(rendered, /data-path="D:\/two\/repo"/);
});

test('sidebar preserves expansion by full path when refresh fails and stale data remains', () => {
  const script = sidebarHtml({ cspSource: 'vscode-webview:' }, false).match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  const elements = new Map(['#repositories', '#summary', '#mode', '#status'].map(id => [id, { innerHTML: '', textContent: '', setAttribute() {} }]));
  const handlers = {};
  let receive;
  vm.runInNewContext(script, {
    document: { querySelector: id => elements.get(id), addEventListener: (type, handler) => { handlers[type] = handler; } },
    window: { addEventListener: (_type, handler) => { receive = handler; } },
    acquireVsCodeApi: () => ({ postMessage() {} }),
  });
  const row = { path: '/one/repo', label: 'repo', status: 'IN_SYNC', branch: 'main' };
  receive({ data: { type: 'state', rows: [row] } });
  assert.match(elements.get('#summary').innerHTML, /ATTENTION<\/span><strong>0</);
  handlers.toggle({ target: { closest: () => ({ open: true, dataset: { path: row.path } }) } });
  receive({ data: { type: 'state', rows: [{ ...row, stale: true, refreshError: '<failed>' }, { path: '/two/repo', label: 'repo', status: 'PENDING' }] } });
  assert.match(elements.get('#repositories').innerHTML, /data-path="\/one\/repo" open/);
  assert.doesNotMatch(elements.get('#repositories').innerHTML, /data-path="\/two\/repo" open/);
  assert.match(elements.get('#repositories').innerHTML, /&lt;failed&gt;/);
  assert.match(elements.get('#repositories').innerHTML, />main</);
  assert.match(elements.get('#summary').innerHTML, /ATTENTION<\/span><strong>—</);
  receive({ data: { type: 'state', rows: [] } });
  assert.match(elements.get('#repositories').innerHTML, /No repositories to display/);
  assert.match(elements.get('#summary').innerHTML, /CURRENT<\/span><strong>0</);
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
  assert.doesNotMatch(elements.get('#repositories').innerHTML, />Stale</);
  assert.match(elements.get('#status').textContent, /1 unconfirmed/);
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
