const crypto = require('node:crypto');
const { englishT, htmlLang, format, formatDateTime, scriptJson } = require('./l10n');
const { guideCss } = require('./style');

// Strings drawn by the webview script; translated on the extension host (guide §2.3).
function dashboardStrings(t) {
  return {
    stale: t('Stale'), dirtyUnknown: t('Dirty unknown'), dirtyCount: t('{0} dirty'), clean: t('Clean'),
    branch: t('Branch'), compareTarget: t('Compare target'), aheadBehind: t('Ahead / behind'),
    localRemoteSha: t('Local / remote SHA'), lastCommitCheck: t('Last commit / check'), path: t('Path'),
    refreshNamed: t('Refresh {0}'), signals: t('Stale: {0} · Dirty: {1}'),
    all: t('All'), inSync: t('In Sync'), needsAttention: t('Needs Attention'), staleCount: t('Stale'),
    meta: t('{0} repositories · Last check: {1}'),
    metaStale: t('{0} repositories · Last check: {1} · cached snapshot; stale until refreshed'),
    unknown: t('unknown'), modeAuto: t('Mode: Auto'), modeManual: t('Mode: Manual'),
  };
}

const DASHBOARD_SCRIPT = `
const vscode = acquireVsCodeApi();
const S = STRINGS;
${format.toString()}
${formatDateTime.toString()}
let rows = [];
let filter = '';
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
    .filter(row => !filter || row.status === filter)
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
      '<dt>' + esc(S.path) + '</dt><dd>' + esc(row.path) + '</dd></dl></div></details>' +
      '<button class="repo-refresh" data-action="refreshRepository" data-path="' + esc(row.path) + '" aria-label="' + esc(format(S.refreshNamed, [row.label || row.path])) + '">↻</button></article>').join('');

  document.querySelector('#signals').textContent = format(S.signals, [
    rows.filter(row => row.stale).length, rows.filter(row => row.worktreeWarning || row.dirty > 0).length]);
  const needsAttention = rows.filter(row => row.stale || row.worktreeWarning || row.status !== 'IN_SYNC').length;
  document.querySelector('#summary').innerHTML = [
    [S.all, rows.length],
    [S.inSync, rows.filter(row => !row.stale && row.status === 'IN_SYNC').length],
    [S.needsAttention, needsAttention],
    [S.staleCount, rows.filter(row => row.stale).length],
  ].map(([label, count]) => '<div class="metric summary-card"><span>' + esc(label) + '</span><strong>' + count + '</strong></div>').join('');
  document.querySelector('#meta').textContent = format(rows.some(row => row.stale) ? S.metaStale : S.meta,
    [rows.length, window.checkedAt ? formatDateTime(window.checkedAt) : S.unknown]);
  document.querySelector('#mode').textContent = auto ? S.modeAuto : S.modeManual;
  document.querySelectorAll('[data-status]').forEach(button => {
    button.onclick = () => { filter = button.dataset.status; draw(); };
  });
}

window.addEventListener('message', event => {
  if (event.data.type === 'rows') {
    rows = event.data.rows;
    window.checkedAt = event.data.checkedAt;
    draw();
  } else if (event.data.type === 'mode') {
    auto = event.data.autoMode;
    draw();
  }
});
document.querySelector('#clear').onclick = () => { filter = ''; draw(); };
document.querySelector('#mode').onclick = () => vscode.postMessage({ command: 'toggleAuto' });
document.querySelector('#refresh').onclick = () => vscode.postMessage({ command: 'refresh' });
document.addEventListener('toggle', event => {
  const card = event.target.closest('details[data-path]');
  if (!card) return;
  if (card.open) expanded.add(card.dataset.path);
  else expanded.delete(card.dataset.path);
}, true);
document.addEventListener('click', event => {
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
  <section id="chart"></section>
  <p id="signals"></p>
  <button id="clear">${t('Clear filter')}</button>
  <section id="rows" aria-label="${t('Repositories')}"></section>
  <script nonce="${nonce}">${script}</script>
</body>
</html>`;
}

module.exports = { dashboardHtml, dashboardStrings };
