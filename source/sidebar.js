const crypto = require('node:crypto');

const SCRIPT = `
const vscode = acquireVsCodeApi();
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
    ['TOTAL', rows.length], ['CURRENT', current.length], ['ATTENTION', attention.length],
  ].map(([label, count]) => '<div class="metric"><span>' + label + '</span><strong>' + count + '</strong></div>').join('');
  document.querySelector('#mode').textContent = autoMode ? 'Auto refresh: On' : 'Auto refresh: Off';
  document.querySelector('#mode').setAttribute('aria-pressed', String(autoMode));
  document.querySelector('#status').textContent = message || (rows.length ? 'Last known repository results' : 'Open a scan directory or refresh to find repositories.');
  document.querySelector('#repositories').innerHTML = rows.map(row => {
    const path = String(row.path || '');
    const name = value(row.label && row.label !== '.' && row.label !== path ? row.label : path.split(String.fromCharCode(92)).at(-1).split('/').at(-1), 'Unnamed repository');
    const status = value(row.status, 'PENDING');
    const flag = row.stale ? '<span class="flag stale">STALE</span>' : '';
    const dirty = row.worktreeWarning ? 'Dirty unknown' : row.dirty > 0 ? row.dirty + ' dirty' : 'Clean worktree';
    const dirtyFlag = row.worktreeWarning ? '<span class="flag dirty-flag">DIRTY UNKNOWN</span>' :
      row.dirty > 0 ? '<span class="flag dirty-flag">' + esc(row.dirty) + ' DIRTY</span>' : '';
    const timestamp = row.lastSuccessAt || row.checkedAt;
    return '<details class="repo" data-path="' + esc(path) + '"' + (expanded.has(path) ? ' open' : '') + '>' +
      '<summary title="' + esc(path) + '"><span class="repo-main"><strong>' + name + '</strong><small>' + status + flag + dirtyFlag + '</small></span><span class="chevron" aria-hidden="true">⌄</span></summary>' +
      '<div class="repo-body"><div class="signal">' + esc(dirty) + '</div>' +
      '<dl><dt>Branch</dt><dd>' + value(row.branch) + '</dd><dt>Compare target</dt><dd>' + value(row.compareTarget) + '</dd>' +
      '<dt>Ahead / behind</dt><dd>' + value(row.ahead, '0') + ' / ' + value(row.behind, '0') + '</dd>' +
      '<dt>Local SHA</dt><dd class="sha">' + value(row.localSha) + '</dd><dt>Remote SHA</dt><dd class="sha">' + value(row.remoteSha) + '</dd>' +
      '<dt>Last commit</dt><dd>' + value(row.lastCommit) + '</dd><dt>Last check</dt><dd>' + value(timestamp) + '</dd>' +
      '<dt>Path</dt><dd class="path">' + esc(path) + '</dd></dl>' +
      (row.refreshError ? '<p class="note">' + esc(row.refreshError) + '</p>' : '') +
      '<button class="row-action" data-action="refreshRepository" data-path="' + esc(path) + '">Refresh repository</button></div></details>';
  }).join('') || '<div class="empty">No repositories to display.</div>';
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

function sidebarHtml(webview, autoMode) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const script = SCRIPT.replace('AUTO_MODE', JSON.stringify(autoMode));
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root { color-scheme:dark; --base:#080d0a; --surface:#111b14; --raised:#1b2a20; --line:#31513a; --text:#e5f5e8; --muted:#a4c3aa; --accent:#89e829; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; padding:16px 14px 28px; background:radial-gradient(ellipse at 95% 0%,#16402344,transparent 37%),linear-gradient(#75e73e08 1px,transparent 1px),linear-gradient(90deg,#75e73e08 1px,transparent 1px),var(--base); background-size:auto,32px 32px,32px 32px,auto; color:var(--text); font:14px/1.65 var(--vscode-font-family,Segoe UI,sans-serif); }
  .eyebrow { margin:0 0 4px; color:var(--accent); font-size:10px; font-weight:800; letter-spacing:.18em; }
  h1 { margin:0; font:700 20px/1.15 Consolas,'Cascadia Code',monospace; letter-spacing:.035em; text-shadow:0 0 22px #89e82944; }
  h1::before { content:""; display:inline-block; width:5px; height:.85em; margin-right:8px; background:var(--accent); box-shadow:0 0 14px #89e829aa; }
  .lede { margin:8px 0 16px; color:var(--muted); font-size:12px; }
  .metrics { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:5px; margin-bottom:16px; }
  .metric { min-width:0; padding:9px 7px; border:1px solid var(--line); border-radius:6px; background:linear-gradient(145deg,#16251aee,#0e1812f2); box-shadow:inset 0 1px #b4ff7f14,0 10px 24px #0004; }
  .metric span { display:block; color:var(--muted); font-size:10px; font-weight:700; letter-spacing:.04em; }
  .metric strong { display:block; margin-top:1px; color:var(--accent); font:700 19px/1.2 Consolas,'Cascadia Code',monospace; font-variant-numeric:tabular-nums; text-shadow:0 0 15px #89e82977; }
  .controls { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; }
  button { min-height:32px; border:1px solid var(--line); border-radius:4px; background:var(--raised); color:var(--text); font:inherit; font-weight:600; cursor:pointer; }
  button:hover { border-color:var(--accent); background:#29432b; box-shadow:0 0 13px #89e8292b; }
  button:focus-visible, summary:focus-visible { outline:2px solid #a5e24a; outline-offset:2px; }
  #mode { grid-column:1/-1; text-align:left; padding:7px 10px; }
  #mode[aria-pressed="true"] { border-color:#567e2a; background:#202d1b; color:#c9f69d; }
  #mode::before { content:""; display:inline-block; width:7px; height:7px; margin-right:8px; border-radius:50%; background:var(--muted); }
  #mode[aria-pressed="true"]::before { background:var(--accent); box-shadow:0 0 8px #76b90099; }
  #status { margin:14px 0 17px; padding-left:8px; border-left:2px solid var(--accent); color:var(--muted); font-size:12px; overflow-wrap:anywhere; }
  h2 { margin:0 0 8px; color:var(--muted); font-size:10px; letter-spacing:.15em; text-transform:uppercase; }
  .repo { margin:0 0 7px; border:1px solid var(--line); border-radius:6px; background:linear-gradient(145deg,#16251aee,#0e1812f2); box-shadow:inset 2px 0 0 #89e82988,inset 0 1px #b4ff7f14,0 10px 24px #0004; }
  .repo:hover { border-color:#63a94c; box-shadow:inset 2px 0 0 var(--accent),inset 0 1px #b4ff7f19,0 12px 30px #0007,0 0 22px #89e82912; }
  .repo[open] { border-color:#63a94c; }
  summary { display:flex; justify-content:space-between; gap:8px; align-items:center; padding:10px; cursor:pointer; list-style:none; }
  summary::-webkit-details-marker { display:none; }
  .repo-main { min-width:0; }
  .repo-main strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .repo-main small { display:block; margin-top:2px; color:var(--muted); font-size:11px; font-weight:700; letter-spacing:.04em; }
  .chevron { flex:none; color:var(--accent); font-size:19px; line-height:1; transition:transform .18s ease; }
  .repo[open] .chevron { transform:rotate(180deg); }
  .flag { margin-left:6px; padding:1px 4px; border:1px solid #a97325; border-radius:3px; color:#ffd18a; }
  .dirty-flag { border-color:#567e2a; color:#c9f69d; }
  .repo-body { padding:0 10px 11px; border-top:1px solid var(--line); }
  .signal { margin:9px 0; color:#c5e5aa; font-size:12px; }
  dl { display:grid; grid-template-columns:82px minmax(0,1fr); gap:5px 8px; margin:0 0 12px; font-size:12px; }
  dt { color:var(--muted); } dd { min-width:0; margin:0; overflow-wrap:anywhere; }
  .sha { font-family:var(--vscode-editor-font-family,Consolas,monospace); font-size:11px; }
  .path { color:var(--muted); }
  .row-action { width:100%; }
  .note { color:#ffd18a; overflow-wrap:anywhere; }
  .empty { padding:16px 10px; border:1px dashed var(--line); color:var(--muted); }
  @media (prefers-reduced-motion:reduce) { .chevron { transition:none; } }
</style></head><body>
<header><p class="eyebrow">REPOSITORY INTELLIGENCE</p><h1>Remote inventory</h1><p class="lede">Local worktrees and remote branch status</p></header>
<section id="summary" class="metrics" aria-label="Repository summary"></section>
<nav class="controls" aria-label="Inventory actions"><button id="mode" data-action="toggleAuto" aria-pressed="false">Auto refresh</button><button id="refresh" data-action="refresh">Refresh all</button><button id="dashboard" data-action="openDashboard">Dashboard ↗</button></nav>
<p id="status" role="status"></p><section aria-label="Repositories"><h2>Repositories</h2><div id="repositories"></div></section>
<script nonce="${nonce}">${script}</script></body></html>`;
}

module.exports = { sidebarHtml };
