const fs = require('node:fs');
const path = require('node:path');
const { sidebarHtml } = require('../source/sidebar');

const rows = [
  { path: 'D:\\Brian\\projects\\flight-controller', label: 'D:\\Brian\\projects\\flight-controller', status: 'IN_SYNC', branch: 'main', compareTarget: 'origin/main', localSha: 'a3f0b8d2', remoteSha: 'a3f0b8d2', lastCommit: 'Update sensor driver', checkedAt: '2026-10-21T03:00:00Z' },
  { path: 'D:/Brian/projects/telemetry', label: 'Telemetry Bridge', status: 'BEHIND', dirty: 3, ahead: 0, behind: 2, branch: 'feature/uart', compareTarget: 'origin/feature/uart', localSha: '2b70ac11', remoteSha: '4991f66a', lastCommit: 'Refine UART retry', checkedAt: '2026-10-21T03:00:00Z' },
  { path: 'D:/Brian/projects/release-hub', label: 'Release Hub', status: 'IN_SYNC', stale: true, lastSuccessAt: '2026-10-20T09:00:00Z', branch: 'main', compareTarget: 'origin/main', localSha: '65ce8203', remoteSha: '65ce8203' },
];
const state = JSON.stringify({ type: 'state', rows, autoMode: true, message: '3 repositories · 2 need attention · checked 10/21/2026, 11:00 AM' });
const html = sidebarHtml({ cspSource: 'vscode-webview:' }, true).replace(
  'const vscode = acquireVsCodeApi();',
  `const vscode = { postMessage(message) { if (message.command === 'ready') setTimeout(() => { window.postMessage(${state}, '*'); setTimeout(() => { document.querySelectorAll('details')[1].open = true; }, 50); }, 0); } };`,
);
const output = path.resolve(__dirname, '..', 'release', 'sidebar-preview.html');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html, 'utf8');
fs.writeFileSync(path.join(path.dirname(output), 'sidebar-preview-frame.html'), '<!doctype html><html><body style="margin:0;background:#252525"><iframe src="sidebar-preview.html" style="width:300px;height:890px;border:0"></iframe></body></html>', 'utf8');
process.stdout.write(`${output}\n`);
