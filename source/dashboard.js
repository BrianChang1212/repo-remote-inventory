const crypto = require('node:crypto');
const { englishT, htmlLang, format, formatDateTime, scriptJson } = require('./l10n');
const { guideCss } = require('./style');
const { noteStrings, translateNote } = require('./refresh-note');
const { repositoryCounts, repositoryMatches } = require('./presentation');

// Strings drawn by the webview script; translated on the extension host (guide §2.3).
function dashboardStrings(t) {
  return {
    stale: t('Stale'), dirtyUnknown: t('Dirty unknown'), dirtyCount: t('{0} dirty'), clean: t('Clean'),
    branch: t('Branch'), compareTarget: t('Compare target'), aheadBehind: t('Ahead / behind'),
    localRemoteSha: t('Local / remote SHA'), lastCommitCheck: t('Last commit / check'), path: t('Path'),
    refreshNamed: t('Refresh {0}'), signals: t('Stale: {0} · Dirty: {1}'),
    total: t('TOTAL'), current: t('CURRENT'), attention: t('ATTENTION'),
    unconfirmed: t('{0} unconfirmed; current attention count is incomplete.'),
    noRepositories: t('No repositories to display.'), noMatches: t('No repositories match your search and filter.'),
    meta: t('{0} repositories · Last check: {1}'),
    metaStale: t('{0} repositories · Last check: {1} · cached snapshot; stale until refreshed'),
    unknown: t('unknown'), modeAuto: t('Mode: Auto'), modeManual: t('Mode: Manual'),
    notes: noteStrings(t),
  };
}

const DASHBOARD_SCRIPT = `
const vscode = acquireVsCodeApi();
const S = STRINGS;
${format.toString()}
${formatDateTime.toString()}
${translateNote.toString()}
${repositoryCounts.toString()}
${repositoryMatches.toString()}
let rows = [];
let filter = '';
let query = '';
let selected = 'all';
let message = '';
let auto = AUTO_MODE;
const expanded = new Set();

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

function draw() {
  const counts = {};
  rows.filter(row => !row.stale).forEach(row => {
    const status = row.status || 'PENDING';
    counts[status] = (counts[status] || 0) + 1;
  });
  const max = Math.max(1, ...Object.values(counts));
  document.querySelector('#chart').innerHTML = Object.entries(counts).map(([status, count]) =>
    '<div class="bar"><button data-status="' + esc(status) + '">' + esc(status) + ' (' + count + ')</button>' +
    '<div class="track"><div class="fill" style="width:' + count / max * 100 + '%"></div></div></div>').join('');

  document.querySelector('#rows').innerHTML = rows
    .filter(row => repositoryMatches(row, query, selected) && (!filter || row.status === filter))
    .map(row => '<article class="repo"><details data-path="' + esc(row.path) + '"' + (expanded.has(row.path) ? ' open' : '') + '>' +
      '<summary><span class="repo-name">' + esc(row.label || row.path) + '</span><span class="repo-status">' + esc(row.status) +
      (row.stale ? ' <b class="tag warn">' + esc(S.stale) + '</b>' : '') + '</span><span class="repo-signal">' +
      (row.worktreeWarning ? '<span class="dirty">' + esc(S.dirtyUnknown) + '</span>' : row.dirty ? '<span class="dirty">' + esc(format(S.dirtyCount, [row.dirty])) + '</span>' : esc(S.clean)) +
      '</span><span class="chevron" aria-hidden="true">⌄</span></summary>' +
      '<div class="repo-details"><dl><dt>' + esc(S.branch) + '</dt><dd>' + esc(row.branch || '—') + '</dd>' +
      '<dt>' + esc(S.compareTarget) + '</dt><dd>' + esc(row.compareTarget || '—') + '</dd>' +
      '<dt>' + esc(S.aheadBehind) + '</dt><dd>' + esc(row.ahead || 0) + ' / ' + esc(row.behind || 0) + '</dd>' +
      '<dt>' + esc(S.localRemoteSha) + '</dt><dd class="sha">' + esc(row.localSha || '—') + ' / ' + esc(row.remoteSha || '—') + '</dd>' +
      '<dt>' + esc(S.lastCommitCheck) + '</dt><dd>' + esc(row.lastCommit || '—') + ' / ' + esc(formatDateTime(row.lastSuccessAt || row.checkedAt) || '—') + '</dd>' +
      '<dt>' + esc(S.path) + '</dt><dd>' + esc(row.path) + '</dd></dl>' +
      (row.refreshError ? '<p class="note">' + esc(translateNote(row.refreshError, S.notes)) + '</p>' : '') + '</div></details>' +
      '<button class="repo-refresh" data-action="refreshRepository" data-path="' + esc(row.path) + '" aria-label="' + esc(format(S.refreshNamed, [row.label || row.path])) + '">↻</button></article>').join('') ||
      '<div class="empty">' + esc(rows.length ? S.noMatches : S.noRepositories) + '</div>';

  document.querySelector('#signals').textContent = format(S.signals, [
    rows.filter(row => row.stale).length, rows.filter(row => row.worktreeWarning || row.dirty > 0).length]);
  const totals = repositoryCounts(rows);
  document.querySelector('#summary').innerHTML = [
    [S.total, totals.total], [S.current, totals.current], [S.attention, totals.attention ?? '—'],
  ].map(([label, count]) => '<div class="metric summary-card"><span>' + esc(label) + '</span><strong>' + count + '</strong></div>').join('');
  document.querySelector('#meta').textContent = format(rows.some(row => row.stale) ? S.metaStale : S.meta,
    [rows.length, window.checkedAt ? formatDateTime(window.checkedAt) : S.unknown]) +
    (totals.unconfirmed ? ' · ' + format(S.unconfirmed, [totals.unconfirmed]) : '');
  const statusElement = document.querySelector('#status');
  if (statusElement) statusElement.textContent = message;
  for (const key of ['all', 'attention', 'sync']) {
    document.querySelector('#filter-' + key)?.setAttribute('aria-pressed', String(selected === key));
  }
  document.querySelector('#mode').textContent = auto ? S.modeAuto : S.modeManual;
  document.querySelectorAll('[data-status]').forEach(button => {
    button.onclick = () => { filter = button.dataset.status; draw(); };
  });
}

window.addEventListener('message', event => {
  if (event.data.type === 'rows') {
    rows = event.data.rows;
    message = event.data.message || '';
    window.checkedAt = event.data.checkedAt;
    draw();
  } else if (event.data.type === 'mode') {
    auto = event.data.autoMode;
    draw();
  }
});
document.querySelector('#clear').onclick = () => {
  filter = ''; query = ''; selected = 'all';
  document.querySelector('#search').value = '';
  draw();
};
document.addEventListener('input', event => {
  if (event.target.id !== 'search') return;
  query = event.target.value;
  draw();
});
document.querySelector('#mode').onclick = () => vscode.postMessage({ command: 'toggleAuto' });
document.querySelector('#refresh').onclick = () => vscode.postMessage({ command: 'refresh' });
document.addEventListener('toggle', event => {
  if (event.target.isConnected === false) return;
  const card = event.target.closest('details[data-path]');
  if (!card) return;
  if (card.open) expanded.add(card.dataset.path);
  else expanded.delete(card.dataset.path);
}, true);
document.addEventListener('click', event => {
  const statusFilter = event.target.closest('[data-filter]');
  if (statusFilter) { selected = statusFilter.dataset.filter; filter = ''; draw(); return; }
  const button = event.target.closest('[data-action="refreshRepository"]');
  if (button) vscode.postMessage({ command: 'refreshRepository', path: button.dataset.path });
});
vscode.postMessage({ command: 'ready' });
`;

const DASHBOARD_CSS = `
body { min-height: 100vh; padding: 24px; }
h1 { margin: 0 0 12px; font-size: 1.7rem; line-height: 1.3; }
.bar { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
.summary-row { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.summary-card { min-width: 110px; }
.track { height: 18px; flex: 1; background: var(--raised); }
.fill { height: 100%; background: var(--accent); }
.bar button { min-width: 205px; text-align: left; }
#meta, #signals { color: var(--muted); }
#rows { display: grid; gap: 7px; margin-top: 18px; }
.repo { display: flex; align-items: flex-start; min-width: 0; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; box-shadow: inset 2px 0 0 var(--accent); }
.repo:hover, .repo:has(details[open]) { border-color: var(--accent); }
.repo details { flex: 1; min-width: 0; }
.repo-refresh { flex: none; margin: 7px; color: var(--accent); }
summary { display: flex; gap: 12px; align-items: center; min-width: 0; padding: 12px; cursor: pointer; list-style: none; }
summary::-webkit-details-marker { display: none; }
.repo-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
.repo-status { min-width: 90px; color: var(--accent); font-weight: 700; }
.repo-status .tag { margin-left: 5px; }
.repo-signal { min-width: 90px; }
.chevron { color: var(--accent); }
.repo details[open] .chevron { transform: rotate(180deg); }
.repo-details { padding: 0 12px 12px; border-top: 1px solid var(--line); }
dl { display: grid; grid-template-columns: 145px minmax(0, 1fr); gap: 6px 12px; }
dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
.sha { font-family: var(--mono); }
.dirty { color: var(--accent); }
.note { color: var(--warn); overflow-wrap: anywhere; }
@media (max-width: 800px) { body { padding: 12px; } .bar button { min-width: 120px; } .repo-status { min-width: 0; } .repo-signal { display: none; } dl { grid-template-columns: 1fr; } dt { margin-top: 6px; } }
`;

function dashboardHtml(webview, autoMode, options = {}) {
  const t = options.t || englishT;
  const nonce = crypto.randomBytes(16).toString('hex');
  const script = DASHBOARD_SCRIPT.replace('AUTO_MODE', JSON.stringify(autoMode)).replace('STRINGS', () => scriptJson(dashboardStrings(t)));
  return `<!doctype html>
<html lang="${htmlLang(options.language)}">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>${guideCss('editor')}${DASHBOARD_CSS}</style>
</head>
<body>
  <h1>${t('Repository inventory')}</h1>
  <button id="mode"></button> <button class="primary" id="refresh">${t('Refresh')}</button>
  <section id="summary" class="summary-row" aria-label="${t('Repository summary')}"></section>
  <div id="meta"></div>
  <p id="status" class="status" role="status"></p>
  <section id="chart"></section>
  <p id="signals"></p>
  <button id="clear">${t('Clear filter')}</button>
  <input id="search" class="search" type="search" aria-label="${t('Search repositories')}" placeholder="${t('Name, or path with / or \\')}">
  <nav class="filters" aria-label="${t('Repository filters')}"><button id="filter-all" data-filter="all" aria-pressed="true">${t('All')}</button><button id="filter-attention" data-filter="attention" aria-pressed="false">${t('Attention')}</button><button id="filter-sync" data-filter="sync" aria-pressed="false">${t('In sync')}</button></nav>
  <section id="rows" aria-label="${t('Repositories')}"></section>
  <script nonce="${nonce}">${script}</script>
</body>
</html>`;
}

module.exports = { dashboardHtml, dashboardStrings };
