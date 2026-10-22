const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { dashboardHtml } = require('../source/dashboard');

test('dashboard provides an auto toggle, exact status filters, separate stale and dirty signals, and snapshot times', () => {
  const html = dashboardHtml({ cspSource: 'vscode-webview:' }, false);
  assert.match(html, /Mode: /);
  assert.match(html, /All/);
  assert.match(html, /In Sync/);
  assert.match(html, /Needs Attention/);
  assert.match(html, /Stale/);
  assert.match(html, /id="refresh">Refresh/);
  assert.match(html, /data-status=/);
  assert.match(html, /STALE: /);
  assert.match(html, /Dirty: /);
  assert.match(html, /Last check:/);
  assert.match(html, /clear/);
  assert.match(html, /toggleAuto/);
  assert.match(html, /--accent:#89e829/);
  assert.match(html, /<details/);
  assert.match(html, /refreshRepository/);
});

test('dashboard message renders rows and chart filters narrow rows until cleared', () => {
  const html = dashboardHtml({ cspSource: 'vscode-webview:' }, false);
  const script = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
  const elements = new Map(['#chart', '#rows', '#meta', '#signals', '#summary', '#mode', '#refresh', '#clear'].map(id => [id, {}]));
  let statusButtons = [];
  let receiveMessage;
  const document = {
    querySelector: id => elements.get(id),
    addEventListener(type, handler) { if (type === 'click') this.onClick = handler; },
    querySelectorAll: () => {
      statusButtons = [...elements.get('#chart').innerHTML.matchAll(/data-status="([^"]+)"/g)].map(match => ({ dataset: { status: match[1] }, onclick: null }));
      return statusButtons;
    },
  };
  const window = { addEventListener: (_name, callback) => { receiveMessage = callback; } };
  const posted = [];
  vm.runInNewContext(script, { document, window, acquireVsCodeApi: () => ({ postMessage: message => posted.push(message) }) });
  receiveMessage({ data: { type: 'rows', checkedAt: '2026-10-20T00:00:00Z', rows: [
    { label: 'same', path: '/one', status: 'IN_SYNC', stale: true, dirty: 2, checkedAt: '2026-10-19T00:00:00Z' },
    { label: 'other', path: '/two', status: 'AHEAD', dirty: 0, checkedAt: '2026-10-20T00:00:00Z' },
    { label: 'fresh', path: '/three', status: 'IN_SYNC', stale: false, dirty: 0, checkedAt: '2026-10-20T00:00:00Z' },
  ] } });
  assert.match(elements.get('#chart').innerHTML, /IN_SYNC \(1\)/);
  assert.match(elements.get('#chart').innerHTML, /AHEAD \(1\)/);
  assert.doesNotMatch(elements.get('#chart').innerHTML, /STALE/);
  assert.match(elements.get('#signals').textContent, /STALE: 1 · Dirty: 1/);
  assert.match(elements.get('#summary').innerHTML, /All[\s\S]*3/);
  assert.match(elements.get('#summary').innerHTML, /In Sync[\s\S]*1/);
  assert.match(elements.get('#summary').innerHTML, /Needs Attention[\s\S]*2/);
  assert.match(elements.get('#summary').innerHTML, /Stale[\s\S]*1/);
  assert.match(elements.get('#meta').textContent, /Last check: /);
  assert.match(elements.get('#rows').innerHTML, /same/);
  assert.match(elements.get('#rows').innerHTML, /STALE/);
  assert.match(elements.get('#rows').innerHTML, /data-action="refreshRepository"/);
  statusButtons.find(button => button.dataset.status === 'AHEAD').onclick();
  assert.match(elements.get('#rows').innerHTML, /other/);
  assert.doesNotMatch(elements.get('#rows').innerHTML, /same/);
  elements.get('#clear').onclick();
  assert.match(elements.get('#rows').innerHTML, /same/);
  assert.match(elements.get('#rows').innerHTML, /other/);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].command, 'ready');
  elements.get('#mode').onclick();
  assert.equal(posted[1].command, 'toggleAuto');
  elements.get('#refresh').onclick();
  assert.equal(posted[2].command, 'refresh');
  document.onClick({ target: { closest: () => ({ dataset: { path: '/two' } }) } });
  assert.equal(posted[3].command, 'refreshRepository');
  assert.equal(posted[3].path, '/two');
  receiveMessage({ data: { type: 'mode', autoMode: true } });
  assert.equal(elements.get('#mode').textContent, 'Mode: Auto');
  receiveMessage({ data: { type: 'mode', autoMode: false } });
  assert.equal(elements.get('#mode').textContent, 'Mode: Manual');
  receiveMessage({ data: { type: 'rows', rows: [{ path: '/bad', label: '<img src=x>', status: 'IN_SYNC', dirty: '<script>x</script>' }] } });
  assert.match(elements.get('#rows').innerHTML, /&lt;img src=x&gt;/);
  assert.match(elements.get('#rows').innerHTML, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.doesNotMatch(elements.get('#rows').innerHTML, /<img|<script>/);
});
