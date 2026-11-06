const test = require('node:test');
const assert = require('node:assert/strict');
const { dashboardHtml } = require('../source/dashboard');
const { sidebarHtml } = require('../source/sidebar');
const { inventoryCss } = require('../source/style');
const { assertGuideCss } = require('./style-assertions');

test('inventory views share component styling while preserving their theme surfaces', () => {
  const webview = { cspSource: 'vscode-webview:' };
  assert.equal(typeof inventoryCss, 'string');
  for (const [render, surface] of [[dashboardHtml, 'editor'], [sidebarHtml, 'sideBar']]) {
    const html = render(webview, false);
    assert.ok(html.includes(inventoryCss), `${surface} must use the shared inventory components`);
    assertGuideCss(html, surface);
    assert.match(html, /class="eyebrow"/);
    assert.match(html, /class="lede"/);
    assert.match(html, /script-src 'nonce-/);
    assert.doesNotMatch(html, /https?:\/\//);
  }
});
