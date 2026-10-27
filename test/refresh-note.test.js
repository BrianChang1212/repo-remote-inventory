const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { sidebarHtml } = require('../source/sidebar');
const { dashboardHtml } = require('../source/dashboard');
const { mergeResult } = require('../source/inventory');
const { format, englishT } = require('../source/l10n');
const bundle = require('../l10n/bundle.l10n.zh-tw.json');

const zhT = (message, ...args) => format(bundle[message] ?? message, args);
const scriptOf = html => html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];

// The stored refreshError exactly as inventory.js composes it for a stale row.
const timedOut = mergeResult(
  { path: '/a', label: 'alpha', status: 'IN_SYNC', checkedAt: '2026-10-21T03:00:00Z' },
  { path: '/a', label: 'alpha', status: 'REMOTE_UNREACHABLE', note: 'Remote query timed out', checkedAt: '2026-10-21T04:00:00Z' },
);
const gitExit = mergeResult(
  { path: '/b', label: 'beta', status: 'IN_SYNC', checkedAt: '2026-10-21T03:00:00Z' },
  { path: '/b', label: 'beta', status: 'REMOTE_UNREACHABLE', note: 'Remote query failed (Git exit 128)', checkedAt: '2026-10-21T04:00:00Z' },
);
const noNote = mergeResult(
  { path: '/c', label: 'gamma', status: 'IN_SYNC', checkedAt: '2026-10-21T03:00:00Z' },
  { path: '/c', label: 'gamma', status: 'LOCAL_ERROR', checkedAt: '2026-10-21T04:00:00Z' },
);
const unknownRows = [
  { path: '/d', label: 'delta', status: 'IN_SYNC', stale: true, refreshError: 'LOCAL_ERROR: spawn git ENOENT' },
  { path: '/e', label: 'epsilon', status: 'IN_SYNC', stale: true, refreshError: 'fatal: could not read Username for https://example.invalid' },
];
const rows = [timedOut, gitExit, noNote, ...unknownRows];

function sidebarRows(options) {
  let onMessage;
  const elements = new Map(['#repositories', '#summary', '#mode', '#status'].map(id => [id, { innerHTML: '', textContent: '', setAttribute() {} }]));
  vm.runInNewContext(scriptOf(sidebarHtml({ cspSource: 'vscode-webview:' }, false, options)), {
    document: { querySelector: id => elements.get(id), addEventListener() {} },
    window: { addEventListener(type, handler) { if (type === 'message') onMessage = handler; } },
    acquireVsCodeApi: () => ({ postMessage() {} }),
  });
  onMessage({ data: { type: 'state', autoMode: false, rows } });
  return elements.get('#repositories').innerHTML;
}

function dashboardRows(options) {
  let receive;
  const elements = new Map(['#chart', '#rows', '#meta', '#signals', '#summary', '#mode', '#refresh', '#clear'].map(id => [id, {}]));
  vm.runInNewContext(scriptOf(dashboardHtml({ cspSource: 'vscode-webview:' }, false, options)), {
    document: { querySelector: id => elements.get(id), addEventListener() {}, querySelectorAll: () => [] },
    window: { addEventListener: (_name, callback) => { receive = callback; } },
    acquireVsCodeApi: () => ({ postMessage() {} }),
  });
  receive({ data: { type: 'rows', checkedAt: '2026-10-21T04:00:00Z', rows } });
  return elements.get('#rows').innerHTML;
}

const notes = html => [...html.matchAll(/<p class="note">([\s\S]*?)<\/p>/g)].map(match => match[1]);

test('stored refreshError stays English in the composed STATUS: note format', () => {
  assert.equal(timedOut.refreshError, 'REMOTE_UNREACHABLE: Remote query timed out');
  assert.equal(gitExit.refreshError, 'REMOTE_UNREACHABLE: Remote query failed (Git exit 128)');
  assert.equal(noNote.refreshError, 'LOCAL_ERROR: Refresh failed');
});

for (const [view, render] of [['sidebar', sidebarRows], ['dashboard', dashboardRows]]) {
  test(`${view} shows extension-authored refresh notes in English for en`, () => {
    assert.deepEqual(notes(render({ t: englishT, language: 'en' })), [
      'REMOTE_UNREACHABLE: Remote query timed out',
      'REMOTE_UNREACHABLE: Remote query failed (Git exit 128)',
      'LOCAL_ERROR: Refresh failed',
      'LOCAL_ERROR: spawn git ENOENT',
      'fatal: could not read Username for https://example.invalid',
    ]);
  });

  test(`${view} translates known refresh notes for zh-tw, keeps status codes, and leaves unknown text unchanged`, () => {
    assert.deepEqual(notes(render({ t: zhT, language: 'zh-tw' })), [
      'REMOTE_UNREACHABLE：remote 查詢逾時',
      'REMOTE_UNREACHABLE：remote 查詢失敗（Git exit 128）',
      'LOCAL_ERROR：重新整理失敗',
      'LOCAL_ERROR: spawn git ENOENT',
      'fatal: could not read Username for https://example.invalid',
    ]);
  });
}

test('the host note table covers every extension-authored note literal exactly', () => {
  const { NOTE_TEMPLATES } = require('../source/git-state');
  const { REFRESH_FAILED } = require('../source/inventory');
  const { noteStrings } = require('../source/refresh-note');
  assert.ok(NOTE_TEMPLATES.includes('Remote query timed out'));
  assert.deepEqual(Object.keys(noteStrings(englishT).sentences).sort(), [...new Set([...NOTE_TEMPLATES, REFRESH_FAILED])].sort());
  for (const [english, chinese] of Object.entries(noteStrings(zhT).sentences)) {
    assert.notEqual(chinese, english, `missing zh-tw note translation for ${english}`);
  }
});
