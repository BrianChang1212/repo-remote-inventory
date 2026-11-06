const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { sidebarHtml } = require('../source/sidebar');

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
