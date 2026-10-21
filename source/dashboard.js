const crypto = require('node:crypto');

const DASHBOARD_SCRIPT = `
const vscode = acquireVsCodeApi();
let rows = [];
let filter = '';
let auto = AUTO_MODE;

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
    .map(row => '<tr><td>' + esc(row.label || row.path) + '</td>' +
      '<td>' + esc(row.status) + (row.stale ? ' <b class="stale">STALE</b>' : '') + '</td>' +
      '<td>' + (row.worktreeWarning ? '<span class="dirty">dirty unknown</span>' :
        row.dirty ? '<span class="dirty">' + row.dirty + ' dirty</span>' : 'clean') + '</td>' +
      '<td>' + esc(row.branch || '—') + '</td>' +
      '<td>' + esc(row.compareTarget || '—') + ' / ' + (row.ahead || 0) + ' / ' + (row.behind || 0) + '</td>' +
      '<td>' + esc(row.localSha || '—') + ' / ' + esc(row.remoteSha || '—') + '</td>' +
      '<td>' + esc(row.lastCommit || '—') + ' / ' + esc(row.lastSuccessAt || row.checkedAt || '—') + '</td>' +
      '<td>' + esc(row.path) + '</td></tr>').join('');

  document.querySelector('#signals').textContent = 'STALE: ' + rows.filter(row => row.stale).length +
    ' · Dirty: ' + rows.filter(row => row.worktreeWarning || row.dirty > 0).length;
  const needsAttention = rows.filter(row => row.stale || row.worktreeWarning || row.status !== 'IN_SYNC').length;
  document.querySelector('#summary').innerHTML = [
    ['All', rows.length],
    ['In Sync', rows.filter(row => !row.stale && row.status === 'IN_SYNC').length],
    ['Needs Attention', needsAttention],
    ['Stale', rows.filter(row => row.stale).length],
  ].map(([label, count]) => '<div class="summary-card"><span>' + label + '</span><strong>' + count + '</strong></div>').join('');
  document.querySelector('#meta').textContent = rows.length + ' repositories · Last check: ' +
    (window.checkedAt ? new Date(window.checkedAt).toLocaleString() : 'unknown') +
    (rows.some(row => row.persisted) ? ' · cached snapshot; STALE until refreshed' : '');
  document.querySelector('#mode').textContent = 'Mode: ' + (auto ? 'Auto' : 'Manual');
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
vscode.postMessage({ command: 'ready' });
`;

function dashboardHtml(webview, autoMode) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const script = DASHBOARD_SCRIPT.replace('AUTO_MODE', JSON.stringify(autoMode));
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body { font: 13px var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
    button { font: inherit; color: inherit; background: var(--vscode-button-secondaryBackground); border: 0; padding: 6px 10px; cursor: pointer; }
    .bar { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
    .summary-row { display: flex; gap: 8px; margin: 12px 0; }
    .summary-card { display: flex; flex-direction: column; gap: 4px; min-width: 110px; padding: 10px; background: var(--vscode-sideBar-background); }
    .summary-card strong { font-size: 20px; }
    .track { height: 18px; flex: 1; background: var(--vscode-input-background); }
    .fill { height: 100%; background: var(--vscode-charts-blue); }
    table { border-collapse: collapse; width: 100%; margin-top: 20px; }
    td, th { text-align: left; padding: 6px; border-bottom: 1px solid var(--vscode-panel-border); }
    .stale { color: var(--vscode-editorWarning-foreground); }
    .dirty { color: var(--vscode-testing-iconFailed); }
  </style>
</head>
<body>
  <h1>Repository inventory</h1>
  <button id="mode"></button> <button id="refresh">Refresh</button>
  <section id="summary" class="summary-row" aria-label="Repository summary"></section>
  <div id="meta"></div>
  <section id="chart"></section>
  <p id="signals"></p>
  <button id="clear">Clear filter</button>
  <table>
    <thead><tr><th>Repository</th><th>Status</th><th>Signals</th><th>Branch</th><th>Remote / Ahead / Behind</th><th>Local / Remote SHA</th><th>Last commit / Check</th><th>Path</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <script nonce="${nonce}">${script}</script>
</body>
</html>`;
}

module.exports = { dashboardHtml };
