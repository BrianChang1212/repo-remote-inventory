const crypto = require('node:crypto');
const { englishT, htmlLang, format, formatDateTime, scriptJson } = require('./l10n');
const { guideCss, inventoryCss } = require('./style');
const { noteStrings, translateNote } = require('./refresh-note');
const { repositoryCounts, repositoryMatches } = require('./presentation');

// Strings drawn by the webview script; translated on the extension host (guide §2.3).
function sidebarStrings(t) {
  return {
    total: t('TOTAL'), current: t('CURRENT'), attention: t('ATTENTION'),
    autoOn: t('Auto refresh: On'), autoOff: t('Auto refresh: Off'),
    lastKnown: t('Last known repository results'),
    unconfirmed: t('{0} unconfirmed; current attention count is incomplete.'),
    emptyHint: t('Open a scan directory or refresh to find repositories.'),
    unnamed: t('Unnamed repository'), stale: t('Stale'),
    dirtyUnknown: t('Dirty unknown'), dirtyCount: t('{0} dirty'), clean: t('Clean worktree'),
    dirtyUnknownFlag: t('Dirty unknown'), dirtyCountFlag: t('{0} dirty'),
    branch: t('Branch'), compareTarget: t('Compare target'), aheadBehind: t('Ahead / behind'),
    localSha: t('Local SHA'), remoteSha: t('Remote SHA'), lastCommit: t('Last commit'),
    lastCheck: t('Last check'), path: t('Path'), refreshRepository: t('Refresh repository'),
    noRepositories: t('No repositories to display.'),
    noMatches: t('No repositories match your search and filter.'),
    notes: noteStrings(t),
  };
}

const SCRIPT = `
const vscode = acquireVsCodeApi();
const S = STRINGS;
${format.toString()}
${formatDateTime.toString()}
${translateNote.toString()}
${repositoryCounts.toString()}
${repositoryMatches.toString()}
let rows = [];
let autoMode = AUTO_MODE;
let message = '';
let query = '';
let selected = 'all';
const expanded = new Set();
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const value = (item, fallback = '—') => esc(item == null || item === '' ? fallback : item);

function draw() {
  const counts = repositoryCounts(rows);
  const unconfirmedNote = counts.unconfirmed ? format(S.unconfirmed, [counts.unconfirmed]) : '';
  const allStale = rows.length > 0 && rows.every(row => row.stale);
  document.querySelector('#summary').innerHTML = [
    [S.total, counts.total], [S.current, counts.current], [S.attention, counts.attention ?? '—'],
  ].map(([label, count]) => '<div class="metric"><span>' + esc(label) + '</span><strong>' + count + '</strong></div>').join('');
  document.querySelector('#mode').textContent = autoMode ? S.autoOn : S.autoOff;
  document.querySelector('#mode').setAttribute('aria-pressed', String(autoMode));
  document.querySelector('#status').textContent = [
    message || (rows.length ? S.lastKnown : S.emptyHint),
    allStale && message ? S.lastKnown : '',
    unconfirmedNote && !message.includes(unconfirmedNote) ? unconfirmedNote : '',
  ].filter(Boolean).join(' · ');
  const visible = rows.filter(row => repositoryMatches(row, query, selected));
  document.querySelector('#repositories').innerHTML = visible.map(row => {
    const path = String(row.path || '');
    const label = row.label && row.label !== '.' ? String(row.label) : path;
    const name = value(label.split(String.fromCharCode(92)).at(-1).split('/').at(-1), S.unnamed);
    const status = value(row.status, 'PENDING');
    const flag = row.stale && !allStale ? '<span class="freshness">' + esc(S.stale) + '</span>' : '';
    const dirty = row.worktreeWarning ? S.dirtyUnknown : row.dirty > 0 ? format(S.dirtyCount, [row.dirty]) : S.clean;
    const dirtyFlag = row.worktreeWarning ? '<span class="tag ok">' + esc(S.dirtyUnknownFlag) + '</span>' :
      row.dirty > 0 ? '<span class="tag ok">' + esc(format(S.dirtyCountFlag, [row.dirty])) + '</span>' : '';
    const timestamp = formatDateTime(row.lastSuccessAt || row.checkedAt);
    return '<details class="repo" data-path="' + esc(path) + '"' + (expanded.has(path) ? ' open' : '') + '>' +
      '<summary title="' + esc(label + ' · ' + path) + '"><span class="repo-main"><strong>' + name + '</strong><small>' + status + flag + dirtyFlag + '</small></span><span class="chevron" aria-hidden="true">⌄</span></summary>' +
      '<div class="repo-body"><div class="signal">' + esc(dirty) + '</div>' +
      '<dl><dt>' + esc(S.branch) + '</dt><dd>' + value(row.branch) + '</dd><dt>' + esc(S.compareTarget) + '</dt><dd>' + value(row.compareTarget) + '</dd>' +
      '<dt>' + esc(S.aheadBehind) + '</dt><dd>' + value(row.ahead, '0') + ' / ' + value(row.behind, '0') + '</dd>' +
      '<dt>' + esc(S.localSha) + '</dt><dd class="sha">' + value(row.localSha) + '</dd><dt>' + esc(S.remoteSha) + '</dt><dd class="sha">' + value(row.remoteSha) + '</dd>' +
      '<dt>' + esc(S.lastCommit) + '</dt><dd>' + value(row.lastCommit) + '</dd><dt>' + esc(S.lastCheck) + '</dt><dd>' + value(timestamp) + '</dd>' +
      '<dt>' + esc(S.path) + '</dt><dd class="path">' + esc(path) + '</dd></dl>' +
      (row.refreshError ? '<p class="note">' + esc(translateNote(row.refreshError, S.notes)) + '</p>' : '') +
      '<button class="row-action" data-action="refreshRepository" data-path="' + esc(path) + '">' + esc(S.refreshRepository) + '</button></div></details>';
  }).join('') || '<div class="empty">' + esc(rows.length ? S.noMatches : S.noRepositories) + '</div>';
}

document.addEventListener('input', event => {
  if (event.target.id !== 'search') return;
  query = event.target.value;
  draw();
});

window.addEventListener('message', event => {
  if (event.data.type !== 'state') return;
  rows = Array.isArray(event.data.rows) ? event.data.rows : [];
  autoMode = Boolean(event.data.autoMode);
  message = event.data.message || '';
  draw();
});
document.addEventListener('toggle', event => {
  if (event.target.isConnected === false) return;
  const card = event.target.closest('details[data-path]');
  if (!card) return;
  if (card.open) expanded.add(card.dataset.path);
  else expanded.delete(card.dataset.path);
}, true);
document.addEventListener('click', event => {
  const filter = event.target.closest('[data-filter]');
  if (filter) {
    document.querySelector('#filter-' + selected).setAttribute('aria-pressed', 'false');
    selected = filter.dataset.filter;
    document.querySelector('#filter-' + selected).setAttribute('aria-pressed', 'true');
    draw();
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  vscode.postMessage({ command: button.dataset.action, ...(button.dataset.path ? { path: button.dataset.path } : {}) });
});
vscode.postMessage({ command: 'ready' });
`;

const SIDEBAR_CSS = `
/* sidebar-family:begin */
/* Task Reports sidebar family. Distributed at build time; no runtime dependency. */
/* Rounded borderless cards, pill buttons, fill inputs. References guide variables only. */
body { font-size: 13px; line-height: 1.5; }
h1 { font-size: 18px; letter-spacing: .035em; }
h2 { font-family: var(--mono); }
.card, .metric { background: var(--surface); border: 0; border-radius: 12px; box-shadow: none; }
.card::before { display: none; }
.metric strong { text-shadow: none; }
button { min-height: 28px; padding: 4px 12px; border: 0; border-radius: 980px; font-size: 12.5px; font-weight: 500;
  background: color-mix(in srgb, var(--accent) 12%, transparent); color: var(--accent); transition: filter .15s; }
button:hover:not(:disabled) { filter: brightness(1.15); color: var(--accent); }
button.primary { background: var(--accent); color: var(--accent-fg); font-weight: 600; }
button.primary:hover:not(:disabled) { color: var(--accent-fg); }
button.danger { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger); }
button.danger:hover:not(:disabled) { color: var(--danger); }
input, select, textarea { border: 0; border-radius: 10px; background: color-mix(in srgb, var(--accent) 10%, transparent); color: var(--text); font: inherit; }
input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--focus); outline-offset: 0; }
body.vscode-high-contrast button, body.vscode-high-contrast-light button { border: 1px solid var(--accent); background: transparent; color: var(--text); }
body.vscode-high-contrast input, body.vscode-high-contrast select, body.vscode-high-contrast textarea,
body.vscode-high-contrast-light input, body.vscode-high-contrast-light select, body.vscode-high-contrast-light textarea { border: 1px solid var(--line); background: transparent; }
body.vscode-high-contrast .card, body.vscode-high-contrast .metric,
body.vscode-high-contrast-light .card, body.vscode-high-contrast-light .metric { border: 1px solid var(--line); }
/* sidebar-family:end */
body { min-height: 100vh; padding: 0 16px 16px; overflow-wrap: anywhere; }
header { position: sticky; top: 0; z-index: 5; margin: 0 -16px 14px; padding: 14px 16px 10px; background: color-mix(in srgb, var(--base) 72%, transparent); -webkit-backdrop-filter: saturate(180%) blur(20px); backdrop-filter: saturate(180%) blur(20px); border-bottom: 1px solid var(--line); }
header .lede { margin: 4px 0 0; }
#summary { margin: 0 0 12px; border: 0; border-radius: 12px; background: color-mix(in srgb, var(--accent) 5%, var(--surface)); }
.search { padding: 7px 12px; border: 0; border-radius: 10px; background: color-mix(in srgb, var(--accent) 10%, transparent); }
.filters button[aria-pressed="true"] { border-color: transparent; background: var(--accent); color: var(--accent-fg); }
#rows, #repositories { border: 0; border-radius: 12px; background: color-mix(in srgb, var(--accent) 5%, var(--surface)); }
.tag { border: 0; border-radius: 980px; padding: 0 8px; background: color-mix(in srgb, var(--muted) 16%, transparent); }
.tag.ok { background: color-mix(in srgb, var(--accent) 16%, transparent); }
.tag.warn { background: color-mix(in srgb, var(--warn) 16%, transparent); }
.tag.danger { background: color-mix(in srgb, var(--danger) 16%, transparent); }
body.vscode-high-contrast #summary, body.vscode-high-contrast-light #summary, body.vscode-high-contrast #rows, body.vscode-high-contrast-light #rows, body.vscode-high-contrast #repositories, body.vscode-high-contrast-light #repositories { border: 1px solid var(--line); }
.controls > button { flex: 1 1 110px; }
#mode { flex-basis: 100%; text-align: left; padding: 7px 10px; }
#mode[aria-pressed="true"] { background: color-mix(in srgb, var(--accent) 24%, transparent); color: var(--accent); }
#mode::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-right: 8px; border-radius: 50%; background: var(--muted); }
#mode[aria-pressed="true"]::before { background: var(--accent); box-shadow: var(--glow); }
.status { margin: 14px 0 17px; }
summary { display: flex; justify-content: space-between; gap: 8px; align-items: center; padding: 11px 10px; min-height: 64px; }
.repo-main { min-width: 0; }
.repo-main strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.repo-main small { display: block; margin-top: 2px; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .04em; }
.repo-main .tag { margin-left: 6px; padding: 0 8px; font-size: 10px; }
.freshness { margin-left: 6px; color: var(--warn); font-weight: 400; }
.repo-body { padding: 0 10px 11px; border-top: 1px solid var(--line); }
.signal { margin: 9px 0; font-size: 12px; }
dl { grid-template-columns: 82px minmax(0, 1fr); gap: 5px 8px; margin: 0 0 12px; font-size: 12px; }
.sha { font-size: 11px; }
.path { color: var(--muted); }
.row-action { width: 100%; }
`;

function sidebarHtml(webview, autoMode, options = {}) {
  const t = options.t || englishT;
  const nonce = crypto.randomBytes(16).toString('hex');
  const script = SCRIPT.replace('AUTO_MODE', JSON.stringify(autoMode)).replace('STRINGS', () => scriptJson(sidebarStrings(t)));
  return `<!doctype html>
<html lang="${htmlLang(options.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>${guideCss('sideBar')}${inventoryCss}${SIDEBAR_CSS}</style></head><body>
<header><p class="eyebrow">${t('REPOSITORY INTELLIGENCE')}</p><h1>${t('Remote inventory')}</h1><p class="lede">${t('Local worktrees and remote branch status')}</p></header>
<section id="summary" class="metrics" aria-label="${t('Repository summary')}"></section>
<nav class="controls" aria-label="${t('Inventory actions')}"><button id="mode" data-action="toggleAuto" aria-pressed="false">${t('Auto refresh')}</button><button id="refresh" class="primary" data-action="refresh">${t('Refresh all')}</button><button id="dashboard" data-action="openDashboard">${t('Dashboard ↗')}</button></nav>
<p id="status" class="status" role="status"></p><input id="search" class="search" type="search" aria-label="${t('Search repositories')}" placeholder="${t('Name, or path with / or \\')}">
<nav class="filters" aria-label="${t('Repository filters')}" aria-describedby="filter-hint"><button id="filter-all" data-filter="all" aria-pressed="true">${t('All')}</button><button id="filter-attention" data-filter="attention" aria-pressed="false">${t('Attention')}</button><button id="filter-sync" data-filter="sync" aria-pressed="false">${t('In sync')}</button></nav>
<p id="filter-hint" class="filter-hint">${t('Filters use last known status, including cached results; summary counts only confirmed results.')}</p><section class="repositories" aria-label="${t('Repositories')}"><h2>${t('Repositories')}</h2><div id="repositories"></div></section>
<script nonce="${nonce}">${script}</script></body></html>`;
}

module.exports = { sidebarHtml, sidebarStrings };
