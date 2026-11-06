const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { sidebarHtml } = require('../source/sidebar');
const { dashboardHtml } = require('../source/dashboard');

const browser = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file => file && fs.existsSync(file));

test('real browser search input filters repository rows and preserves focus', {
  skip: process.env.RUN_BROWSER_TESTS !== '1' ? 'Set RUN_BROWSER_TESTS=1 for the local Chrome/Edge check.' : !browser ? 'Chrome/Edge is not installed.' : false,
}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-search-'));
  const rows = [
    { path: 'D:/Brian', label: 'Brian', status: 'IN_SYNC' },
    { path: 'D:/Brian/projects/alpha', label: 'Alpha', status: 'IN_SYNC' },
    { path: 'D:/Brian/projects/beta', label: 'Beta', status: 'BEHIND' },
  ];
  const driver = `const vscode = { postMessage(message) {
    if (message.command !== 'ready') return;
    setTimeout(() => {
      window.postMessage({ type: 'state', rows: ${JSON.stringify(rows)} }, '*');
      setTimeout(() => {
        const input = document.querySelector('#search');
        input.focus();
        const outcomes = ${JSON.stringify(['ALPHA', 'Brian', 'D:\\BRIAN\\projects\\ALPHA'])}.map(query => {
          input.value = query;
          input.dispatchEvent(new InputEvent('input', { bubbles: true, data: query, inputType: 'insertText' }));
          return {
            names: [...document.querySelectorAll('.repo-main strong')].map(item => item.textContent),
            focus: document.activeElement === input,
            query: input.value,
          };
        });
        document.body.dataset.searchResult = JSON.stringify(outcomes);
      }, 50);
    }, 0);
  } };`;
  const html = sidebarHtml({ cspSource: 'vscode-webview:' }, false).replace('const vscode = acquireVsCodeApi();', driver);
  const file = path.join(dir, 'search.html');
  fs.writeFileSync(file, html);
  const result = spawnSync(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + path.join(dir, 'profile'), '--virtual-time-budget=1500', '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const match = result.stdout.match(/data-search-result="([^"]+)"/);
  assert.ok(match, 'Browser must execute the real sidebar script and input event');
  const outcome = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  assert.deepEqual(outcome, [
    { names: ['Alpha'], focus: true, query: 'ALPHA' },
    { names: ['Brian'], focus: true, query: 'Brian' },
    { names: ['Alpha'], focus: true, query: 'D:\\BRIAN\\projects\\ALPHA' },
  ]);
});

test('real browser keeps independent search, filters and expansion while both views refresh', {
  skip: process.env.RUN_BROWSER_TESTS !== '1' ? 'Set RUN_BROWSER_TESTS=1 for the local Chrome/Edge check.' : !browser ? 'Chrome/Edge is not installed.' : false,
}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-linked-'));
  const frame = (name, build) => build({ cspSource: 'vscode-webview:' }, false)
    .replace('const vscode = acquireVsCodeApi();', `const vscode = { postMessage(message) { parent.mockHost('${name}', message); } };`);
  fs.writeFileSync(path.join(dir, 'sidebar.html'), frame('sidebar', sidebarHtml));
  fs.writeFileSync(path.join(dir, 'dashboard.html'), frame('dashboard', dashboardHtml));
  const html = `<!doctype html><html><body>
<script>
const ready = new Set();
let revision = 0;
const delay = () => new Promise(resolve => setTimeout(resolve, 60));
const rows = [
 { path: '/one/repo', label: 'Alpha', status: 'BEHIND', stale: true, dirty: 2 },
 { path: '/two/repo', label: 'Beta', status: 'IN_SYNC', stale: true, dirty: 0 },
];
function send() {
 for (const name of ['sidebar', 'dashboard']) frames[name].postMessage({ type: name === 'sidebar' ? 'state' : 'rows', rows, autoMode: false, message: 'snapshot ' + revision }, '*');
}
function mockHost(name, message) {
 if (message.command === 'ready') { ready.add(name); if (ready.size === 2) void exercise(); }
 if (message.command === 'refresh' || message.command === 'refreshRepository') {
  revision++;
  rows.forEach(row => { if (!message.path || row.path === message.path) { row.stale = false; row.dirty = revision; } });
  send();
 }
}
async function exercise() {
 try {
  send(); await delay();
  const side = frames.sidebar.document, dash = frames.dashboard.document;
  side.querySelector('#search').value = 'Beta'; side.querySelector('#search').dispatchEvent(new Event('input', { bubbles: true }));
  side.querySelector('#filter-sync').click();
  dash.querySelector('#search').value = '/one/'; dash.querySelector('#search').dispatchEvent(new Event('input', { bubbles: true }));
  dash.querySelector('#filter-attention').click();
  dash.querySelector('details').open = true; await delay();
  side.querySelector('#refresh').click(); await delay();
  const before = {
   sideNames: [...side.querySelectorAll('.repo-main strong')].map(el => el.textContent),
   dashboardPaths: [...dash.querySelectorAll('details')].map(el => el.dataset.path),
   dashboardOpen: dash.querySelector('details').open,
  };
  dash.querySelector('[data-action="refreshRepository"]').click(); await delay();
  document.body.dataset.linkResult = JSON.stringify({
   ...before, revision,
   sideQuery: side.querySelector('#search').value, dashQuery: dash.querySelector('#search').value,
   sideFilter: side.querySelector('#filter-sync').getAttribute('aria-pressed'),
   dashFilter: dash.querySelector('#filter-attention').getAttribute('aria-pressed'),
   expandedAfterSingle: dash.querySelector('details').open,
   sideSummary: side.querySelector('#summary').textContent,
   dashSummary: dash.querySelector('#summary').textContent,
   sideFreshness: side.querySelector('#repositories').textContent.includes('Stale'),
   dashFreshness: dash.querySelector('#rows').textContent.includes('Stale'),
  });
 } catch(error) { document.body.dataset.linkError = error.stack; }
}
</script><iframe name="sidebar" src="sidebar.html"></iframe><iframe name="dashboard" src="dashboard.html"></iframe></body></html>`;
  const file = path.join(dir, 'linked.html');
  fs.writeFileSync(file, html);
  const result = spawnSync(browser, ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + path.join(dir, 'profile'), '--virtual-time-budget=4000', '--dump-dom', pathToFileURL(file).href], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const match = result.stdout.match(/data-link-result="([^"]+)"/);
  assert.ok(match, result.stdout);
  const outcome = JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  assert.deepEqual(outcome, {
    sideNames: ['Beta'], dashboardPaths: ['/one/repo'], dashboardOpen: true, revision: 2,
    sideQuery: 'Beta', dashQuery: '/one/', sideFilter: 'true', dashFilter: 'true', expandedAfterSingle: true,
    sideSummary: 'TOTAL2CURRENT2ATTENTION1', dashSummary: 'TOTAL2CURRENT2ATTENTION1',
    sideFreshness: false, dashFreshness: false,
  });
});
