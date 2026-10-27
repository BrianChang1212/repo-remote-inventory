const crypto = require('node:crypto');
const { englishT, htmlLang, format, formatDateTime, scriptJson } = require('./l10n');
const { guideCss } = require('./style');
const { noteStrings, translateNote } = require('./refresh-note');

// Strings drawn by the webview script; translated on the extension host (guide §2.3).
function sidebarStrings(t) {
  return {
    total: t('TOTAL'), current: t('CURRENT'), attention: t('ATTENTION'),
    autoOn: t('Auto refresh: On'), autoOff: t('Auto refresh: Off'),
    lastKnown: t('Last known repository results'),
    emptyHint: t('Open a scan directory or refresh to find repositories.'),
    unnamed: t('Unnamed repository'), stale: t('Stale'),
    dirtyUnknown: t('Dirty unknown'), dirtyCount: t('{0} dirty'), clean: t('Clean worktree'),
    dirtyUnknownFlag: t('Dirty unknown'), dirtyCountFlag: t('{0} dirty'),
    branch: t('Branch'), compareTarget: t('Compare target'), aheadBehind: t('Ahead / behind'),
    localSha: t('Local SHA'), remoteSha: t('Remote SHA'), lastCommit: t('Last commit'),
    lastCheck: t('Last check'), path: t('Path'), refreshRepository: t('Refresh repository'),
    noRepositories: t('No repositories to display.'),
    notes: noteStrings(t),
  };
}

const SCRIPT = `
const vscode = acquireVsCodeApi();
const S = STRINGS;
${format.toString()}
${formatDateTime.toString()}
${translateNote.toString()}
let rows = [];
let autoMode = AUTO_MODE;
let message = '';
const expanded = new Set();
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const value = (item, fallback = '—') => esc(item == null || item === '' ? fallback : item);

function draw() {
  const current = rows.filter(row => !row.stale);
  const attention = rows.filter(row => row.stale || row.worktreeWarning || row.status !== 'IN_SYNC');
  document.querySelector('#summary').innerHTML = [
    [S.total, rows.length], [S.current, current.length], [S.attention, attention.length],
  ].map(([label, count]) => '<div class="metric"><span>' + esc(label) + '</span><strong>' + count + '</strong></div>').join('');
  document.querySelector('#mode').textContent = autoMode ? S.autoOn : S.autoOff;
  document.querySelector('#mode').setAttribute('aria-pressed', String(autoMode));
  document.querySelector('#status').textContent = message || (rows.length ? S.lastKnown : S.emptyHint);
  document.querySelector('#repositories').innerHTML = rows.map(row => {
    const path = String(row.path || '');
    const name = value(row.label && row.label !== '.' && row.label !== path ? row.label : path.split(String.fromCharCode(92)).at(-1).split('/').at(-1), S.unnamed);
    const status = value(row.status, 'PENDING');
    const flag = row.stale ? '<span class="tag warn">' + esc(S.stale) + '</span>' : '';
    const dirty = row.worktreeWarning ? S.dirtyUnknown : row.dirty > 0 ? format(S.dirtyCount, [row.dirty]) : S.clean;
    const dirtyFlag = row.worktreeWarning ? '<span class="tag ok">' + esc(S.dirtyUnknownFlag) + '</span>' :
      row.dirty > 0 ? '<span class="tag ok">' + esc(format(S.dirtyCountFlag, [row.dirty])) + '</span>' : '';
    const timestamp = formatDateTime(row.lastSuccessAt || row.checkedAt);
    return '<details class="repo" data-path="' + esc(path) + '"' + (expanded.has(path) ? ' open' : '') + '>' +
      '<summary title="' + esc(path) + '"><span class="repo-main"><strong>' + name + '</strong><small>' + status + flag + dirtyFlag + '</small></span><span class="chevron" aria-hidden="true">⌄</span></summary>' +
      '<div class="repo-body"><div class="signal">' + esc(dirty) + '</div>' +
      '<dl><dt>' + esc(S.branch) + '</dt><dd>' + value(row.branch) + '</dd><dt>' + esc(S.compareTarget) + '</dt><dd>' + value(row.compareTarget) + '</dd>' +
      '<dt>' + esc(S.aheadBehind) + '</dt><dd>' + value(row.ahead, '0') + ' / ' + value(row.behind, '0') + '</dd>' +
      '<dt>' + esc(S.localSha) + '</dt><dd class="sha">' + value(row.localSha) + '</dd><dt>' + esc(S.remoteSha) + '</dt><dd class="sha">' + value(row.remoteSha) + '</dd>' +
      '<dt>' + esc(S.lastCommit) + '</dt><dd>' + value(row.lastCommit) + '</dd><dt>' + esc(S.lastCheck) + '</dt><dd>' + value(timestamp) + '</dd>' +
      '<dt>' + esc(S.path) + '</dt><dd class="path">' + esc(path) + '</dd></dl>' +
      (row.refreshError ? '<p class="note">' + esc(translateNote(row.refreshError, S.notes)) + '</p>' : '') +
      '<button class="row-action" data-action="refreshRepository" data-path="' + esc(path) + '">' + esc(S.refreshRepository) + '</button></div></details>';
  }).join('') || '<div class="empty">' + esc(S.noRepositories) + '</div>';
}

window.addEventListener('message', event => {
  if (event.data.type !== 'state') return;
  rows = Array.isArray(event.data.rows) ? event.data.rows : [];
  autoMode = Boolean(event.data.autoMode);
  message = event.data.message || '';
  draw();
});
document.addEventListener('toggle', event => {
  const card = event.target.closest('details[data-path]');
  if (!card) return;
  if (card.open) expanded.add(card.dataset.path);
  else expanded.delete(card.dataset.path);
}, true);
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  vscode.postMessage({ command: button.dataset.action, ...(button.dataset.path ? { path: button.dataset.path } : {}) });
});
vscode.postMessage({ command: 'ready' });
`;

const SIDEBAR_CSS = `
body { min-height: 100vh; padding: 16px 14px 28px; }
.lede { margin: 8px 0 16px; color: var(--muted); font-size: 12px; }
.metrics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; margin-bottom: 16px; }
.metric { min-width: 0; }
.controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
#mode { grid-column: 1 / -1; text-align: left; padding: 7px 10px; }
#mode[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
#mode::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-right: 8px; border-radius: 50%; background: var(--muted); }
#mode[aria-pressed="true"]::before { background: var(--accent); box-shadow: var(--glow); }
.status { margin: 14px 0 17px; }
.repo { margin: 0 0 7px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); box-shadow: inset 2px 0 0 var(--accent); }
.repo:hover, .repo[open] { border-color: var(--accent); }
summary { display: flex; justify-content: space-between; gap: 8px; align-items: center; padding: 10px; cursor: pointer; list-style: none; }
summary::-webkit-details-marker { display: none; }
.repo-main { min-width: 0; }
.repo-main strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.repo-main small { display: block; margin-top: 2px; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .04em; }
.repo-main .tag { margin-left: 6px; padding: 0 4px; font-size: 10px; }
.chevron { flex: none; color: var(--accent); font-size: 19px; line-height: 1; transition: transform .18s ease; }
.repo[open] .chevron { transform: rotate(180deg); }
.repo-body { padding: 0 10px 11px; border-top: 1px solid var(--line); }
.signal { margin: 9px 0; font-size: 12px; }
dl { display: grid; grid-template-columns: 82px minmax(0, 1fr); gap: 5px 8px; margin: 0 0 12px; font-size: 12px; }
dt { color: var(--muted); } dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.sha { font-family: var(--mono); font-size: 11px; }
.path { color: var(--muted); }
.row-action { width: 100%; }
.note { color: var(--warn); overflow-wrap: anywhere; }
`;

function sidebarHtml(webview, autoMode, options = {}) {
  const t = options.t || englishT;
  const nonce = crypto.randomBytes(16).toString('hex');
  const script = SCRIPT.replace('AUTO_MODE', JSON.stringify(autoMode)).replace('STRINGS', () => scriptJson(sidebarStrings(t)));
  return `<!doctype html>
<html lang="${htmlLang(options.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>${guideCss('sideBar')}${SIDEBAR_CSS}</style></head><body>
<header><p class="eyebrow">${t('REPOSITORY INTELLIGENCE')}</p><h1>${t('Remote inventory')}</h1><p class="lede">${t('Local worktrees and remote branch status')}</p></header>
<section id="summary" class="metrics" aria-label="${t('Repository summary')}"></section>
<nav class="controls" aria-label="${t('Inventory actions')}"><button id="mode" data-action="toggleAuto" aria-pressed="false">${t('Auto refresh')}</button><button id="refresh" class="primary" data-action="refresh">${t('Refresh all')}</button><button id="dashboard" data-action="openDashboard">${t('Dashboard ↗')}</button></nav>
<p id="status" class="status" role="status"></p><section class="repositories" aria-label="${t('Repositories')}"><h2>${t('Repositories')}</h2><div id="repositories"></div></section>
<script nonce="${nonce}">${script}</script></body></html>`;
}

module.exports = { sidebarHtml, sidebarStrings };
