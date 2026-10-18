const path = require('node:path');
const { loadRepositoryList } = require('../source/config');
const { scanTargets } = require('../source/inventory');

async function main() {
  const root = process.argv[2];
  const file = process.argv[3];
  if (!root || !file) throw new Error('Usage: node tool/scan.js <root> <repo_paths.json>');
  const { targets, warnings } = loadRepositoryList(path.resolve(file), path.resolve(root));
  const rows = await scanTargets(targets, { maxParallel: 8, timeoutMs: 20000 });
  const counts = {};
  for (const row of rows) counts[row.status] = (counts[row.status] || 0) + 1;
  process.stdout.write(JSON.stringify({ scanned: rows.length, counts, dirty: rows.filter(row => row.dirty > 0).length,
    dirtyPaths: rows.filter(row => row.dirty > 0).map(row => row.label),
    dirtyUnknownPaths: rows.filter(row => row.worktreeWarning).map(row => row.label),
    warnings, problems: rows.filter(row => row.status !== 'IN_SYNC').map(row => ({ path: row.label, status: row.status, note: row.note })) }, null, 2) + '\n');
}

main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
