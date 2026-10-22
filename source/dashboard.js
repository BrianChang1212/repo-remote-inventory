const crypto = require('node:crypto');

const DASHBOARD_SCRIPT = `
const vscode = acquireVsCodeApi();
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
      (row.stale ? ' <b class="stale">STALE</b>' : '') + '</span><span class="repo-signal">' +
      (row.worktreeWarning ? '<span class="dirty">dirty unknown</span>' : row.dirty ? '<span class="dirty">' + esc(row.dirty) + ' dirty</span>' : 'clean') +
      '</span><span class="chevron">⌄</span></summary>' +
      '<div class="repo-details"><dl><dt>Branch</dt><dd>' + esc(row.branch || '—') + '</dd>' +
      '<dt>Compare target</dt><dd>' + esc(row.compareTarget || '—') + '</dd>' +
      '<dt>Ahead / behind</dt><dd>' + esc(row.ahead || 0) + ' / ' + esc(row.behind || 0) + '</dd>' +
      '<dt>Local / remote SHA</dt><dd>' + esc(row.localSha || '—') + ' / ' + esc(row.remoteSha || '—') + '</dd>' +
      '<dt>Last commit / check</dt><dd>' + esc(row.lastCommit || '—') + ' / ' + esc(row.lastSuccessAt || row.checkedAt || '—') + '</dd>' +
      '<dt>Path</dt><dd>' + esc(row.path) + '</dd></dl></div></details>' +
      '<button class="repo-refresh" data-action="refreshRepository" data-path="' + esc(row.path) + '" aria-label="Refresh ' + esc(row.label || row.path) + '">↻</button></article>').join('');

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
    (rows.some(row => row.stale) ? ' · cached snapshot; STALE until refreshed' : '');
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
    :root { color-scheme: dark; --base:#080d0a; --surface:#111b14; --raised:#1b2a20; --line:#31513a; --text:#e5f5e8; --muted:#a4c3aa; --accent:#89e829; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; padding:24px; font:14px/1.65 var(--vscode-font-family,Segoe UI,sans-serif); color:var(--text); background:radial-gradient(ellipse at 95% 0%,#16402344,transparent 37%),linear-gradient(#75e73e08 1px,transparent 1px),linear-gradient(90deg,#75e73e08 1px,transparent 1px),var(--base); background-size:auto,32px 32px,32px 32px,auto; }
    h1 { margin:0 0 12px; font:700 1.7rem/1.3 Consolas,'Cascadia Code',monospace; letter-spacing:.035em; text-shadow:0 0 22px #89e82944; }
    h1::before { content:""; display:inline-block; width:7px; height:.85em; margin-right:11px; background:var(--accent); box-shadow:0 0 14px #89e829aa; }
    button { min-height:32px; padding:6px 12px; font:inherit; font-weight:600; color:var(--text); background:var(--raised); border:1px solid var(--line); border-radius:4px; cursor:pointer; }
    button:hover { border-color:var(--accent); background:#29432b; box-shadow:0 0 13px #89e8292b; }
    button:focus-visible, summary:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
    .bar { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
    .summary-row { display:flex; flex-wrap:wrap; gap:8px; margin:12px 0; }
    .summary-card { display:flex; flex-direction:column; gap:4px; min-width:110px; padding:10px; background:linear-gradient(145deg,#16251aee,#0e1812f2); border:1px solid var(--line); border-radius:6px; box-shadow:inset 0 1px #b4ff7f14,0 10px 24px #0004; }
    .summary-card strong { font:700 20px/1.2 Consolas,'Cascadia Code',monospace; color:var(--accent); text-shadow:0 0 15px #89e82977; }
    .track { height:18px; flex:1; background:var(--raised); }
    .fill { height:100%; background:var(--accent); }
    .bar button { min-width:205px; text-align:left; }
    #meta, #signals { color:var(--muted); }
    #rows { display:grid; gap:7px; margin-top:18px; }
    .repo { display:flex; align-items:flex-start; min-width:0; background:linear-gradient(145deg,#16251aee,#0e1812f2); border:1px solid var(--line); border-radius:6px; box-shadow:inset 2px 0 0 #89e82988,inset 0 1px #b4ff7f14,0 10px 24px #0004; }
    .repo:hover { border-color:#63a94c; box-shadow:inset 2px 0 0 var(--accent),inset 0 1px #b4ff7f19,0 12px 30px #0007,0 0 22px #89e82912; }
    .repo:has(details[open]) { border-color:#63a94c; }
    .repo details { flex:1; min-width:0; }
    .repo-refresh { flex:none; margin:7px; color:var(--accent); }
    summary { display:flex; gap:12px; align-items:center; min-width:0; padding:12px; cursor:pointer; list-style:none; }
    summary::-webkit-details-marker { display:none; }
    .repo-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:700; }
    .repo-status { min-width:90px; color:var(--accent); font-weight:700; }
    .repo-status .stale { margin-left:5px; }
    .repo-signal { min-width:90px; }
    .chevron { color:var(--accent); }
    .repo details[open] .chevron { transform:rotate(180deg); }
    .repo-details { padding:0 12px 12px; border-top:1px solid var(--line); }
    dl { display:grid; grid-template-columns:145px minmax(0,1fr); gap:6px 12px; }
    dt { color:var(--muted); } dd { margin:0; overflow-wrap:anywhere; }
    .stale { color:#ffd18a; }
    .dirty { color:#c9f69d; }
    @media(max-width:800px) { body { padding:12px; } .bar button { min-width:120px; } .repo-status { min-width:0; } .repo-signal { display:none; } dl { grid-template-columns:1fr; } dt { margin-top:6px; } }
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
  <section id="rows" aria-label="Repositories"></section>
  <script nonce="${nonce}">${script}</script>
</body>
</html>`;
}

module.exports = { dashboardHtml };
