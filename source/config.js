const fs = require('node:fs');
const path = require('node:path');

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function loadRepositoryList(file, rootDirectory) {
  const root = path.resolve(rootDirectory);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data || !Array.isArray(data.repos)) throw new Error('Repository list must contain a repos array');
  const targets = [];
  const seen = new Set();
  for (const entry of data.repos) {
    if (!entry || typeof entry.path !== 'string' || !entry.path.trim()) throw new Error('Repository entry needs a path');
    const rel = entry.path.replace(/[\\/]/g, path.sep);
    if (path.isAbsolute(rel) || /^[A-Za-z]:[\\/]/.test(entry.path)) throw new Error(`Repository path is outside root: ${entry.path}`);
    const absolute = path.resolve(root, rel);
    if (!inside(root, absolute)) throw new Error(`Repository path is outside root: ${entry.path}`);
    const key = process.platform === 'win32' ? absolute.toLowerCase() : absolute;
    if (seen.has(key)) throw new Error(`Duplicate repository path: ${entry.path}`);
    seen.add(key);
    targets.push({ path: absolute, label: entry.path, group: entry.group || '', expectedRemote: entry.remote || '' });
  }
  const warnings = [];
  if (Number.isInteger(data.expected_repo_count) && data.expected_repo_count !== targets.length) {
    warnings.push(`List has ${targets.length} repositories; expected ${data.expected_repo_count}.`);
  }
  return { targets, warnings };
}

module.exports = { loadRepositoryList, inside };
