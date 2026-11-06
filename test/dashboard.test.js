const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { dashboardHtml } = require('../source/dashboard');
const { format } = require('../source/l10n');
const bundle = require('../l10n/bundle.l10n.zh-tw.json');
const { assertGuideCss } = require('./style-assertions');

const zhT = (message, ...args) => format(bundle[message] ?? message, args);
const CJK = /[\u3400-\u9fff]/;

function interactiveDashboard(rows) {
  const html = dashboardHtml({ cspSource: 'vscode-webview:' }, false);
  const script = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
  const elements = new Map();
  const handlers = {};
  let receive;
  const element = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', value: '', setAttribute() {} });
    return elements.get(id);
  };
  vm.runInNewContext(script, {
    document: { querySelector: element, querySelectorAll: () => [], addEventListener: (name, handler) => { handlers[name] = handler; } },
    window: { addEventListener: (_name, handler) => { receive = handler; } },
    acquireVsCodeApi: () => ({ postMessage() {} }),
  });
  const update = rows => receive({ data: { type: 'rows', rows } });
  update(rows);
  return { element, handlers, update };
}

test('dashboard summary distinguishes confirmed results from cached and pending rows like the sidebar', () => {
  const ui = interactiveDashboard([
    { path: '/cached', status: 'BEHIND', stale: true },
    { path: '/pending', status: 'PENDING' },
    { path: '/current', status: 'IN_SYNC', dirty: 2 },
    { path: '/warning', status: 'IN_SYNC', worktreeWarning: 'unknown' },
  ]);
  assert.match(ui.element('#summary').innerHTML, /TOTAL<\/span><strong>4</);
  assert.match(ui.element('#summary').innerHTML, /CURRENT<\/span><strong>2</);
  assert.match(ui.element('#summary').innerHTML, /ATTENTION<\/span><strong>1</);
  assert.match(ui.element('#meta').textContent, /2 unconfirmed/);
  ui.update([{ path: '/cached', status: 'BEHIND', stale: true }]);
  assert.match(ui.element('#summary').innerHTML, /ATTENTION<\/span><strong>—</);
});

test('dashboard keeps its search, last-known filter and full-path expansion after refresh', () => {
  const rows = [
    { path: 'D:/one/repo', label: 'repo', status: 'BEHIND', stale: true },
    { path: 'D:/two/repo', label: 'repo', status: 'IN_SYNC' },
    { path: 'D:/pending', label: 'pending', status: 'PENDING' },
  ];
  const ui = interactiveDashboard(rows);
  ui.handlers.toggle({ target: { isConnected: true, closest: () => ({ open: true, dataset: { path: 'D:/one/repo' } }) } });
  ui.handlers.input({ target: { id: 'search', value: 'D:\\ONE\\' } });
  ui.handlers.click({ target: { closest: selector => selector === '[data-filter]' ? { dataset: { filter: 'attention' } } : null } });
  ui.update(rows.map(row => ({ ...row, dirty: 1 })));
  assert.match(ui.element('#rows').innerHTML, /data-path="D:\/one\/repo" open/);
  assert.doesNotMatch(ui.element('#rows').innerHTML, /data-path="D:\/two\/repo"|data-path="D:\/pending"/);
  ui.handlers.toggle({ target: { isConnected: false, closest: () => ({ open: false, dataset: { path: 'D:/one/repo' } }) } });
  ui.update(rows);
  assert.match(ui.element('#rows').innerHTML, /data-path="D:\/one\/repo" open/);
  ui.handlers.input({ target: { id: 'search', value: 'missing' } });
  assert.match(ui.element('#rows').innerHTML, /No repositories match/);
  ui.update([]);
  assert.match(ui.element('#rows').innerHTML, /No repositories to display/);
});

function runDashboard(html) {
  const script = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
  const elements = new Map(['#chart', '#rows', '#meta', '#signals', '#summary', '#mode', '#refresh', '#clear'].map(id => [id, {}]));
  let receive;
  vm.runInNewContext(script, {
    document: { querySelector: id => elements.get(id), addEventListener() {}, querySelectorAll: () => [] },
    window: { addEventListener: (_name, callback) => { receive = callback; } },
    acquireVsCodeApi: () => ({ postMessage() {} }),
  });
  receive({ data: { type: 'rows', checkedAt: '2026-10-21T03:00:00Z', rows: [
    { label: 'alpha', path: '/a', status: 'IN_SYNC', stale: true, dirty: 2 },
    { label: 'beta', path: '/b', status: 'AHEAD', dirty: 0 },
  ] } });
  return elements;
}

test('dashboard renders English text with lang="en" and no Chinese by default', () => {
  const html = dashboardHtml({ cspSource: 'vscode-webview:' }, true);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /Repository inventory/);
  assert.doesNotMatch(html, CJK);
  const elements = runDashboard(html);
  assert.match(elements.get('#meta').textContent, /^2 repositories · Last check: \d{2}-\d{2} \d{2}:\d{2} · cached snapshot; stale until refreshed · 1 unconfirmed/);
  assert.equal(elements.get('#mode').textContent, 'Mode: Auto');
  assert.match(elements.get('#summary').innerHTML, /ATTENTION/);
  assert.match(elements.get('#rows').innerHTML, /Compare target/);
  assert.doesNotMatch(Object.values(Object.fromEntries(elements)).map(item => (item.innerHTML || '') + (item.textContent || '')).join(''), CJK);
});

test('dashboard renders zh-tw text from the host string table with lang="zh-Hant"', () => {
  const html = dashboardHtml({ cspSource: 'vscode-webview:' }, true, { t: zhT, language: 'zh-tw' });
  assert.match(html, /<html lang="zh-Hant">/);
  assert.match(html, new RegExp(bundle['Repository inventory']));
  assert.match(html, new RegExp(`>${bundle['Clear filter']}<`));
  assert.doesNotMatch(html, />Clear filter<|>Refresh<|Repository inventory/);
  const elements = runDashboard(html);
  assert.equal(elements.get('#mode').textContent, bundle['Mode: Auto']);
  assert.match(elements.get('#summary').innerHTML, new RegExp(bundle['ATTENTION']));
  assert.match(elements.get('#signals').textContent, new RegExp(format(bundle['Stale: {0} · Dirty: {1}'], [1, 1])));
  assert.match(elements.get('#rows').innerHTML, new RegExp(bundle['Compare target']));
  assert.doesNotMatch(elements.get('#rows').innerHTML + elements.get('#summary').innerHTML, /Compare target|Needs Attention|In Sync/);
});

test('dashboard CSS uses the guide variables with light and high contrast overrides', () => {
  assertGuideCss(dashboardHtml({ cspSource: 'vscode-webview:' }, true), 'editor');
});

test('dashboard provides an auto toggle, exact status filters, separate stale and dirty signals, and snapshot times', () => {
  const html = dashboardHtml({ cspSource: 'vscode-webview:' }, false);
  assert.match(html, /Mode: /);
  assert.match(html, /All/);
  assert.match(html, /In sync/);
  assert.match(html, /ATTENTION/);
  assert.match(html, /Stale/);
  assert.match(html, /id="refresh">Refresh/);
  assert.match(html, /data-status=/);
  assert.match(html, /Stale: /);
  assert.match(html, /Dirty: /);
  assert.match(html, /Last check:/);
  assert.match(html, /clear/);
  assert.match(html, /toggleAuto/);
  assert.match(html, /--accent: #89e829/);
  assert.match(html, /<details/);
  assert.match(html, /refreshRepository/);
});

test('dashboard message renders rows and chart filters narrow rows until cleared', () => {
  const html = dashboardHtml({ cspSource: 'vscode-webview:' }, false);
  const script = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
  const elements = new Map(['#chart', '#rows', '#meta', '#signals', '#summary', '#mode', '#refresh', '#clear', '#search'].map(id => [id, {}]));
  let statusButtons = [];
  let receiveMessage;
  const document = {
    querySelector: id => elements.get(id),
    addEventListener(type, handler) { if (type === 'click') this.onClick = handler; },
    querySelectorAll: () => {
      statusButtons = [...elements.get('#chart').innerHTML.matchAll(/data-status="([^"]+)"/g)].map(match => ({ dataset: { status: match[1] }, onclick: null }));
      return statusButtons;
    },
  };
  const window = { addEventListener: (_name, callback) => { receiveMessage = callback; } };
  const posted = [];
  vm.runInNewContext(script, { document, window, acquireVsCodeApi: () => ({ postMessage: message => posted.push(message) }) });
  receiveMessage({ data: { type: 'rows', checkedAt: '2026-10-20T00:00:00Z', rows: [
    { label: 'same', path: '/one', status: 'IN_SYNC', stale: true, dirty: 2, checkedAt: '2026-10-19T00:00:00Z' },
    { label: 'other', path: '/two', status: 'AHEAD', dirty: 0, checkedAt: '2026-10-20T00:00:00Z' },
    { label: 'fresh', path: '/three', status: 'IN_SYNC', stale: false, dirty: 0, checkedAt: '2026-10-20T00:00:00Z' },
  ] } });
  assert.match(elements.get('#chart').innerHTML, /IN_SYNC \(1\)/);
  assert.match(elements.get('#chart').innerHTML, /AHEAD \(1\)/);
  assert.doesNotMatch(elements.get('#chart').innerHTML, /Stale/);
  assert.match(elements.get('#signals').textContent, /Stale: 1 · Dirty: 1/);
  assert.match(elements.get('#summary').innerHTML, /TOTAL<\/span><strong>3</);
  assert.match(elements.get('#summary').innerHTML, /CURRENT<\/span><strong>2</);
  assert.match(elements.get('#summary').innerHTML, /ATTENTION<\/span><strong>1</);
  assert.match(elements.get('#meta').textContent, /Last check: /);
  assert.match(elements.get('#rows').innerHTML, /same/);
  assert.match(elements.get('#rows').innerHTML, /Stale/);
  assert.doesNotMatch(elements.get('#rows').innerHTML + elements.get('#signals').textContent, /STALE/);
  assert.match(elements.get('#rows').innerHTML, /data-action="refreshRepository"/);
  statusButtons.find(button => button.dataset.status === 'AHEAD').onclick();
  assert.match(elements.get('#rows').innerHTML, /other/);
  assert.doesNotMatch(elements.get('#rows').innerHTML, /same/);
  elements.get('#clear').onclick();
  assert.match(elements.get('#rows').innerHTML, /same/);
  assert.match(elements.get('#rows').innerHTML, /other/);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].command, 'ready');
  elements.get('#mode').onclick();
  assert.equal(posted[1].command, 'toggleAuto');
  elements.get('#refresh').onclick();
  assert.equal(posted[2].command, 'refresh');
  document.onClick({ target: { closest: selector => selector === '[data-action="refreshRepository"]' ? { dataset: { path: '/two' } } : null } });
  assert.equal(posted[3].command, 'refreshRepository');
  assert.equal(posted[3].path, '/two');
  receiveMessage({ data: { type: 'mode', autoMode: true } });
  assert.equal(elements.get('#mode').textContent, 'Mode: Auto');
  receiveMessage({ data: { type: 'mode', autoMode: false } });
  assert.equal(elements.get('#mode').textContent, 'Mode: Manual');
  receiveMessage({ data: { type: 'rows', rows: [{ path: '/bad', label: '<img src=x>', status: 'IN_SYNC', dirty: '<script>x</script>' }] } });
  assert.match(elements.get('#rows').innerHTML, /&lt;img src=x&gt;/);
  assert.match(elements.get('#rows').innerHTML, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.doesNotMatch(elements.get('#rows').innerHTML, /<img|<script>/);
});
