const fs = require('node:fs');
const path = require('node:path');
const { dashboardHtml } = require('../source/dashboard');

const rows = [
  { path: 'D:/Brian/projects/flight-controller', label: 'Flight Controller', status: 'IN_SYNC', branch: 'main', compareTarget: 'origin/main', localSha: 'a3f0b8d2', remoteSha: 'a3f0b8d2', dirty: 0, lastSuccessAt: '2026-10-21T03:00:00Z' },
  { path: 'D:/Brian/projects/telemetry', label: 'Telemetry Bridge', status: 'BEHIND', branch: 'feature/uart', compareTarget: 'origin/feature/uart', localSha: '2b70ac11', remoteSha: '4991f66a', behind: 2, dirty: 3, lastSuccessAt: '2026-10-21T03:00:00Z' },
  { path: 'D:/Brian/projects/release-hub', label: 'Release Hub', status: 'IN_SYNC', stale: true, branch: 'main', compareTarget: 'origin/main', localSha: '65ce8203', remoteSha: '65ce8203', dirty: 0, lastSuccessAt: '2026-10-20T09:00:00Z' },
];
const state = JSON.stringify({ type: 'rows', rows, checkedAt: '2026-10-21T03:00:00Z' });
const html = dashboardHtml({ cspSource: 'vscode-webview:' }, true).replace(
  'const vscode = acquireVsCodeApi();',
  `const vscode = { postMessage(message) { if (message.command === 'ready') setTimeout(() => { window.postMessage(${state}, '*'); setTimeout(() => { document.querySelectorAll('details')[1].open = true; }, 50); }, 0); } };`,
);
const output = path.resolve(__dirname, '..', 'release', 'dashboard-preview.html');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html, 'utf8');
fs.writeFileSync(path.join(path.dirname(output), 'dashboard-preview-frame.html'), '<!doctype html><html><body style="margin:0;background:#252525"><iframe src="dashboard-preview.html" style="width:390px;height:900px;border:0"></iframe></body></html>', 'utf8');
process.stdout.write(`${output}\n`);
