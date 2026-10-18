const fs = require('node:fs/promises');
const path = require('node:path');

function shouldExclude(relative, excludes) {
  const normalized = relative.split(path.sep).join('/');
  const parts = normalized.split('/');
  return excludes.some(raw => {
    const exclude = String(raw).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
    if (!exclude) return false;
    return exclude.includes('/')
      ? normalized === exclude || normalized.startsWith(`${exclude}/`)
      : parts.includes(exclude);
  });
}

async function discoverRepositories(rootDirectory, options = {}) {
  const root = path.resolve(rootDirectory);
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`Scan root must be a real directory: ${root}`);
  const excludes = options.excludes || [];
  const maxDirectories = options.maxDirectories || 100000;
  const pending = [root];
  const targets = [];
  const readDirectory = options.readDirectory || fs.readdir;
  let visited = 0;
  while (pending.length) {
    if (options.signal?.aborted) throw new Error('Repository discovery cancelled');
    const directory = pending.pop();
    if (++visited > maxDirectories) throw new Error(`Discovery exceeded ${maxDirectories} directories`);
    let entries;
    try { entries = await readDirectory(directory, { withFileTypes: true }); }
    catch (error) {
      if (directory === root) throw new Error(`Cannot inspect ${directory}: ${error.message}`);
      options.onWarning?.(`Cannot inspect ${directory}: ${error.message}`);
      continue;
    }
    if (entries.some(entry => entry.name === '.git' && !entry.isSymbolicLink() && (entry.isFile() || entry.isDirectory()))) {
      const relative = path.relative(root, directory);
      targets.push({ path: directory, label: relative || '.', group: '', expectedRemote: '' });
    }
    for (const entry of entries) {
      if (entry.name === '.git' || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      const child = path.join(directory, entry.name);
      if (!shouldExclude(path.relative(root, child), excludes)) pending.push(child);
    }
  }
  return targets.sort((a, b) => a.label.localeCompare(b.label));
}

module.exports = { discoverRepositories, shouldExclude };
